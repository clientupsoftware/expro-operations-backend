const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/kits - todos ven los kits existentes
router.get('/', async (req, res) => {
  const kitsResult = await pool.query('SELECT * FROM kit_templates ORDER BY name');
  const kits = kitsResult.rows;

  const itemsResult = await pool.query(`
    SELECT kit_template_items.*, equipment_catalog.model_description, equipment_catalog.category
    FROM kit_template_items
    JOIN equipment_catalog ON equipment_catalog.id = kit_template_items.equipment_catalog_id
  `);

  const withItems = kits.map((kit) => ({
    ...kit,
    items: itemsResult.rows.filter((item) => item.kit_template_id === kit.id)
  }));

  res.json(withItems);
});

// POST /api/kits - crear un kit nuevo (solo Mantenimiento). items: [{equipment_catalog_id, quantity}]
router.post('/', requireRole('mantenimiento'), async (req, res) => {
  const { name, category, items } = req.body;
  if (!name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'name e items (array) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kitResult = await client.query(
      'INSERT INTO kit_templates (name, category, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, category || null, req.user.id]
    );
    const kit = kitResult.rows[0];

    for (const item of items) {
      await client.query(
        'INSERT INTO kit_template_items (kit_template_id, equipment_catalog_id, quantity) VALUES ($1, $2, $3)',
        [kit.id, item.equipment_catalog_id, item.quantity || 1]
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

// DELETE /api/kits/:id (solo Mantenimiento)
router.delete('/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM kit_templates WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// POST /api/kits/:id/assign-to-job/:jobId
// Asigna TODOS los componentes del kit a un job de una sola vez.
// Busca un asset disponible (no asignado a otro job activo) para cada modelo del kit.
router.post('/:id/assign-to-job/:jobId', requireRole('mantenimiento'), async (req, res) => {
  const { id: kitId, jobId } = req.params;

  const itemsResult = await pool.query(
    'SELECT * FROM kit_template_items WHERE kit_template_id = $1',
    [kitId]
  );
  if (itemsResult.rows.length === 0) {
    return res.status(404).json({ error: 'El kit no tiene componentes o no existe.' });
  }

  const client = await pool.connect();
  const assigned = [];
  const notFound = [];
  try {
    await client.query('BEGIN');

    for (const item of itemsResult.rows) {
      // Busca "quantity" assets disponibles de ese modelo que no esten ya asignados a un job activo
      const availableAssets = await client.query(`
        SELECT assets.* FROM assets
        WHERE assets.equipment_catalog_id = $1
        AND assets.id NOT IN (
          SELECT asset_id FROM job_assets ja
          JOIN jobs ON jobs.id = ja.job_id
          WHERE jobs.status = 'activo' AND ja.asset_id IS NOT NULL
        )
        LIMIT $2
      `, [item.equipment_catalog_id, item.quantity]);

      for (const asset of availableAssets.rows) {
        const inserted = await client.query(
          `INSERT INTO job_assets (job_id, asset_id, kit_template_id, assigned_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [jobId, asset.id, kitId, req.user.id]
        );
        assigned.push(inserted.rows[0]);
      }

      if (availableAssets.rows.length < item.quantity) {
        notFound.push({ equipment_catalog_id: item.equipment_catalog_id, faltantes: item.quantity - availableAssets.rows.length });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ assigned, notFound });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el kit al job.' });
  } finally {
    client.release();
  }
});

module.exports = router;
