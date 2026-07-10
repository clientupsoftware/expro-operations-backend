const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/time-report-operations - todos los roles ven la lista
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM time_report_operations ORDER BY id');
  res.json(result.rows);
});

// POST /api/time-report-operations - agregar una opcion nueva (Coordinador/Super)
router.post('/', requireRole('coordinador'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido.' });
  const result = await pool.query(
    `INSERT INTO time_report_operations (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING RETURNING *`,
    [name.trim()]
  );
  res.status(201).json(result.rows[0] || { message: 'Ya existia esa opcion.' });
});

// DELETE /api/time-report-operations/:id (Coordinador/Super)
router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM time_report_operations WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
