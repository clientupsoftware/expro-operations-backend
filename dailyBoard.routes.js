const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/daily-board - todos los roles ven el tablero completo
router.get('/', async (req, res) => {
  const result = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha DESC NULLS LAST, daily_board_entries.id DESC
  `);
  res.json(result.rows);
});

// POST /api/daily-board - crear entrada (Coordinador/Super)
router.post('/', requireRole('coordinador'), async (req, res) => {
  const { estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, supervisor, comentarios } = req.body;
  const result = await pool.query(
    `INSERT INTO daily_board_entries
       (estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, supervisor, comentarios, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [estado || 'proxima_operacion', fecha || null, unidad || null, pozo || null, tipo_unidad || null,
     client_id || null, edp || null, servicios || null, supervisor || null, comentarios || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/daily-board/:id - editar cualquier campo (Coordinador/Super)
const EDITABLE_FIELDS = ['estado', 'fecha', 'unidad', 'pozo', 'tipo_unidad', 'client_id', 'edp', 'servicios', 'supervisor', 'comentarios'];
router.patch('/:id', requireRole('coordinador'), async (req, res) => {
  const setClauses = [];
  const values = [];
  EDITABLE_FIELDS.forEach((field) => {
    if (field in req.body) {
      values.push(req.body[field] || null);
      setClauses.push(`${field} = $${values.length}`);
    }
  });
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE daily_board_entries SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada.' });

  const entry = result.rows[0];
  // Si esta entrada ya fue enviada a un Job y el estado cambio, se refleja el mismo estado en el Job
  if ('estado' in req.body && entry.job_id) {
    await pool.query('UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', [entry.estado, entry.job_id]);
  }

  res.json(entry);
});

// DELETE /api/daily-board/:id (Coordinador/Super)
router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM daily_board_entries WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// POST /api/daily-board/:id/promote - convierte la entrada en un Job real (PreJob)
router.post('/:id/promote', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;

  const entryResult = await pool.query('SELECT * FROM daily_board_entries WHERE id = $1', [id]);
  if (entryResult.rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada.' });
  const entry = entryResult.rows[0];

  if (!entry.client_id) return res.status(400).json({ error: 'La entrada necesita un cliente asignado antes de enviarla a PreJob.' });
  if (!entry.pozo) return res.status(400).json({ error: 'La entrada necesita un pozo cargado antes de enviarla a PreJob.' });
  if (entry.job_id) return res.status(400).json({ error: 'Esta entrada ya fue enviada a PreJob.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar o crear el PAD (mismo nombre que el pozo, para no forzar una estructura que todavia no existe)
    let padResult = await client.query(
      'SELECT * FROM pads WHERE name = $1 AND client_id = $2',
      [entry.pozo, entry.client_id]
    );
    let pad = padResult.rows[0];
    if (!pad) {
      const inserted = await client.query(
        'INSERT INTO pads (name, client_id) VALUES ($1, $2) RETURNING *',
        [entry.pozo, entry.client_id]
      );
      pad = inserted.rows[0];
    }

    // Buscar o crear el pozo dentro de ese PAD
    let wellResult = await client.query(
      'SELECT * FROM wells WHERE name = $1 AND pad_id = $2',
      [entry.pozo, pad.id]
    );
    let well = wellResult.rows[0];
    if (!well) {
      const inserted = await client.query(
        'INSERT INTO wells (name, pad_id) VALUES ($1, $2) RETURNING *',
        [entry.pozo, pad.id]
      );
      well = inserted.rows[0];
    }

    // Parsear el texto libre de servicios (ej: "CBL+Aux", "218 etapas P&P") y matchear/crear en la tabla services
    const serviceNames = (entry.servicios || '')
      .split(/[+/,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const serviceIds = [];
    for (const name of serviceNames) {
      let svcResult = await client.query('SELECT * FROM services WHERE LOWER(name) = LOWER($1)', [name]);
      let svc = svcResult.rows[0];
      if (!svc) {
        const inserted = await client.query('INSERT INTO services (name) VALUES ($1) RETURNING *', [name]);
        svc = inserted.rows[0];
      }
      serviceIds.push(svc.id);
    }
    if (serviceIds.length === 0) {
      // si no se pudo interpretar el texto de servicios, se crea igual el job sin servicios
      // (el coordinador los puede agregar despues desde la pestaña Datos del Job)
    }

    const jobResult = await client.query(
      `INSERT INTO jobs (pad_id, created_by, status) VALUES ($1, $2, $3) RETURNING *`,
      [pad.id, req.user.id, entry.estado]
    );
    const job = jobResult.rows[0];

    await client.query('INSERT INTO job_wells (job_id, well_id) VALUES ($1, $2)', [job.id, well.id]);
    for (const serviceId of serviceIds) {
      await client.query('INSERT INTO job_services (job_id, service_id) VALUES ($1, $2)', [job.id, serviceId]);
    }

    // El Job queda vinculado a esta entrada. El estado NO cambia solo por enviarlo a PreJob:
    // el Job nace con el mismo estado que tenia la entrada en ese momento, y de ahi en adelante
    // se mantienen sincronizados (ver PATCH /:id mas arriba).
    await client.query(
      `UPDATE daily_board_entries SET job_id = $1, updated_at = now() WHERE id = $2`,
      [job.id, id]
    );

    await client.query('COMMIT');
    res.status(201).json({ job, message: 'Job creado y enviado a PreJob.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la entrada a PreJob.' });
  } finally {
    client.release();
  }
});

// GET /api/daily-board/export - descarga el Excel con el mismo formato del Parte Diario
router.get('/export', async (req, res) => {
  const ExcelJS = require('exceljs');
  const result = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha DESC NULLS LAST, daily_board_entries.id DESC
  `);

  const ESTADO_LABELS = {
    proxima_operacion: 'Prox. Op',
    en_operacion: 'En Op.',
    operacion_finalizada: 'Op. Finalizada',
    operacion_cancelada: 'Op. Cancelada',
    operacion_rechazada: 'Op. Rechazada'
  };
  const ESTADO_COLORS = {
    proxima_operacion: 'FFF6C244',
    en_operacion: 'FF7C5CFF',
    operacion_finalizada: 'FFD9E1F2',
    operacion_cancelada: 'FFF4B3B3',
    operacion_rechazada: 'FFF4B3B3'
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Parte Diario');

  const headers = ['Estado', 'Fecha', 'Unidad', 'Pozo', 'Un.', 'Cliente', 'EDP', 'Servicios', 'Supervisor', 'Comments'];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  });

  for (const entry of result.rows) {
    const row = sheet.addRow([
      ESTADO_LABELS[entry.estado] || entry.estado,
      entry.fecha,
      entry.unidad,
      entry.pozo,
      entry.tipo_unidad,
      entry.client_name,
      entry.edp,
      entry.servicios,
      entry.supervisor,
      entry.comentarios
    ]);
    row.getCell(2).numFmt = 'dd-mmm';
    const color = ESTADO_COLORS[entry.estado];
    if (color) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    }
  }

  sheet.columns.forEach((col) => { col.width = 16; });
  sheet.getColumn(10).width = 40;
  sheet.getColumn(1).width = 18;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Parte_Diario.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
