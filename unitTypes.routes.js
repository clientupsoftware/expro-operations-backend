const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM unit_types ORDER BY name');
  res.json(result.rows);
});

router.post('/', requireRole('coordinador'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido.' });
  const result = await pool.query(
    `INSERT INTO unit_types (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *`,
    [name.trim()]
  );
  res.status(201).json(result.rows[0] || { message: 'Ya existia ese tipo.' });
});

router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM unit_types WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
