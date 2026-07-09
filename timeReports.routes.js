const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// Suma 1 carrera a cada asset_id de la lista (asset_runs + cumulative_runs)
async function registerRuns(client, assetIds, jobId, source) {
  for (const assetId of assetIds) {
    await client.query(
      'INSERT INTO asset_runs (asset_id, job_id, source) VALUES ($1, $2, $3)',
      [assetId, jobId, source]
    );
    await client.query(
      'UPDATE assets SET cumulative_runs = cumulative_runs + 1 WHERE id = $1',
      [assetId]
    );
  }
}

// GET /api/time-reports/:jobId - reportes existentes de un job
router.get('/:jobId', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM time_reports WHERE job_id = $1 ORDER BY created_at',
    [req.params.jobId]
  );
  res.json(result.rows);
});

// POST /api/time-reports/:jobId - el ingeniero elige el tipo de reporte al empezar
router.post('/:jobId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { report_type } = req.body; // 'on_call' | 'bundle_pp'
  if (!['on_call', 'bundle_pp'].includes(report_type)) {
    return res.status(400).json({ error: "report_type debe ser 'on_call' o 'bundle_pp'." });
  }
  const result = await pool.query(
    'INSERT INTO time_reports (job_id, report_type, created_by) VALUES ($1, $2, $3) RETURNING *',
    [req.params.jobId, report_type, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// ================= ON CALL =================

// GET /api/time-reports/on-call/:reportId/lines
router.get('/on-call/:reportId/lines', async (req, res) => {
  const linesResult = await pool.query(
    'SELECT * FROM time_report_lines WHERE time_report_id = $1 ORDER BY id',
    [req.params.reportId]
  );
  const assetsResult = await pool.query(`
    SELECT time_report_line_assets.*, assets.description, assets.sap_equipment_code
    FROM time_report_line_assets
    JOIN assets ON assets.id = time_report_line_assets.asset_id
    WHERE time_report_line_id = ANY($1::int[])
  `, [linesResult.rows.map((l) => l.id)]);

  const lines = linesResult.rows.map((line) => ({
    ...line,
    assets: assetsResult.rows.filter((a) => a.time_report_line_id === line.id)
  }));
  res.json(lines);
});

// GET /api/time-reports/on-call/:reportId/lines/prefill
// Devuelve los assets de la ULTIMA linea cargada, para que el frontend pre-cargue el form
// de la nueva linea (comportamiento pedido: "arrastrar" truck/set de presion entre corridas).
router.get('/on-call/:reportId/lines/prefill', async (req, res) => {
  const lastLine = await pool.query(
    'SELECT id FROM time_report_lines WHERE time_report_id = $1 ORDER BY id DESC LIMIT 1',
    [req.params.reportId]
  );
  if (lastLine.rows.length === 0) return res.json({ assets: [] });

  const assetsResult = await pool.query(`
    SELECT time_report_line_assets.asset_id, time_report_line_assets.string_label,
           assets.description, assets.sap_equipment_code
    FROM time_report_line_assets
    JOIN assets ON assets.id = time_report_line_assets.asset_id
    WHERE time_report_line_id = $1
  `, [lastLine.rows[0].id]);

  res.json({ assets: assetsResult.rows });
});

// POST /api/time-reports/on-call/:reportId/lines
// body: { fecha, desde, hasta, actividad, operacion, evento_misrun, profundidad_desde,
//         profundidad_hasta, comentarios, is_run, asset_ids: [{asset_id, string_label}] }
// Si "asset_ids" no viene en el body, se pre-cargan automaticamente los de la ultima linea.
router.post('/on-call/:reportId/lines', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { reportId } = req.params;
  const {
    fecha, desde, hasta, actividad, operacion, evento_misrun,
    profundidad_desde, profundidad_hasta, comentarios, is_run
  } = req.body;
  let { asset_ids } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pre-carga automatica de la linea anterior si no se especificaron assets
    if (asset_ids === undefined) {
      const lastLine = await client.query(
        'SELECT id FROM time_report_lines WHERE time_report_id = $1 ORDER BY id DESC LIMIT 1',
        [reportId]
      );
      if (lastLine.rows.length > 0) {
        const prevAssets = await client.query(
          'SELECT asset_id, string_label FROM time_report_line_assets WHERE time_report_line_id = $1',
          [lastLine.rows[0].id]
        );
        asset_ids = prevAssets.rows;
      } else {
        asset_ids = [];
      }
    }

    const lineResult = await client.query(
      `INSERT INTO time_report_lines (
         time_report_id, fecha, desde, hasta, actividad, operacion, evento_misrun,
         profundidad_desde, profundidad_hasta, comentarios, is_run, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [reportId, fecha, desde, hasta, actividad, operacion, evento_misrun || false,
       profundidad_desde || null, profundidad_hasta || null, comentarios || null,
       is_run || false, req.user.id]
    );
    const line = lineResult.rows[0];

    for (const item of asset_ids) {
      await client.query(
        'INSERT INTO time_report_line_assets (time_report_line_id, asset_id, string_label) VALUES ($1, $2, $3)',
        [line.id, item.asset_id, item.string_label || null]
      );
    }

    // Si la linea representa una carrera completa, sumamos 1 a cada asset involucrado
    if (is_run && asset_ids.length > 0) {
      const jobResult = await client.query('SELECT job_id FROM time_reports WHERE id = $1', [reportId]);
      await registerRuns(client, asset_ids.map((a) => a.asset_id), jobResult.rows[0].job_id, 'on_call_line');
    }

    await client.query('COMMIT');
    res.status(201).json({ ...line, assets: asset_ids });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la linea del reporte.' });
  } finally {
    client.release();
  }
});

// ================= BUNDLE P&P =================

// GET /api/time-reports/bundle/:reportId/stages
router.get('/bundle/:reportId/stages', async (req, res) => {
  const stagesResult = await pool.query(
    'SELECT * FROM bundle_stages WHERE time_report_id = $1 ORDER BY stage_number',
    [req.params.reportId]
  );
  const assetsResult = await pool.query(`
    SELECT bundle_stage_assets.*, assets.description, assets.sap_equipment_code
    FROM bundle_stage_assets
    JOIN assets ON assets.id = bundle_stage_assets.asset_id
    WHERE bundle_stage_id = ANY($1::int[])
  `, [stagesResult.rows.map((s) => s.id)]);

  const stages = stagesResult.rows.map((stage) => ({
    ...stage,
    assets: assetsResult.rows.filter((a) => a.bundle_stage_id === stage.id)
  }));
  res.json(stages);
});

// POST /api/time-reports/bundle/:reportId/stages
// Cada Stage se considera automaticamente una carrera completa para los assets involucrados.
router.post('/bundle/:reportId/stages', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { reportId } = req.params;
  const body = req.body;
  const { asset_ids } = body; // [{asset_id, string_label}]

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lastStage = await client.query(
      'SELECT COALESCE(MAX(stage_number), 0) AS max_stage FROM bundle_stages WHERE time_report_id = $1',
      [reportId]
    );
    const nextStageNumber = lastStage.rows[0].max_stage + 1;

    const stageResult = await client.query(
      `INSERT INTO bundle_stages (
         time_report_id, well_id, stage_number, fecha, plug_type, plug_size, gun_od,
         charge_type, spf, charge_qty, gun_qty, engineer, crew_leader,
         crew_member_2, crew_member_3, crew_member_4,
         time_well_to_wl, time_rih, time_start_pump_down, time_poo,
         time_bha_in_lubricator, time_well_return, well_pressure,
         plug_problem, hse_issue, misfire, comentarios, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [reportId, body.well_id || null, nextStageNumber, body.fecha || null,
       body.plug_type || null, body.plug_size || null, body.gun_od || null,
       body.charge_type || null, body.spf || null, body.charge_qty || null, body.gun_qty || null,
       body.engineer || null, body.crew_leader || null,
       body.crew_member_2 || null, body.crew_member_3 || null, body.crew_member_4 || null,
       body.time_well_to_wl || null, body.time_rih || null, body.time_start_pump_down || null,
       body.time_poo || null, body.time_bha_in_lubricator || null, body.time_well_return || null,
       body.well_pressure || null, body.plug_problem || false, body.hse_issue || false,
       body.misfire || false, body.comentarios || null, req.user.id]
    );
    const stage = stageResult.rows[0];

    const assetsToLink = asset_ids || [];
    for (const item of assetsToLink) {
      await client.query(
        'INSERT INTO bundle_stage_assets (bundle_stage_id, asset_id, string_label) VALUES ($1, $2, $3)',
        [stage.id, item.asset_id, item.string_label || null]
      );
    }

    if (assetsToLink.length > 0) {
      const jobResult = await client.query('SELECT job_id FROM time_reports WHERE id = $1', [reportId]);
      await registerRuns(client, assetsToLink.map((a) => a.asset_id), jobResult.rows[0].job_id, 'bundle_stage');
    }

    await client.query('COMMIT');
    res.status(201).json({ ...stage, assets: assetsToLink });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la stage.' });
  } finally {
    client.release();
  }
});

module.exports = router;
