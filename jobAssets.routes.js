const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');
const { exportShippingListToWord } = require('./shippingListExport');

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

    // Antes de borrar y recrear los items, guardamos que unidad de transporte tenia asignada
    // cada asset - para no perder ese trabajo si se regenera la lista despues.
    const previousAssignments = await client.query(
      'SELECT asset_id, transport_unit_id FROM shipping_list_items WHERE shipping_list_id = $1 AND transport_unit_id IS NOT NULL',
      [listId]
    );
    const transportByAsset = {};
    previousAssignments.rows.forEach((r) => { transportByAsset[r.asset_id] = r.transport_unit_id; });

    await client.query('DELETE FROM shipping_list_items WHERE shipping_list_id = $1', [listId]);

    for (const asset of confirmedAssets.rows) {
      await client.query(
        `INSERT INTO shipping_list_items (shipping_list_id, asset_id, asset_name, serial_number, transport_unit_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [listId, asset.asset_id, asset.description, asset.serial_number, transportByAsset[asset.asset_id] || null]
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
  if (listResult.rows.length === 0) return res.json({ items: [], transport_units: [] });

  const listId = listResult.rows[0].id;
  const itemsResult = await pool.query('SELECT * FROM shipping_list_items WHERE shipping_list_id = $1', [listId]);
  const unitsResult = await pool.query('SELECT * FROM shipping_list_transport_units WHERE shipping_list_id = $1 ORDER BY orden', [listId]);
  res.json({ generated_at: listResult.rows[0].generated_at, items: itemsResult.rows, transport_units: unitsResult.rows });
});

// POST /api/job-assets/:jobId/shipping-list/transport-units - crear una unidad de transporte
router.post('/:jobId/shipping-list/transport-units', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { tipo, patente } = req.body;
  if (!tipo) return res.status(400).json({ error: 'tipo es requerido.' });

  const listResult = await pool.query('SELECT id FROM shipping_lists WHERE job_id = $1', [req.params.jobId]);
  if (listResult.rows.length === 0) return res.status(400).json({ error: 'Primero hay que generar la Shipping List.' });
  const listId = listResult.rows[0].id;

  const ordenResult = await pool.query(
    'SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente FROM shipping_list_transport_units WHERE shipping_list_id = $1',
    [listId]
  );
  const result = await pool.query(
    'INSERT INTO shipping_list_transport_units (shipping_list_id, tipo, patente, orden) VALUES ($1,$2,$3,$4) RETURNING *',
    [listId, tipo, patente || null, ordenResult.rows[0].siguiente]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/job-assets/:jobId/shipping-list/transport-units/:unitId
router.patch('/:jobId/shipping-list/transport-units/:unitId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { tipo, patente } = req.body;
  const setClauses = [];
  const values = [];
  if (tipo !== undefined) { values.push(tipo); setClauses.push(`tipo = $${values.length}`); }
  if (patente !== undefined) { values.push(patente || null); setClauses.push(`patente = $${values.length}`); }
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });
  values.push(req.params.unitId);
  const result = await pool.query(
    `UPDATE shipping_list_transport_units SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Unidad no encontrada.' });
  res.json(result.rows[0]);
});

// DELETE /api/job-assets/:jobId/shipping-list/transport-units/:unitId
// Los items que estaban asignados a esta unidad quedan "sin asignar" (ON DELETE SET NULL).
router.delete('/:jobId/shipping-list/transport-units/:unitId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  await pool.query('DELETE FROM shipping_list_transport_units WHERE id = $1', [req.params.unitId]);
  res.status(204).send();
});

// PATCH /api/job-assets/:jobId/shipping-list/items/:itemId - asignar (o desasignar, con null) un item a una unidad
router.patch('/:jobId/shipping-list/items/:itemId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { transport_unit_id } = req.body;
  const result = await pool.query(
    'UPDATE shipping_list_items SET transport_unit_id = $1 WHERE id = $2 RETURNING *',
    [transport_unit_id || null, req.params.itemId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Item no encontrado.' });
  res.json(result.rows[0]);
});

// GET /api/job-assets/:jobId/shipping-list/export - descarga el remito en Word, agrupado por unidad
router.get('/:jobId/shipping-list/export', async (req, res) => {
  try {
    const jobResult = await pool.query(`
      SELECT jobs.job_number, clients.name AS client_name, pads.name AS pad_name
      FROM jobs JOIN pads ON pads.id = jobs.pad_id JOIN clients ON clients.id = pads.client_id
      WHERE jobs.id = $1
    `, [req.params.jobId]);
    if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado.' });

    const listResult = await pool.query('SELECT * FROM shipping_lists WHERE job_id = $1', [req.params.jobId]);
    if (listResult.rows.length === 0) return res.status(400).json({ error: 'Todavia no se genero la Shipping List.' });
    const listId = listResult.rows[0].id;

    const itemsResult = await pool.query('SELECT * FROM shipping_list_items WHERE shipping_list_id = $1', [listId]);
    const unitsResult = await pool.query('SELECT * FROM shipping_list_transport_units WHERE shipping_list_id = $1 ORDER BY orden', [listId]);

    const itemsByUnit = {};
    const unassignedItems = [];
    itemsResult.rows.forEach((it) => {
      if (it.transport_unit_id) {
        if (!itemsByUnit[it.transport_unit_id]) itemsByUnit[it.transport_unit_id] = [];
        itemsByUnit[it.transport_unit_id].push(it);
      } else {
        unassignedItems.push(it);
      }
    });

    const filePath = await exportShippingListToWord({
      job: jobResult.rows[0], transportUnits: unitsResult.rows, itemsByUnit, unassignedItems
    });
    res.download(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el remito.' });
  }
});

module.exports = router;
