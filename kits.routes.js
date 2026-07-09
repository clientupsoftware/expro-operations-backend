const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/kits - todos ven los kits existentes, con sus assets reales
router.get('/', async (req, res) => {
  const kitsResult = await pool.query('SELECT * FROM kit_templates ORDER BY name');
  const kits = kitsResult.rows;

  const itemsResult = await pool.query(`
    SELECT kit_template_items.kit_template_id, kit_template_items.asset_id,
           assets.sap_equipment_code, assets.description, assets.serial_number
    FROM kit_template_items
    JOIN assets ON assets.id = kit_template_items.asset_id
  `);

  const withItems = kits.map((kit) => ({
    ...kit,
    items: itemsResult.rows.filter((item) => item.kit_template_id === kit.id)
  }));

  res.json(withItems);
});

// POST /api/kits - crear un kit nuevo (Mantenimiento o Super). asset_ids: [1, 2, 3, ...]
router.post('/', requireRole('mantenimiento'), async (req, res) => {
  const { name, category, asset_ids } = req.body;
  if (!name || !Array.isArray(asset_ids) || asset_ids.length === 0) {
    return res.status(400).json({ error: 'name y asset_ids (array) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kitResult = await client.query(
      'INSERT INTO kit_templates (name, category, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, category || null, req.user.id]
    );
    const kit = kitResult.rows[0];

    for (const assetId of asset_ids) {
      await client.query(
        'INSERT INTO kit_template_items (kit_template_id, asset_id) VALUES ($1, $2)',
        [kit.id, assetId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(kit);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el kit.' });
  } finally {
    client.release();
  }
});

// DELETE /api/kits/:id (Mantenimiento o Super)
router.delete('/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM kit_templates WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// POST /api/kits/:id/assign-to-job/:jobId
// Asigna TODOS los assets reales del kit a un job de una sola vez.
// Como cada item del kit ya es un asset especifico (con serie), no hace falta "buscar disponible":
// se asigna directo, salvo que ya este asignado a este mismo job.
router.post('/:id/assign-to-job/:jobId', requireRole('mantenimiento'), async (req, res) => {
  const { id: kitId, jobId } = req.params;

  const itemsResult = await pool.query(
    'SELECT asset_id FROM kit_template_items WHERE kit_template_id = $1',
    [kitId]
  );
  if (itemsResult.rows.length === 0) {
    return res.status(404).json({ error: 'El kit no tiene componentes o no existe.' });
  }

  const client = await pool.connect();
  const assigned = [];
  const yaAsignados = [];
  try {
    await client.query('BEGIN');

    for (const item of itemsResult.rows) {
      const existing = await client.query(
        'SELECT id FROM job_assets WHERE job_id = $1 AND asset_id = $2',
        [jobId, item.asset_id]
      );
      if (existing.rows.length > 0) {
        yaAsignados.push(item.asset_id);
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO job_assets (job_id, asset_id, kit_template_id, assigned_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [jobId, item.asset_id, kitId, req.user.id]
      );
      assigned.push(inserted.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({ assigned, yaAsignados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el kit al job.' });
  } finally {
    client.release();
  }
});

module.exports = router;
