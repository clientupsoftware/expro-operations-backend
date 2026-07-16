// assetAlerts.routes.js
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/asset-alerts/notify-emails - lista de emails que reciben las alertas de assets
// (declarada antes de /:id para que no la intercepte)
router.get('/notify-emails', async (req, res) => {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'asset_alert_notify_emails'`);
  const emails = result.rows[0]?.value
    ? result.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
  res.json({ emails });
});

router.put('/notify-emails', requireRole('mantenimiento'), async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails (array) es requerido.' });
  const value = emails.map((e) => e.trim()).filter(Boolean).join(',');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('asset_alert_notify_emails', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [value]
  );
  res.json({ emails: value.split(',').filter(Boolean) });
});

// GET /api/asset-alerts - todas las reglas, con sus assets y el estado actual de cada uno
router.get('/', async (req, res) => {
  const rulesResult = await pool.query('SELECT * FROM asset_alert_rules ORDER BY created_at DESC');
  const rules = rulesResult.rows;
  if (rules.length === 0) return res.json([]);

  const assetsResult = await pool.query(`
    SELECT aara.rule_id, a.id AS asset_id, a.sap_equipment_code, a.description,
           a.cumulative_runs, a.cumulative_operations
    FROM asset_alert_rule_assets aara
    JOIN assets a ON a.id = aara.asset_id
  `);

  const withAssets = rules.map((rule) => ({
    ...rule,
    assets: assetsResult.rows
      .filter((a) => a.rule_id === rule.id)
      .map((a) => ({
        asset_id: a.asset_id,
        sap_equipment_code: a.sap_equipment_code,
        description: a.description,
        valor_actual: rule.disparador === 'runs' ? a.cumulative_runs : a.cumulative_operations
      }))
  }));

  res.json(withAssets);
});

// POST /api/asset-alerts - crear una regla nueva. asset_ids: [1,2,3,...]
router.post('/', requireRole('mantenimiento'), async (req, res) => {
  const { nombre, disparador, umbral, asset_ids } = req.body;
  if (!['runs', 'operations'].includes(disparador)) {
    return res.status(400).json({ error: 'disparador debe ser "runs" u "operations".' });
  }
  if (!umbral || umbral <= 0) return res.status(400).json({ error: 'umbral debe ser un numero mayor a 0.' });
  if (!Array.isArray(asset_ids) || asset_ids.length === 0) {
    return res.status(400).json({ error: 'asset_ids (array) es requerido, al menos 1 asset.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ruleResult = await client.query(
      `INSERT INTO asset_alert_rules (nombre, disparador, umbral, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [nombre || null, disparador, umbral, req.user.id]
    );
    const rule = ruleResult.rows[0];

    for (const assetId of asset_ids) {
      await client.query(
        'INSERT INTO asset_alert_rule_assets (rule_id, asset_id) VALUES ($1, $2)',
        [rule.id, assetId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(rule);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la regla de alerta.' });
  } finally {
    client.release();
  }
});

// PATCH /api/asset-alerts/:id - editar nombre/disparador/umbral/activo y/o reemplazar los assets
router.patch('/:id', requireRole('mantenimiento'), async (req, res) => {
  const { id } = req.params;
  const { nombre, disparador, umbral, active, asset_ids } = req.body;

  if (disparador !== undefined && !['runs', 'operations'].includes(disparador)) {
    return res.status(400).json({ error: 'disparador debe ser "runs" u "operations".' });
  }
  if (asset_ids !== undefined && (!Array.isArray(asset_ids) || asset_ids.length === 0)) {
    return res.status(400).json({ error: 'Si mandas asset_ids, tiene que ser un array con al menos 1 elemento.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setClauses = [];
    const values = [];
    if (nombre !== undefined) { values.push(nombre || null); setClauses.push(`nombre = $${values.length}`); }
    if (disparador !== undefined) { values.push(disparador); setClauses.push(`disparador = $${values.length}`); }
    if (umbral !== undefined) { values.push(umbral); setClauses.push(`umbral = $${values.length}`); }
    if (active !== undefined) { values.push(active); setClauses.push(`active = $${values.length}`); }

    let rule;
    if (setClauses.length > 0) {
      values.push(id);
      const result = await client.query(
        `UPDATE asset_alert_rules SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Regla no encontrada.' });
      }
      rule = result.rows[0];
    }

    if (asset_ids !== undefined) {
      await client.query('DELETE FROM asset_alert_rule_assets WHERE rule_id = $1', [id]);
      for (const assetId of asset_ids) {
        await client.query('INSERT INTO asset_alert_rule_assets (rule_id, asset_id) VALUES ($1, $2)', [id, assetId]);
      }
      // si cambio el set de assets, se limpian los avisos ya disparados para los que quedaron afuera
      await client.query(
        `DELETE FROM asset_alert_notifications WHERE rule_id = $1 AND asset_id NOT IN (
           SELECT asset_id FROM asset_alert_rule_assets WHERE rule_id = $1
         )`,
        [id]
      );
    }

    if (!rule) {
      const current = await client.query('SELECT * FROM asset_alert_rules WHERE id = $1', [id]);
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Regla no encontrada.' });
      }
      rule = current.rows[0];
    }

    await client.query('COMMIT');
    res.json(rule);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al editar la regla.' });
  } finally {
    client.release();
  }
});

// DELETE /api/asset-alerts/:id
router.delete('/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM asset_alert_rules WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
