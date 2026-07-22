const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();
router.use(requireAuth);

function dateRange(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const fromDefault = new Date();
  fromDefault.setDate(fromDefault.getDate() - 30);
  const from = req.query.from || fromDefault.toISOString().slice(0, 10);
  return { from, to };
}

// ================= OPERACIONES (Parte Diario) =================
router.get('/operations', async (req, res) => {
  const { from, to } = dateRange(req);

  const porEstado = await pool.query(
    `SELECT estado, COUNT(*)::int AS cantidad
     FROM daily_board_entries
     WHERE fecha_inicio <= $2 AND COALESCE(fecha_fin, fecha_inicio) >= $1
     GROUP BY estado`,
    [from, to]
  );

  // Tendencia dia por dia: se expande cada entrada a todos los dias de su rango que caen
  // dentro de la ventana pedida, asi un trabajo de varios dias cuenta en cada uno de ellos.
  const tendencia = await pool.query(
    `SELECT d::date AS fecha, daily_board_entries.estado, COUNT(*)::int AS cantidad
     FROM generate_series($1::date, $2::date, interval '1 day') AS d
     JOIN daily_board_entries
       ON d::date BETWEEN daily_board_entries.fecha_inicio AND COALESCE(daily_board_entries.fecha_fin, daily_board_entries.fecha_inicio)
     GROUP BY d, daily_board_entries.estado
     ORDER BY d`,
    [from, to]
  );

  const porCliente = await pool.query(
    `SELECT COALESCE(clients.name, 'Sin cliente') AS cliente, COUNT(*)::int AS cantidad
     FROM daily_board_entries
     LEFT JOIN clients ON clients.id = daily_board_entries.client_id
     WHERE daily_board_entries.fecha_inicio <= $2 AND COALESCE(daily_board_entries.fecha_fin, daily_board_entries.fecha_inicio) >= $1
     GROUP BY clients.name
     ORDER BY cantidad DESC
     LIMIT 10`,
    [from, to]
  );

  const total = await pool.query(
    `SELECT COUNT(*)::int AS total FROM daily_board_entries
     WHERE fecha_inicio <= $2 AND COALESCE(fecha_fin, fecha_inicio) >= $1`,
    [from, to]
  );

  res.json({
    from, to,
    total: total.rows[0].total,
    porEstado: porEstado.rows,
    tendencia: tendencia.rows,
    porCliente: porCliente.rows
  });
});

// ================= ASSETS =================
router.get('/assets', async (req, res) => {
  const porTipo = await pool.query(
    `SELECT COALESCE(equipment_type, 'Sin tipo') AS tipo, COUNT(*)::int AS cantidad
     FROM assets
     GROUP BY equipment_type
     ORDER BY cantidad DESC`
  );

  const topUso = await pool.query(
    `SELECT sap_equipment_code, description, cumulative_runs, cumulative_operations
     FROM assets
     ORDER BY cumulative_runs DESC NULLS LAST
     LIMIT 10`
  );

  const conFalla = await pool.query(
    `SELECT COALESCE(a.equipment_type, 'Sin tipo') AS tipo, COUNT(DISTINCT a.id)::int AS cantidad
     FROM assets a
     JOIN failure_report_assets fra ON fra.asset_id = a.id
     GROUP BY a.equipment_type
     ORDER BY cantidad DESC`
  );

  const totales = await pool.query(`SELECT COUNT(*)::int AS total FROM assets`);
  const totalConFalla = await pool.query(`SELECT COUNT(DISTINCT asset_id)::int AS total FROM failure_report_assets`);

  res.json({
    total: totales.rows[0].total,
    totalConFalla: totalConFalla.rows[0].total,
    porTipo: porTipo.rows,
    topUso: topUso.rows,
    conFallaPorTipo: conFalla.rows
  });
});

// ================= REPORTES DE FALLA =================
router.get('/failures', async (req, res) => {
  const { from, to } = dateRange(req);

  const porNivel = await pool.query(
    `SELECT COALESCE(clasificacion_nivel, 'Sin clasificar') AS nivel, COUNT(*)::int AS cantidad
     FROM failure_reports
     WHERE event_datetime::date BETWEEN $1 AND $2
     GROUP BY clasificacion_nivel`,
    [from, to]
  );

  const porEstado = await pool.query(
    `SELECT estado, COUNT(*)::int AS cantidad
     FROM failure_reports
     WHERE event_datetime::date BETWEEN $1 AND $2
     GROUP BY estado`,
    [from, to]
  );

  const tendenciaMensual = await pool.query(
    `SELECT to_char(date_trunc('month', event_datetime), 'YYYY-MM') AS mes, COUNT(*)::int AS cantidad
     FROM failure_reports
     WHERE event_datetime::date BETWEEN $1 AND $2
     GROUP BY 1
     ORDER BY 1`,
    [from, to]
  );

  const porCliente = await pool.query(
    `SELECT COALESCE(clients.name, 'Sin cliente') AS cliente, COUNT(*)::int AS cantidad
     FROM failure_reports
     LEFT JOIN clients ON clients.id = failure_reports.cliente_id
     WHERE failure_reports.event_datetime::date BETWEEN $1 AND $2
     GROUP BY clients.name
     ORDER BY cantidad DESC
     LIMIT 10`,
    [from, to]
  );

  const total = await pool.query(
    `SELECT COUNT(*)::int AS total FROM failure_reports WHERE event_datetime::date BETWEEN $1 AND $2`,
    [from, to]
  );

  res.json({
    from, to,
    total: total.rows[0].total,
    porNivel: porNivel.rows,
    porEstado: porEstado.rows,
    tendenciaMensual: tendenciaMensual.rows,
    porCliente: porCliente.rows
  });
});

// ================= PERSONAL (breakdown, complementa /api/personnel/stats) =================
router.get('/personnel-breakdown', async (req, res) => {
  const porPuesto = await pool.query(
    `SELECT COALESCE(puesto, 'Sin puesto') AS puesto, COUNT(*)::int AS cantidad
     FROM personnel WHERE active = true
     GROUP BY puesto ORDER BY cantidad DESC`
  );
  const porConvenio = await pool.query(
    `SELECT COALESCE(convenio, 'Sin convenio') AS convenio, COUNT(*)::int AS cantidad
     FROM personnel WHERE active = true
     GROUP BY convenio ORDER BY cantidad DESC`
  );
  const porCuadrilla = await pool.query(
    `SELECT COALESCE(crews.name, 'Sin cuadrilla') AS cuadrilla, COUNT(*)::int AS cantidad
     FROM personnel
     LEFT JOIN crews ON crews.id = personnel.crew_id
     WHERE personnel.active = true
     GROUP BY crews.name ORDER BY cantidad DESC`
  );

  res.json({ porPuesto: porPuesto.rows, porConvenio: porConvenio.rows, porCuadrilla: porCuadrilla.rows });
});

module.exports = router;
