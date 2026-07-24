const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/motocompresores - todos ven el catalogo
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM motocompresores ORDER BY name');
  res.json(result.rows);
});

// POST /api/motocompresores (Coordinador/Super)
router.post('/', requireRole('coordinador'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name es requerido.' });
  const result = await pool.query('INSERT INTO motocompresores (name) VALUES ($1) RETURNING *', [name.trim()]);
  res.status(201).json(result.rows[0]);
});

// DELETE /api/motocompresores/:id (Coordinador/Super)
router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM motocompresores WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
