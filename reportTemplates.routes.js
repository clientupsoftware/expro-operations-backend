const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// ================= PLANTILLAS =================

// GET /api/report-templates - listado con conteos, para el selector al crear un reporte
// y para la pantalla de Configuracion.
router.get('/', async (req, res) => {
  const result = await pool.query(`
    SELECT report_templates.*, clients.name AS client_name,
      (SELECT COUNT(*) FROM report_template_time_fields WHERE template_id = report_templates.id) AS time_fields_count,
      (SELECT COUNT(*) FROM report_template_asset_slots WHERE template_id = report_templates.id) AS asset_slots_count,
      (SELECT COUNT(*) FROM report_template_files WHERE template_id = report_templates.id) AS files_count
    FROM report_templates
    LEFT JOIN clients ON clients.id = report_templates.client_id
    ORDER BY report_templates.nombre
  `);
  res.json(result.rows);
});

// GET /api/report-templates/:id - detalle completo (campos + slots), sin el binario del excel
router.get('/:id', async (req, res) => {
  const template = await pool.query('SELECT * FROM report_templates WHERE id = $1', [req.params.id]);
  if (template.rows.length === 0) return res.status(404).json({ error: 'Plantilla no encontrada.' });

  const timeFields = await pool.query(
    'SELECT * FROM report_template_time_fields WHERE template_id = $1 ORDER BY orden',
    [req.params.id]
  );
  const assetSlots = await pool.query(`
    SELECT report_template_asset_slots.*, unit_types.name AS unit_type_name
    FROM report_template_asset_slots
    LEFT JOIN unit_types ON unit_types.id = report_template_asset_slots.unit_type_id
    WHERE template_id = $1 ORDER BY orden
  `, [req.params.id]);
  const file = await pool.query(
    'SELECT id, nombre_archivo, hoja, fila_inicio, uploaded_at FROM report_template_files WHERE template_id = $1',
    [req.params.id]
  );

  res.json({
    ...template.rows[0],
    time_fields: timeFields.rows,
    asset_slots: assetSlots.rows,
    file: file.rows[0] || null
  });
});

router.post('/', requireRole('coordinador', 'super'), async (req, res) => {
  const { nombre, client_id } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  const result = await pool.query(
    'INSERT INTO report_templates (nombre, client_id) VALUES ($1, $2) RETURNING *',
    [nombre.trim(), client_id || null]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', requireRole('coordinador', 'super'), async (req, res) => {
  const { nombre, client_id, activo } = req.body;
  const result = await pool.query(
    `UPDATE report_templates SET
       nombre = COALESCE($1, nombre),
       client_id = $2,
       activo = COALESCE($3, activo)
     WHERE id = $4 RETURNING *`,
    [nombre?.trim() || null, client_id === undefined ? null : (client_id || null), activo, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Plantilla no encontrada.' });
  res.json(result.rows[0]);
});

// Nota: al eliminar una plantilla, los reportes ya creados con ella no se ven afectados
// (guardan su propio snapshot de campos/slots) - solo pierden la referencia al catalogo
// maestro (report_template_id pasa a NULL por el ON DELETE SET NULL).
router.delete('/:id', requireRole('coordinador', 'super'), async (req, res) => {
  const result = await pool.query('DELETE FROM report_templates WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Plantilla no encontrada.' });
  res.status(204).send();
});

// ================= CAMPOS DE TIEMPO =================

router.post('/:id/time-fields', requireRole('coordinador', 'super'), async (req, res) => {
  const { label, tipo_campo, obligatorio, excel_columna } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'El label es obligatorio.' });
  const maxOrden = await pool.query(
    'SELECT COALESCE(MAX(orden), 0) AS max_orden FROM report_template_time_fields WHERE template_id = $1',
    [req.params.id]
  );
  const result = await pool.query(
    `INSERT INTO report_template_time_fields (template_id, label, orden, obligatorio, tipo_campo, excel_columna)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, label.trim(), maxOrden.rows[0].max_orden + 1, obligatorio || false,
     tipo_campo || 'hora', excel_columna || null]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/time-fields/:fieldId', requireRole('coordinador', 'super'), async (req, res) => {
  const { label, tipo_campo, obligatorio, excel_columna, orden } = req.body;
  const result = await pool.query(
    `UPDATE report_template_time_fields SET
       label = COALESCE($1, label), tipo_campo = COALESCE($2, tipo_campo),
       obligatorio = COALESCE($3, obligatorio), excel_columna = $4, orden = COALESCE($5, orden)
     WHERE id = $6 RETURNING *`,
    [label?.trim() || null, tipo_campo || null, obligatorio, excel_columna || null, orden, req.params.fieldId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Campo no encontrado.' });
  res.json(result.rows[0]);
});

router.delete('/time-fields/:fieldId', requireRole('coordinador', 'super'), async (req, res) => {
  const result = await pool.query('DELETE FROM report_template_time_fields WHERE id = $1 RETURNING id', [req.params.fieldId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Campo no encontrado.' });
  res.status(204).send();
});

// ================= SLOTS DE ASSET =================

router.post('/:id/asset-slots', requireRole('coordinador', 'super'), async (req, res) => {
  const { label, unit_type_id, excel_columna } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'El label es obligatorio.' });
  const maxOrden = await pool.query(
    'SELECT COALESCE(MAX(orden), 0) AS max_orden FROM report_template_asset_slots WHERE template_id = $1',
    [req.params.id]
  );
  const result = await pool.query(
    `INSERT INTO report_template_asset_slots (template_id, label, orden, unit_type_id, excel_columna)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, label.trim(), maxOrden.rows[0].max_orden + 1, unit_type_id || null, excel_columna || null]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/asset-slots/:slotId', requireRole('coordinador', 'super'), async (req, res) => {
  const { label, unit_type_id, excel_columna, orden } = req.body;
  const result = await pool.query(
    `UPDATE report_template_asset_slots SET
       label = COALESCE($1, label), unit_type_id = $2, excel_columna = $3, orden = COALESCE($4, orden)
     WHERE id = $5 RETURNING *`,
    [label?.trim() || null, unit_type_id || null, excel_columna || null, orden, req.params.slotId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Slot no encontrado.' });
  res.json(result.rows[0]);
});

router.delete('/asset-slots/:slotId', requireRole('coordinador', 'super'), async (req, res) => {
  const result = await pool.query('DELETE FROM report_template_asset_slots WHERE id = $1 RETURNING id', [req.params.slotId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Slot no encontrado.' });
  res.status(204).send();
});

// ================= ARCHIVO EXCEL BASE =================
// Se guarda en la DB (Railway no persiste filesystem entre deploys).
// Un solo archivo por plantilla: subir uno nuevo reemplaza al anterior.

router.post('/:id/file', requireRole('coordinador', 'super'), async (req, res) => {
  const { archivo_base64, nombre_archivo, hoja, fila_inicio } = req.body;
  if (!archivo_base64) return res.status(400).json({ error: 'Falta el archivo.' });

  const buffer = Buffer.from(archivo_base64, 'base64');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM report_template_files WHERE template_id = $1', [req.params.id]);
    const result = await client.query(
      `INSERT INTO report_template_files (template_id, archivo, nombre_archivo, hoja, fila_inicio)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre_archivo, hoja, fila_inicio, uploaded_at`,
      [req.params.id, buffer, nombre_archivo || null, hoja || null, fila_inicio || 1]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al subir el archivo.' });
  } finally {
    client.release();
  }
});

router.get('/:id/file', async (req, res) => {
  const result = await pool.query('SELECT * FROM report_template_files WHERE template_id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Esta plantilla todavia no tiene un excel base cargado.' });
  const file = result.rows[0];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${file.nombre_archivo || 'plantilla.xlsx'}"`);
  res.send(file.archivo);
});

module.exports = router;
