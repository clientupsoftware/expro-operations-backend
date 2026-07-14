// demo.routes.js
// Rutas exclusivas del entorno de demostracion. Este archivo solo se monta en server.js
// si DEMO_MODE=true, para que en produccion ni siquiera exista la ruta.
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');
const { seedDemo } = require('./seed_demo');

const router = express.Router();
router.use(requireAuth);

// Todas las tablas de datos (no catalogos de sistema como "settings").
// RESTART IDENTITY CASCADE reinicia los ids y arrasa con las FKs sin importar el orden.
const TABLES = [
  'asset_maintenance_log', 'asset_run_resets', 'asset_runs', 'assets',
  'bundle_stage_assets', 'bundle_stages', 'clients', 'crews',
  'daily_board_assignments', 'daily_board_crew', 'daily_board_entries', 'equipment_catalog',
  'failure_report_assets', 'failure_report_photos', 'failure_reports',
  'job_assets', 'job_peripheral_options', 'job_peripherals', 'job_services', 'job_wells', 'jobs',
  'kit_template_items', 'kit_templates', 'maintenance_rules', 'pads',
  'personnel', 'personnel_positions', 'personnel_status_overrides', 'physical_units',
  'required_tools', 'services', 'shipping_list_items', 'shipping_lists',
  'time_report_line_assets', 'time_report_lines', 'time_report_operations', 'time_reports',
  'unit_types', 'users', 'wells'
];

// POST /api/demo/reset - borra todos los datos y vuelve a cargar el seed ficticio.
// Solo Super. La confirmacion de contraseña la hace el frontend antes de llamar aca
// (mismo patron que el borrado de Jobs: PasswordConfirmModal -> /api/auth/verify-password).
router.post('/reset', requireRole('super'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Error al vaciar los datos del demo.' });
  } finally {
    client.release();
  }

  try {
    await seedDemo(pool);
    res.json({ message: 'Demo reseteado y datos ficticios recargados correctamente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Se vaciaron los datos pero fallo la recarga del seed. Revisar logs.' });
  }
});

module.exports = router;
