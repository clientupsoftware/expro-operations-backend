const express = require('express');
const path = require('path');
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

// Resta 1 carrera a cada asset_id (al editar/eliminar una linea que era una carrera)
async function unregisterRuns(client, assetIds, jobId, source) {
  for (const assetId of assetIds) {
    const lastRun = await client.query(
      `SELECT id FROM asset_runs WHERE asset_id = $1 AND job_id = $2 AND source = $3
       ORDER BY id DESC LIMIT 1`,
      [assetId, jobId, source]
    );
    if (lastRun.rows.length > 0) {
      await client.query('DELETE FROM asset_runs WHERE id = $1', [lastRun.rows[0].id]);
    }
    await client.query(
      'UPDATE assets SET cumulative_runs = GREATEST(cumulative_runs - 1, 0) WHERE id = $1',
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
    'SELECT id, hasta FROM time_report_lines WHERE time_report_id = $1 ORDER BY id DESC LIMIT 1',
    [req.params.reportId]
  );
  if (lastLine.rows.length === 0) return res.json({ assets: [], ultima_hasta: null });

  const assetsResult = await pool.query(`
    SELECT time_report_line_assets.asset_id, time_report_line_assets.string_label,
           assets.description, assets.sap_equipment_code
    FROM time_report_line_assets
    JOIN assets ON assets.id = time_report_line_assets.asset_id
    WHERE time_report_line_id = $1
  `, [lastLine.rows[0].id]);

  res.json({ assets: assetsResult.rows, ultima_hasta: lastLine.rows[0].hasta });
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

// PATCH /api/time-reports/on-call/lines/:lineId - editar una linea existente
router.patch('/on-call/lines/:lineId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { lineId } = req.params;
  const {
    fecha, desde, hasta, actividad, operacion, evento_misrun,
    profundidad_desde, profundidad_hasta, comentarios, is_run, asset_ids
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT time_report_lines.*, time_reports.job_id
       FROM time_report_lines
       JOIN time_reports ON time_reports.id = time_report_lines.time_report_id
       WHERE time_report_lines.id = $1`,
      [lineId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Linea no encontrada.' });
    }
    const oldLine = existing.rows[0];

    const oldAssetsResult = await client.query(
      'SELECT asset_id FROM time_report_line_assets WHERE time_report_line_id = $1',
      [lineId]
    );
    const oldAssetIds = oldAssetsResult.rows.map((r) => r.asset_id);
    const newAssetIds = Array.isArray(asset_ids) ? asset_ids.map((a) => a.asset_id) : oldAssetIds;
    const newIsRun = is_run !== undefined ? is_run : oldLine.is_run;

    // Ajustar contador de carreras segun lo que cambio
    const oldCounted = oldLine.is_run ? oldAssetIds : [];
    const newCounted = newIsRun ? newAssetIds : [];
    const toRemove = oldCounted.filter((id) => !newCounted.includes(id));
    const toAdd = newCounted.filter((id) => !oldCounted.includes(id));
    if (toRemove.length > 0) await unregisterRuns(client, toRemove, oldLine.job_id, 'on_call_line');
    if (toAdd.length > 0) await registerRuns(client, toAdd, oldLine.job_id, 'on_call_line');

    const updated = await client.query(
      `UPDATE time_report_lines SET
         fecha = $1, desde = $2, hasta = $3, actividad = $4, operacion = $5,
         evento_misrun = $6, profundidad_desde = $7, profundidad_hasta = $8,
         comentarios = $9, is_run = $10
       WHERE id = $11 RETURNING *`,
      [fecha, desde, hasta, actividad, operacion, evento_misrun || false,
       profundidad_desde || null, profundidad_hasta || null, comentarios || null,
       newIsRun, lineId]
    );

    if (Array.isArray(asset_ids)) {
      await client.query('DELETE FROM time_report_line_assets WHERE time_report_line_id = $1', [lineId]);
      for (const item of asset_ids) {
        await client.query(
          'INSERT INTO time_report_line_assets (time_report_line_id, asset_id, string_label) VALUES ($1, $2, $3)',
          [lineId, item.asset_id, item.string_label || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al editar la linea.' });
  } finally {
    client.release();
  }
});

// DELETE /api/time-reports/on-call/lines/:lineId
router.delete('/on-call/lines/:lineId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { lineId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT time_report_lines.*, time_reports.job_id
       FROM time_report_lines
       JOIN time_reports ON time_reports.id = time_report_lines.time_report_id
       WHERE time_report_lines.id = $1`,
      [lineId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Linea no encontrada.' });
    }
    const line = existing.rows[0];

    if (line.is_run) {
      const assetsResult = await client.query(
        'SELECT asset_id FROM time_report_line_assets WHERE time_report_line_id = $1',
        [lineId]
      );
      const assetIds = assetsResult.rows.map((r) => r.asset_id);
      if (assetIds.length > 0) await unregisterRuns(client, assetIds, line.job_id, 'on_call_line');
    }

    await client.query('DELETE FROM time_report_lines WHERE id = $1', [lineId]); // cascade borra los assets de la linea

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la linea.' });
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

// ================= ENCABEZADO (para que la exportacion a Excel salga completa) =================

const HEADER_FIELDS = [
  'rig_name', 'well_status', 'shut_in_tubing_pressure', 'flowing_thp', 'job_objective',
  'representante_cliente', 'expro_representante',
  'supervisor_dia', 'guinchero_dia', 'asistente_dia',
  'supervisor_noche', 'guinchero_noche', 'asistente_noche',
  'unidad_liviana', 'unidad_carga', 'unidad_wl',
  'numero_wls', 'power_pack', 'wire_type_size', 'consumables_used'
];

// PATCH /api/time-reports/:reportId/header - guarda los datos de encabezado (opcionales)
router.patch('/:reportId/header', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const setClauses = [];
  const values = [];
  HEADER_FIELDS.forEach((field) => {
    if (field in req.body) {
      values.push(req.body[field] || null);
      setClauses.push(`${field} = $${values.length}`);
    }
  });
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

  values.push(req.params.reportId);
  const result = await pool.query(
    `UPDATE time_reports SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado.' });
  res.json(result.rows[0]);
});

// ================= EXPORTAR A EXCEL (formato real On Call) =================

function toHoursDecimal(desde, hasta) {
  if (!desde || !hasta) return null;
  const [h1, m1] = desde.split(':').map(Number);
  const [h2, m2] = hasta.split(':').map(Number);
  let minutes = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (minutes < 0) minutes += 24 * 60; // cruza medianoche
  return Math.round((minutes / 60) * 100) / 100;
}

function computeIntervalo(desde, hasta) {
  const d = desde !== null && desde !== undefined ? Number(desde) : null;
  const h = hasta !== null && hasta !== undefined ? Number(hasta) : null;
  if (d !== null && h !== null) return Math.abs(d - h);
  if (d !== null) return d;
  return 0;
}

// GET /api/time-reports/on-call/:reportId/export - descarga el .xlsx con el formato real de Expro
// Usa template_on_call.xlsx (tu plantilla real) como base y solo completa los datos.
router.get('/on-call/:reportId/export', async (req, res) => {
  const ExcelJS = require('exceljs');
  const { reportId } = req.params;

  const reportResult = await pool.query(`
    SELECT time_reports.*, jobs.job_number,
           clients.name AS client_name, pads.name AS pad_name, services.name AS service_name
    FROM time_reports
    JOIN jobs ON jobs.id = time_reports.job_id
    JOIN pads ON pads.id = jobs.pad_id
    JOIN clients ON clients.id = pads.client_id
    JOIN services ON services.id = jobs.service_id
    WHERE time_reports.id = $1
  `, [reportId]);
  if (reportResult.rows.length === 0) return res.status(404).json({ error: 'Reporte no encontrado.' });
  const report = reportResult.rows[0];

  const wellsResult = await pool.query(`
    SELECT wells.name FROM wells
    JOIN job_wells ON job_wells.well_id = wells.id
    WHERE job_wells.job_id = $1
  `, [report.job_id]);
  const pozoNombre = wellsResult.rows.map((w) => w.name).join(', ');

  const linesResult = await pool.query(
    'SELECT * FROM time_report_lines WHERE time_report_id = $1 ORDER BY id',
    [reportId]
  );

  const misrunCount = linesResult.rows.filter((l) => l.evento_misrun).length;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(__dirname, 'template_on_call.xlsx'));
  const sheet = workbook.getWorksheet('BIF');

  function set(coord, value) {
    sheet.getCell(coord).value = value === undefined ? null : value;
  }

  set('E6', report.rig_name);
  set('K6', pozoNombre);
  set('N6', report.created_at);

  set('E8', report.well_status);
  set('K8', report.shut_in_tubing_pressure);

  set('E10', report.flowing_thp);
  set('E12', report.job_objective || report.service_name);
  set('E14', report.representante_cliente);

  set('J15', report.supervisor_dia); set('M15', report.supervisor_noche);
  set('J16', report.guinchero_dia); set('M16', report.guinchero_noche);
  set('J17', report.asistente_dia); set('M17', report.asistente_noche);

  set('B18', `JOB SUMMARY: ${report.job_objective || report.service_name || ''}`);
  set('B19', `Unidad Liviana: ${report.unidad_liviana || '-'}      Unidad de carga: ${report.unidad_carga || '-'}      Unidad de WL: ${report.unidad_wl || '-'}`);

  // La tabla de lineas ocupa las filas 23 a 46 en la plantilla (24 lineas).
  // Si el reporte tiene mas lineas, se duplican filas con el mismo estilo antes del pie,
  // para no pisar la parte de firmas/consumibles. Esto corre el pie hacia abajo, por eso
  // las celdas del pie se calculan con el offset "extraRows".
  const TABLE_FIRST_ROW = 23;
  const TABLE_LAST_ROW = 46;
  const availableRows = TABLE_LAST_ROW - TABLE_FIRST_ROW + 1;
  let extraRows = 0;
  if (linesResult.rows.length > availableRows) {
    extraRows = linesResult.rows.length - availableRows;
    sheet.duplicateRow(TABLE_LAST_ROW, extraRows, true);
  }

  let rowIndex = TABLE_FIRST_ROW;
  let lastFecha = null;
  for (const line of linesResult.rows) {
    const fechaStr = line.fecha ? new Date(line.fecha).toISOString().slice(0, 10) : null;
    const row = sheet.getRow(rowIndex);
    if (fechaStr !== lastFecha) {
      row.getCell(2).value = line.fecha; // B
      lastFecha = fechaStr;
    }
    row.getCell(3).value = line.desde;  // C
    row.getCell(4).value = line.hasta;  // D
    row.getCell(5).value = toHoursDecimal(line.desde, line.hasta); // E
    row.getCell(8).value = line.comentarios || [line.actividad, line.operacion].filter(Boolean).join(' - '); // H
    if (line.profundidad_desde !== null || line.profundidad_hasta !== null) {
      const desdeTxt = line.profundidad_desde !== null ? `DESDE ${line.profundidad_desde} m` : '';
      const hastaTxt = line.profundidad_hasta !== null ? `HASTA ${line.profundidad_hasta} m` : '';
      row.getCell(14).value = [desdeTxt, hastaTxt].filter(Boolean).join(' '); // N
    }
    rowIndex += 1;
  }

  set(`E${52 + extraRows}`, report.wire_type_size);
  set(`K${50 + extraRows}`, misrunCount); // Mis-runs
  set(`E${60 + extraRows}`, report.consumables_used);
  set(`E${64 + extraRows}`, report.representante_cliente);
  set(`L${64 + extraRows}`, report.expro_representante);

  const pozoParaNombre = pozoNombre.split(',')[0] || 'job';
  const filename = `Reporte_de_tiempos-${pozoParaNombre}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '');

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
