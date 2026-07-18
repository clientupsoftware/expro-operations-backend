// failureReports.routes.js
const express = require('express');
const router = express.Router();
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { exportFailureReportToWord } = require('./failureReportExport');
const { sendFailureReportNotification } = require('./emailService');

// GET /api/failure-reports/:id  -> detalle completo con assets y fotos
// GET /api/failure-reports/by-line/:lineId - lista liviana de los reportes ya cargados
// para una linea del Reporte de Tiempos (puede haber mas de uno - varios eventos en la misma linea).
router.get('/by-line/:lineId', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, event_datetime, npt, clasificacion_nivel, estado
     FROM failure_reports WHERE time_report_line_id = $1
     ORDER BY created_at DESC`,
    [req.params.lineId]
  );
  res.json(result.rows);
});

// GET /api/failure-reports/by-stage/:stageId - lo mismo que by-line, pero para una etapa
// de Bundle P&P en vez de una linea de On Call.
router.get('/by-stage/:stageId', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, event_datetime, npt, clasificacion_nivel, estado
     FROM failure_reports WHERE bundle_stage_id = $1
     ORDER BY created_at DESC`,
    [req.params.stageId]
  );
  res.json(result.rows);
});

// GET /api/failure-reports/notify-emails - lista de emails que reciben aviso al crear un reporte
// (declarada antes de /:id a proposito: si no, /:id la intercepta interpretando "notify-emails" como un id)
router.get('/notify-emails', requireAuth, async (req, res) => {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'failure_report_notify_emails'`);
  const emails = result.rows[0]?.value
    ? result.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
  res.json({ emails });
});

// PUT /api/failure-reports/notify-emails - actualiza la lista (array de strings)
router.put('/notify-emails', requireAuth, async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails (array) es requerido.' });
  const value = emails.map((e) => e.trim()).filter(Boolean).join(',');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('failure_report_notify_emails', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [value]
  );
  res.json({ emails: value.split(',').filter(Boolean) });
});

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

// POST /api/failure-reports  -> crear, precargando campos verdes desde el job/linea (o etapa)
router.post('/', requireAuth, async (req, res) => {
  const {
    job_id, time_report_line_id, bundle_stage_id, event_datetime,
    supervisor_id, cliente_id, pozo_etapa,
    npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
    clasificacion_nivel, causa_raiz, accion_correctiva,
    responsable_seguimiento_id, fecha_cierre,
    asset_ids // ya viene filtrado en frontend al subset de assets de esa linea/etapa
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertReport = await client.query(
      `INSERT INTO failure_reports
       (job_id, time_report_line_id, bundle_stage_id, event_datetime, supervisor_id, cliente_id, pozo_etapa,
        npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
        clasificacion_nivel, causa_raiz, accion_correctiva, responsable_seguimiento_id,
        fecha_cierre, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [job_id, time_report_line_id || null, bundle_stage_id || null, event_datetime, supervisor_id, cliente_id, pozo_etapa,
       npt, descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas,
       clasificacion_nivel, causa_raiz, accion_correctiva, responsable_seguimiento_id,
       fecha_cierre, req.user.id]
    );
    const reportId = insertReport.rows[0].id;

    // Assets fallados: acotados al subset de assets ya usados en esa linea o etapa.
    if (asset_ids?.length) {
      let validIds = [];
      if (time_report_line_id) {
        const validAssets = await client.query(
          `SELECT asset_id FROM time_report_line_assets
           WHERE time_report_line_id = $1 AND asset_id = ANY($2::int[])`,
          [time_report_line_id, asset_ids]
        );
        validIds = validAssets.rows.map(r => r.asset_id);
      } else if (bundle_stage_id) {
        const validAssets = await client.query(
          `SELECT asset_id FROM bundle_stage_assets
           WHERE bundle_stage_id = $1 AND asset_id = ANY($2::int[])`,
          [bundle_stage_id, asset_ids]
        );
        validIds = validAssets.rows.map(r => r.asset_id);
      }
      for (const assetId of validIds) {
        await client.query(
          'INSERT INTO failure_report_assets (failure_report_id, asset_id) VALUES ($1, $2)',
          [reportId, assetId]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: reportId });

    // Notificacion por mail: mejor esfuerzo, no bloquea ni hace fallar la respuesta si algo sale mal.
    try {
      const settingResult = await pool.query(
        `SELECT value FROM settings WHERE key = 'failure_report_notify_emails'`
      );
      const recipients = settingResult.rows[0]?.value
        ? settingResult.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
        : [];
      if (recipients.length > 0) {
        await sendFailureReportNotification(
          { event_datetime, pozo_etapa, npt, clasificacion_nivel, descripcion_que_sucedio },
          recipients
        );
      }
    } catch (emailErr) {
      console.error('No se pudo enviar la notificacion por mail del reporte de falla:', emailErr.message);
    }
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
  const hasAssetIds = Array.isArray(fields.asset_ids);
  if (!setClauses.length && !hasAssetIds) {
    return res.status(400).json({ error: 'Sin campos para actualizar' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (setClauses.length) {
      values.push(id);
      await client.query(
        `UPDATE failure_reports SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values
      );
    }

    if (hasAssetIds) {
      const reportResult = await client.query('SELECT time_report_line_id, bundle_stage_id FROM failure_reports WHERE id = $1', [id]);
      if (reportResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Reporte no encontrado.' });
      }
      const { time_report_line_id: lineId, bundle_stage_id: stageId } = reportResult.rows[0];

      await client.query('DELETE FROM failure_report_assets WHERE failure_report_id = $1', [id]);

      let validAssets;
      if (lineId) {
        validAssets = await client.query(
          `SELECT asset_id FROM time_report_line_assets WHERE time_report_line_id = $1 AND asset_id = ANY($2::int[])`,
          [lineId, fields.asset_ids]
        );
      } else if (stageId) {
        validAssets = await client.query(
          `SELECT asset_id FROM bundle_stage_assets WHERE bundle_stage_id = $1 AND asset_id = ANY($2::int[])`,
          [stageId, fields.asset_ids]
        );
      } else {
        validAssets = { rows: [] };
      }
      for (const row of validAssets.rows) {
        await client.query(
          'INSERT INTO failure_report_assets (failure_report_id, asset_id) VALUES ($1, $2)',
          [id, row.asset_id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el reporte de falla.' });
  } finally {
    client.release();
  }
});

// GET /api/failure-reports/:id/export
// DELETE /api/failure-reports/:id - por si se cargo por error; borra en cascada sus assets y fotos
router.delete('/:id', requireAuth, async (req, res) => {
  const result = await pool.query('DELETE FROM failure_reports WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado.' });
  res.status(204).send();
});

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
