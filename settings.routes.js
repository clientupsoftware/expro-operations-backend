const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/settings - todos pueden ver la configuracion
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM settings');
  res.json(result.rows);
});

// PUT /api/settings/:key - solo el Coordinador puede cambiar configuracion (ej: umbral del semaforo)
router.put('/:key', requireRole('coordinador'), async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value es requerido.' });

  const result = await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2 RETURNING *`,
    [req.params.key, String(value)]
  );
  res.json(result.rows[0]);
});

module.exports = router;
