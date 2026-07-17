const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/job-assets/:jobId - assets asignados a un job (todos los roles ven esto)
router.get('/:jobId', async (req, res) => {
  const result = await pool.query(`
    SELECT job_assets.*, assets.sap_equipment_code, assets.description, assets.serial_number,
           assets.cumulative_runs, assets.cumulative_operations, kit_templates.name AS kit_name
    FROM job_assets
    JOIN assets ON assets.id = job_assets.asset_id
    LEFT JOIN kit_templates ON kit_templates.id = job_assets.kit_template_id
    WHERE job_assets.job_id = $1
    ORDER BY job_assets.created_at
  `, [req.params.jobId]);
  res.json(result.rows);
});

// POST /api/job-assets/:jobId - asignar un asset individual (solo Mantenimiento)
router.post('/:jobId', requireRole('mantenimiento'), async (req, res) => {
  const { asset_id } = req.body;
  if (!asset_id) return res.status(400).json({ error: 'asset_id es requerido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO job_assets (job_id, asset_id, assigned_by) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.jobId, asset_id, req.user.id]
    );

    // Toda asignacion a un Job cuenta como 1 operacion para ese asset, sin importar el modelo.
    // Esto es independiente del conteo de carreras (que sigue sumando solo via lineas/stages con RIH+POOH).
    await client.query('UPDATE assets SET cumulative_operations = cumulative_operations + 1 WHERE id = $1', [asset_id]);
    await client.query(
      'INSERT INTO asset_runs (asset_id, job_id, source) VALUES ($1, $2, $3)',
      [asset_id, req.params.jobId, 'job_assignment_operacion']
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el asset.' });
  } finally {
    client.release();
  }
});

router.delete('/:jobId/:jobAssetId', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM job_assets WHERE id = $1 AND job_id = $2', [req.params.jobAssetId, req.params.jobId]);
  res.status(204).send();
});

// PATCH /api/job-assets/:jobId/:jobAssetId/confirm - el Ingeniero confirma un asset asignado
router.patch('/:jobId/:jobAssetId/confirm', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const result = await pool.query(
    `UPDATE job_assets SET confirmed = true, confirmed_by = $1, confirmed_at = now()
     WHERE id = $2 AND job_id = $3 RETURNING *`,
    [req.user.id, req.params.jobAssetId, req.params.jobId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Asignacion no encontrada.' });
  res.json(result.rows[0]);
});

// PATCH /api/job-assets/:jobId/:jobAssetId/requirement - indica a que requerimiento del Job
// corresponde este asset asignado. required_tool_id null = "sin asignar" (desetiquetarlo).
router.patch('/:jobId/:jobAssetId/requirement', requireRole('coordinador', 'mantenimiento', 'ingeniero'), async (req, res) => {
  const { required_tool_id } = req.body;
  const result = await pool.query(
    `UPDATE job_assets SET required_tool_id = $1
     WHERE id = $2 AND job_id = $3 RETURNING *`,
    [required_tool_id || null, req.params.jobAssetId, req.params.jobId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Asignacion no encontrada.' });
  res.json(result.rows[0]);
});

// POST /api/job-assets/:jobId/generate-shipping-list
// Genera la Shipping List a partir de todos los job_assets confirmados de ese job.
router.post('/:jobId/generate-shipping-list', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { jobId } = req.params;

  const confirmedAssets = await pool.query(`
    SELECT job_assets.asset_id, assets.description, assets.serial_number
    FROM job_assets
    JOIN assets ON assets.id = job_assets.asset_id
    WHERE job_assets.job_id = $1 AND job_assets.confirmed = true
  `, [jobId]);

  if (confirmedAssets.rows.length === 0) {
    return res.status(400).json({ error: 'No hay assets confirmados todavia para este job.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const shippingList = await client.query(
      `INSERT INTO shipping_lists (job_id) VALUES ($1)
       ON CONFLICT (job_id) DO UPDATE SET generated_at = now()
       RETURNING *`,
      [jobId]
    );
    const listId = shippingList.rows[0].id;

    await client.query('DELETE FROM shipping_list_items WHERE shipping_list_id = $1', [listId]);

    for (const asset of confirmedAssets.rows) {
      await client.query(
        `INSERT INTO shipping_list_items (shipping_list_id, asset_id, asset_name, serial_number)
         VALUES ($1, $2, $3, $4)`,
        [listId, asset.asset_id, asset.description, asset.serial_number]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ shipping_list_id: listId, items: confirmedAssets.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al generar la shipping list.' });
  } finally {
    client.release();
  }
});

// GET /api/job-assets/:jobId/shipping-list
router.get('/:jobId/shipping-list', async (req, res) => {
  const listResult = await pool.query('SELECT * FROM shipping_lists WHERE job_id = $1', [req.params.jobId]);
  if (listResult.rows.length === 0) return res.json({ items: [] });

  const itemsResult = await pool.query(
    'SELECT * FROM shipping_list_items WHERE shipping_list_id = $1',
    [listResult.rows[0].id]
  );
  res.json({ generated_at: listResult.rows[0].generated_at, items: itemsResult.rows });
});

module.exports = router;
