const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/maintenance/rules?equipment_catalog_id=5 - todos ven las reglas
router.get('/rules', async (req, res) => {
  const { equipment_catalog_id } = req.query;
  const query = equipment_catalog_id
    ? { text: 'SELECT * FROM maintenance_rules WHERE equipment_catalog_id = $1 ORDER BY level', values: [equipment_catalog_id] }
    : { text: 'SELECT * FROM maintenance_rules ORDER BY equipment_catalog_id, level', values: [] };
  const result = await pool.query(query);
  res.json(result.rows);
});

// POST /api/maintenance/rules (solo Mantenimiento)
router.post('/rules', requireRole('mantenimiento'), async (req, res) => {
  const { equipment_catalog_id, level, trigger_type, trigger_value, execution_location, task_description } = req.body;
  if (!equipment_catalog_id || !level || !trigger_type) {
    return res.status(400).json({ error: 'equipment_catalog_id, level y trigger_type son requeridos.' });
  }
  const result = await pool.query(
    `INSERT INTO maintenance_rules (equipment_catalog_id, level, trigger_type, trigger_value, execution_location, task_description)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [equipment_catalog_id, level, trigger_type, trigger_value || null, execution_location || null, task_description || null]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/rules/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM maintenance_rules WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// GET /api/maintenance/status/:assetId
// Devuelve, para cada regla del modelo de ese asset, cuantas carreras lleva acumuladas
// desde el ultimo mantenimiento de ese nivel, y si ya esta vencido.
router.get('/status/:assetId', async (req, res) => {
  const assetResult = await pool.query('SELECT * FROM assets WHERE id = $1', [req.params.assetId]);
  if (assetResult.rows.length === 0) return res.status(404).json({ error: 'Asset no encontrado.' });
  const asset = assetResult.rows[0];

  const rulesResult = await pool.query(
    'SELECT * FROM maintenance_rules WHERE equipment_catalog_id = $1',
    [asset.equipment_catalog_id]
  );

  const status = [];
  for (const rule of rulesResult.rows) {
    const lastLog = await pool.query(
      `SELECT * FROM asset_maintenance_log
       WHERE asset_id = $1 AND maintenance_rule_id = $2
       ORDER BY performed_at DESC LIMIT 1`,
      [asset.id, rule.id]
    );
    const runsAtLastMaintenance = lastLog.rows[0] ? lastLog.rows[0].runs_at_time : 0;
    const operationsAtLastMaintenance = lastLog.rows[0] ? (lastLog.rows[0].operations_at_time || 0) : 0;
    const runsSince = asset.cumulative_runs - runsAtLastMaintenance;
    const operationsSince = asset.cumulative_operations - operationsAtLastMaintenance;

    status.push({
      rule_id: rule.id,
      level: rule.level,
      trigger_type: rule.trigger_type,
      trigger_value: rule.trigger_value,
      execution_location: rule.execution_location,
      task_description: rule.task_description,
      runs_since_last_maintenance: rule.trigger_type === 'runs' ? runsSince : null,
      operations_since_last_maintenance: rule.trigger_type === 'operaciones' ? operationsSince : null,
      due: rule.trigger_type === 'runs' && rule.trigger_value ? runsSince >= rule.trigger_value
         : rule.trigger_type === 'operaciones' && rule.trigger_value ? operationsSince >= rule.trigger_value
         : null
    });
  }

  res.json({
    asset_id: asset.id,
    cumulative_runs: asset.cumulative_runs,
    cumulative_operations: asset.cumulative_operations,
    maintenance_status: status
  });
});

// POST /api/maintenance/log - registrar que se realizo un mantenimiento (solo Mantenimiento)
router.post('/log', requireRole('mantenimiento'), async (req, res) => {
  const { asset_id, maintenance_rule_id, notes } = req.body;
  if (!asset_id || !maintenance_rule_id) {
    return res.status(400).json({ error: 'asset_id y maintenance_rule_id son requeridos.' });
  }
  const assetResult = await pool.query('SELECT cumulative_runs, cumulative_operations FROM assets WHERE id = $1', [asset_id]);
  if (assetResult.rows.length === 0) return res.status(404).json({ error: 'Asset no encontrado.' });

  const result = await pool.query(
    `INSERT INTO asset_maintenance_log (asset_id, maintenance_rule_id, runs_at_time, operations_at_time, notes, logged_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [asset_id, maintenance_rule_id, assetResult.rows[0].cumulative_runs, assetResult.rows[0].cumulative_operations, notes || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;
