// serviceRequirements.routes.js
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/service-requirements/:serviceId - requerimientos predefinidos de un servicio
router.get('/:serviceId', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM service_default_requirements WHERE service_id = $1 ORDER BY orden',
    [req.params.serviceId]
  );
  res.json(result.rows);
});

// POST /api/service-requirements/:serviceId - agregar un requerimiento predefinido
router.post('/:serviceId', requireRole('coordinador'), async (req, res) => {
  const { tool_description, quantity } = req.body;
  if (!tool_description) return res.status(400).json({ error: 'tool_description es requerido.' });

  const ordenResult = await pool.query(
    'SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente FROM service_default_requirements WHERE service_id = $1',
    [req.params.serviceId]
  );

  const result = await pool.query(
    'INSERT INTO service_default_requirements (service_id, tool_description, quantity, orden) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.serviceId, tool_description, quantity || 1, ordenResult.rows[0].siguiente]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /api/service-requirements/item/:id - quitar un requerimiento predefinido puntual
router.delete('/item/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM service_default_requirements WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
