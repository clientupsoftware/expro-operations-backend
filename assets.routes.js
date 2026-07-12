const express = require('express');
const multer = require('multer');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');
const { computeSemaphore } = require('./semaphore');
const { parseSapExcel } = require('./sapImport');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(requireAuth);

async function getSemaphoreThreshold() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'cert_semaphore_threshold_days'");
  return result.rows[0] ? parseInt(result.rows[0].value, 10) : 30;
}

// GET /api/assets - todos ven todo. Devuelve cada asset con su color de semaforo calculado.
router.get('/', async (req, res) => {
  const { category, location, search, estado } = req.query;
  const threshold = await getSemaphoreThreshold();

  let query = `
    SELECT assets.*, equipment_catalog.category, equipment_catalog.model_description, equipment_catalog.counting_mode
    FROM assets
    LEFT JOIN equipment_catalog ON equipment_catalog.id = assets.equipment_catalog_id
    WHERE 1=1
  `;
  const values = [];
  if (category) { values.push(category); query += ` AND equipment_catalog.category = $${values.length}`; }
  if (location) { values.push(`%${location}%`); query += ` AND assets.current_location ILIKE $${values.length}`; }
  if (search) {
    values.push(`%${search}%`);
    query += ` AND (assets.sap_equipment_code ILIKE $${values.length} OR assets.description ILIKE $${values.length})`;
  }
  query += ' ORDER BY assets.sap_equipment_code LIMIT 300';

  const result = await pool.query(query, values);
  let withSemaphore = result.rows.map((asset) => ({
    ...asset,
    semaphore: computeSemaphore(asset, threshold)
  }));

  if (estado) {
    withSemaphore = withSemaphore.filter((a) => a.semaphore === estado);
  }
  withSemaphore = withSemaphore.slice(0, 100);

  res.json(withSemaphore);
});

// GET /api/assets/:id
router.get('/:id', async (req, res) => {
  const threshold = await getSemaphoreThreshold();
  const result = await pool.query(`
    SELECT assets.*, equipment_catalog.category, equipment_catalog.model_description, equipment_catalog.counting_mode
    FROM assets
    LEFT JOIN equipment_catalog ON equipment_catalog.id = assets.equipment_catalog_id
    WHERE assets.id = $1
  `, [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Asset no encontrado.' });
  res.json({ ...result.rows[0], semaphore: computeSemaphore(result.rows[0], threshold) });
});

// POST /api/assets - alta manual de un asset (solo Mantenimiento)
router.post('/', requireRole('mantenimiento'), async (req, res) => {
  const {
    equipment_catalog_id, sap_equipment_code, description, equipment_type,
    serial_number, system_status, current_location, max_working_pressure,
    cert_annual_expiry, cert_major_expiry, cert_load_test_expiry,
    cert_nde_expiry, cert_visual_expiry, cert_calibration_expiry
  } = req.body;

  const result = await pool.query(
    `INSERT INTO assets (
       equipment_catalog_id, sap_equipment_code, description, equipment_type,
       serial_number, system_status, current_location, max_working_pressure,
       cert_annual_expiry, cert_major_expiry, cert_load_test_expiry,
       cert_nde_expiry, cert_visual_expiry, cert_calibration_expiry
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [equipment_catalog_id, sap_equipment_code, description, equipment_type,
     serial_number, system_status, current_location, max_working_pressure,
     cert_annual_expiry, cert_major_expiry, cert_load_test_expiry,
     cert_nde_expiry, cert_visual_expiry, cert_calibration_expiry]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/assets/:id - editar un asset existente (solo Mantenimiento)
router.put('/:id', requireRole('mantenimiento'), async (req, res) => {
  const fields = req.body;
  const allowedFields = [
    'equipment_catalog_id', 'sap_equipment_code', 'description', 'equipment_type',
    'serial_number', 'system_status', 'current_location', 'max_working_pressure',
    'cert_annual_expiry', 'cert_major_expiry', 'cert_load_test_expiry',
    'cert_nde_expiry', 'cert_visual_expiry', 'cert_calibration_expiry'
  ];
  const setClauses = [];
  const values = [];
  allowedFields.forEach((field) => {
    if (field in fields) {
      values.push(fields[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
  });
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE assets SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Asset no encontrado.' });
  res.json(result.rows[0]);
});

// POST /api/assets/import-sap - sube el Excel exportado de SAP y actualiza/crea assets (solo Mantenimiento)
// El excel debe tener la hoja "RawData" con las columnas estandar de SAP.
router.post('/import-sap', requireRole('mantenimiento'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "file").' });

  let parsedRows;
  try {
    parsedRows = parseSapExcel(req.file.buffer);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: 'No se pudo leer el archivo. Verifica que sea el export de SAP.' });
  }

  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const row of parsedRows) {
      const existing = await client.query(
        'SELECT id FROM assets WHERE sap_equipment_code = $1',
        [row.sap_equipment_code]
      );

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE assets SET
             description = $1, equipment_type = $2, serial_number = $3,
             system_status = $4, current_location = $5, max_working_pressure = $6,
             cert_annual_expiry = $7, cert_major_expiry = $8, cert_load_test_expiry = $9,
             cert_nde_expiry = $10, cert_visual_expiry = $11, cert_calibration_expiry = $12,
             updated_at = now()
           WHERE sap_equipment_code = $13`,
          [row.description, row.equipment_type, row.serial_number,
           row.system_status, row.current_location, row.max_working_pressure,
           row.cert_annual_expiry, row.cert_major_expiry, row.cert_load_test_expiry,
           row.cert_nde_expiry, row.cert_visual_expiry, row.cert_calibration_expiry,
           row.sap_equipment_code]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO assets (
             sap_equipment_code, description, equipment_type, serial_number,
             system_status, current_location, max_working_pressure,
             cert_annual_expiry, cert_major_expiry, cert_load_test_expiry,
             cert_nde_expiry, cert_visual_expiry, cert_calibration_expiry
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [row.sap_equipment_code, row.description, row.equipment_type, row.serial_number,
           row.system_status, row.current_location, row.max_working_pressure,
           row.cert_annual_expiry, row.cert_major_expiry, row.cert_load_test_expiry,
           row.cert_nde_expiry, row.cert_visual_expiry, row.cert_calibration_expiry]
        );
        created += 1;
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Importacion completa.', created, updated, total_procesados: parsedRows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error durante la importacion. No se guardo ningun cambio.' });
  } finally {
    client.release();
  }
});

// PATCH /api/assets/:id/reset-runs - resetea AMBOS contadores (carreras y operaciones) juntos,
// ya que un reseteo representa un evento fisico (ej: cambio de componente interno) que afecta
// a los dos por igual. Solo Super. Requiere un motivo, y deja historico de cuanto tenia antes.
router.patch('/:id/reset-runs', requireRole('super'), async (req, res) => {
  const { motivo } = req.body;
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo del reseteo es requerido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assetResult = await client.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (assetResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Asset no encontrado.' });
    }
    const asset = assetResult.rows[0];

    await client.query(
      'INSERT INTO asset_run_resets (asset_id, previous_count, previous_operations, motivo, reset_by) VALUES ($1, $2, $3, $4, $5)',
      [asset.id, asset.cumulative_runs, asset.cumulative_operations, motivo.trim(), req.user.id]
    );

    const updated = await client.query(
      'UPDATE assets SET cumulative_runs = 0, cumulative_operations = 0, counting_since = CURRENT_DATE, updated_at = now() WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al resetear el contador.' });
  } finally {
    client.release();
  }
});

// GET /api/assets/:id/reset-history - historico de reseteos de este asset (todos los roles lo pueden ver)
router.get('/:id/reset-history', async (req, res) => {
  const result = await pool.query(`
    SELECT asset_run_resets.*, users.name AS reset_by_name
    FROM asset_run_resets
    LEFT JOIN users ON users.id = asset_run_resets.reset_by
    WHERE asset_id = $1
    ORDER BY reset_at DESC
  `, [req.params.id]);
  res.json(result.rows);
});

// ---------- EQUIPMENT CATALOG (los "modelos" de equipo) ----------
router.get('/catalog/all', async (req, res) => {
  const result = await pool.query('SELECT * FROM equipment_catalog ORDER BY category, model_description');
  res.json(result.rows);
});

router.post('/catalog', requireRole('mantenimiento'), async (req, res) => {
  const { category, model_description, counting_mode } = req.body;
  if (!model_description) return res.status(400).json({ error: 'model_description es requerido.' });
  const result = await pool.query(
    `INSERT INTO equipment_catalog (category, model_description, counting_mode) VALUES ($1, $2, $3)
     ON CONFLICT (category, model_description) DO NOTHING RETURNING *`,
    [category || null, model_description, counting_mode === 'operacion' ? 'operacion' : 'carrera']
  );
  res.status(201).json(result.rows[0] || { message: 'Ya existia en el catalogo.' });
});

// PUT /api/assets/catalog/:id - editar el modo de conteo de un modelo ya cargado (Mantenimiento)
router.put('/catalog/:id', requireRole('mantenimiento'), async (req, res) => {
  const { category, model_description, counting_mode } = req.body;
  const result = await pool.query(
    `UPDATE equipment_catalog SET
       category = COALESCE($1, category),
       model_description = COALESCE($2, model_description),
       counting_mode = COALESCE($3, counting_mode)
     WHERE id = $4 RETURNING *`,
    [category || null, model_description || null, counting_mode || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Modelo no encontrado.' });
  res.json(result.rows[0]);
});

module.exports = router;
