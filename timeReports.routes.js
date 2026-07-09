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

// GET /api/time-reports/on-call/:reportId/export - descarga el .xlsx con el formato real
// (Wireline Daily Operations Report)
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
  const sheet = workbook.addWorksheet('RT');

  const bold = { bold: true };
  function set(coord, value, opts = {}) {
    const cell = sheet.getCell(coord);
    cell.value = value;
    if (opts.bold) cell.font = bold;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
  }

  set('G2', 'Wireline Daily Operations Report', { bold: true });
  set('B4', 'Global - Well Intervention', { bold: true });

  set('B6', 'Rig Name'); set('E6', report.rig_name);
  set('J6', 'Well Name/Number'); set('K6', pozoNombre);
  set('M6', 'Report Date'); set('N6', report.created_at, { numFmt: 'dd/mm/yyyy' });

  set('B8', 'Well status'); set('E8', report.well_status);
  set('J8', 'Shut In Tubing Pressure'); set('K8', report.shut_in_tubing_pressure);
  set('M8', 'Shut In Casing Pressure');

  set('B10', 'Flowing Tubing Head Pressure'); set('E10', report.flowing_thp);
  set('I10', 'Well Head Condition');
  set('M10', 'Ticket Num');

  set('B12', 'Job Objective'); set('E12', report.job_objective || report.service_name);
  set('M12', 'Contract Number');

  set('B14', 'Client Company Man'); set('E14', report.representante_cliente);
  set('J14', 'Note:'); set('K14', 'Specific Depth and Pressure Units used should be entered where applicable.');

  set('B15', 'Completion Supervisor'); set('H15', 'W/L Supervisor (Day)'); set('J15', report.supervisor_dia);
  set('L15', 'W/L Supervisor (Night)'); set('M15', report.supervisor_noche);
  set('B16', 'Senior Technician (Day)'); set('H16', 'W/L Operator (Day)'); set('J16', report.guinchero_dia);
  set('L16', 'W/L Operator (Night)'); set('M16', report.guinchero_noche);
  set('B17', 'Senior Technician (Night)'); set('H17', 'W/L Assistant (Day)'); set('J17', report.asistente_dia);
  set('L17', 'W/L Assistant (Night)'); set('M17', report.asistente_noche);

  set('B18', `JOB SUMMARY: ${report.job_objective || report.service_name || ''}`, { bold: true });

  const unidadesLine = `Unidad Liviana: ${report.unidad_liviana || '-'}      Unidad de carga: ${report.unidad_carga || '-'}      Unidad de WL: ${report.unidad_wl || '-'}`;
  set('B19', unidadesLine);

  set('C22', 'FROM', { bold: true });
  set('D22', 'TO', { bold: true });
  set('E22', 'TIME', { bold: true });
  set('F22', 'THP', { bold: true });
  set('G22', 'Fluid Level', { bold: true });
  set('H22', 'COMMENTS', { bold: true });
  set('M22', 'Weight (lbs)', { bold: true });
  set('N22', 'Depth & Reference Point', { bold: true });

  let rowIndex = 23;
  let lastFecha = null;
  for (const line of linesResult.rows) {
    const fechaStr = line.fecha ? new Date(line.fecha).toISOString().slice(0, 10) : null;
    const row = sheet.getRow(rowIndex);
    if (fechaStr !== lastFecha) {
      row.getCell(2).value = line.fecha; // B
      row.getCell(2).numFmt = 'dd/mm/yyyy';
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

  const footerStart = rowIndex + 2;
  set(`B${footerStart}`, 'Winch WLS Number'); set(`H${footerStart}`, 'Mast WLS Number');
  set(`J${footerStart}`, 'Daily Number of Runs'); set(`L${footerStart}`, 'Accumulative Wire Distance Run (m)');

  set(`B${footerStart + 2}`, 'Power Pack WLS Number'); set(`E${footerStart + 2}`, report.power_pack);
  set(`H${footerStart + 2}`, 'BOP WLS Number');
  set(`J${footerStart + 2}`, 'Mis-runs'); set(`K${footerStart + 2}`, misrunCount);
  set(`L${footerStart + 2}`, 'Daily Wire Hrs.');

  set(`B${footerStart + 4}`, 'Wire Type & Size'); set(`E${footerStart + 4}`, report.wire_type_size);
  set(`H${footerStart + 4}`, 'Rear Wire Drum Number');
  set(`J${footerStart + 4}`, 'Max Drag (lbs)'); set(`L${footerStart + 4}`, 'Accumulative Wire Runs during Operation');

  set(`B${footerStart + 6}`, 'Wrap / Twist Test Turns Achieved'); set(`H${footerStart + 6}`, 'Front Wire Drum Number');
  set(`J${footerStart + 6}`, 'Max Drag Depth'); set(`L${footerStart + 6}`, 'Accumulative Wireline Hours during operation');

  set(`B${footerStart + 8}`, 'Wire Length Discarded'); set(`L${footerStart + 8}`, 'Accumulative Engine Hours During operation.');
  set(`B${footerStart + 10}`, "Wire length remaining on drum after cut off's");

  set(`B${footerStart + 12}`, 'Consumables Used:'); set(`E${footerStart + 12}`, report.consumables_used);
  set(`B${footerStart + 13}`, 'Positive Intervention Cards:');

  set(`B${footerStart + 14}`, 'Client Representative', { bold: true });
  set(`I${footerStart + 14}`, 'Expro Representative', { bold: true });
  set(`E${footerStart + 16}`, report.representante_cliente);
  set(`L${footerStart + 16}`, report.expro_representante);
  set(`D${footerStart + 17}`, 'Name:'); set(`J${footerStart + 17}`, 'Name:');
  set(`D${footerStart + 19}`, 'Signature:'); set(`K${footerStart + 19}`, 'Signature:');
  set(`D${footerStart + 21}`, 'Date:'); set(`K${footerStart + 21}`, 'Date:');

  sheet.columns.forEach((col) => { col.width = 15; });
  sheet.getColumn(8).width = 45; // H: comentarios/narrativa

  const pozoParaNombre = pozoNombre.split(',')[0] || 'job';
  const filename = `Reporte_de_tiempos-${pozoParaNombre}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '');

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
