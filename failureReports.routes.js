// failureReports.routes.js
const express = require('express');
const router = express.Router();
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { exportFailureReportToWord } = require('./failureReportExport');

// GET /api/failure-reports/:id  -> detalle completo con assets y fotos
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const report = await pool.query('SELECT * FROM failure_reports WHERE id = $1', [id]);
  if (!report.rows.length) return res.status(404).json({ error: 'No encontrado' });

  const assets = await pool.query(
    `SELECT fra.*, a.sap_equipment_code, a.description, a.cumulative_runs, a.cumulative_operations
     FROM failure_report_assets fra
     JOIN assets a ON a.id = fra.asset_id
     WHERE fra.failure_report_id = $1`,
    [id]
  );
  const photos = await pool.query(
    'SELECT * FROM failure_report_photos WHERE failure_report_id = $1 ORDER BY orden',
    [id]
  );

  res.json({ ...report.rows[0], assets: assets.rows, photos: photos.rows });
});

// POST /api/failure-reports  -> crear, precargando campos verdes desde el job/linea
router.post('/', requireAuth, async (req, res) => {
  const {
    job_id, time_report_line_id, event_datetime,
    supervisor_id, cliente_id, pozo_etapa,
    npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
    clasificacion_nivel, causa_raiz, accion_correctiva,
    responsable_seguimiento_id, fecha_cierre,
    asset_ids // ya viene filtrado en frontend al subset de assets de esa linea
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertReport = await client.query(
      `INSERT INTO failure_reports
       (job_id, time_report_line_id, event_datetime, supervisor_id, cliente_id, pozo_etapa,
        npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
        clasificacion_nivel, causa_raiz, accion_correctiva, responsable_seguimiento_id,
        fecha_cierre, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [job_id, time_report_line_id, event_datetime, supervisor_id, cliente_id, pozo_etapa,
       npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
       clasificacion_nivel, causa_raiz, accion_correctiva, responsable_seguimiento_id,
       fecha_cierre, req.user.id]
    );
    const reportId = insertReport.rows[0].id;

    // TODO CONFIRMAR: nombre real de la tabla que vincula assets a una linea de time report.
    // Uso 'time_report_line_assets' como supuesto - ajustar si el nombre real es otro.
    if (asset_ids?.length) {
      const validAssets = await client.query(
        `SELECT asset_id FROM time_report_line_assets
         WHERE time_report_line_id = $1 AND asset_id = ANY($2::int[])`,
        [time_report_line_id, asset_ids]
      );
      const validIds = validAssets.rows.map(r => r.asset_id);
      for (const assetId of validIds) {
        await client.query(
          'INSERT INTO failure_report_assets (failure_report_id, asset_id) VALUES ($1, $2)',
          [reportId, assetId]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: reportId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear reporte de falla' });
  } finally {
    client.release();
  }
});

// PATCH /api/failure-reports/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const allowed = [
    'event_datetime','supervisor_id','cliente_id','pozo_etapa','npt',
    'descripcion_que_sucedio','descripcion_por_que','acciones_inmediatas',
    'clasificacion_nivel','causa_raiz','accion_correctiva',
    'responsable_seguimiento_id','fecha_cierre','estado'
  ];
  const setClauses = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      setClauses.push(`${key} = $${i++}`);
      values.push(fields[key]);
    }
  }
  if (!setClauses.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
  values.push(id);
  await pool.query(
    `UPDATE failure_reports SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${i}`,
    values
  );
  res.json({ ok: true });
});

// GET /api/failure-reports/:id/export
router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const report = await pool.query('SELECT * FROM failure_reports WHERE id = $1', [req.params.id]);
    if (!report.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const assets = await pool.query(
      `SELECT a.sap_equipment_code, a.description, a.cumulative_runs AS carreras_acumuladas, a.cumulative_operations AS operaciones_acumuladas
       FROM failure_report_assets fra JOIN assets a ON a.id = fra.asset_id
       WHERE fra.failure_report_id = $1`,
      [req.params.id]
    );
    const filePath = await exportFailureReportToWord({ ...report.rows[0], assets: assets.rows, photos: [] });
    res.download(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// GET /api/failure-reports/assets/con-falla  -> para mantenimiento
router.get('/assets/con-falla', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM v_assets_con_falla');
  res.json(result.rows);
});

module.exports = router;
