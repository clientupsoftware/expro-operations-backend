const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth); // todo lo de este archivo requiere estar logueado

// ---------- CLIENTS ----------
router.get('/clients', async (req, res) => {
  const result = await pool.query('SELECT * FROM clients ORDER BY name');
  res.json(result.rows);
});

router.post('/clients', requireRole('coordinador'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido.' });
  const result = await pool.query(
    'INSERT INTO clients (name) VALUES ($1) RETURNING *',
    [name]
  );
  res.status(201).json(result.rows[0]);
});

// ---------- PADS ----------
router.get('/pads', async (req, res) => {
  const result = await pool.query(`
    SELECT pads.*, clients.name AS client_name
    FROM pads JOIN clients ON clients.id = pads.client_id
    ORDER BY pads.name
  `);
  res.json(result.rows);
});

router.post('/pads', requireRole('coordinador'), async (req, res) => {
  const { name, client_id } = req.body;
  if (!name || !client_id) return res.status(400).json({ error: 'name y client_id son requeridos.' });
  const result = await pool.query(
    'INSERT INTO pads (name, client_id) VALUES ($1, $2) RETURNING *',
    [name, client_id]
  );
  res.status(201).json(result.rows[0]);
});

// ---------- WELLS ----------
router.get('/wells', async (req, res) => {
  const { pad_id } = req.query;
  const query = pad_id
    ? { text: 'SELECT * FROM wells WHERE pad_id = $1 ORDER BY name', values: [pad_id] }
    : { text: 'SELECT * FROM wells ORDER BY name', values: [] };
  const result = await pool.query(query);
  res.json(result.rows);
});

router.post('/wells', requireRole('coordinador'), async (req, res) => {
  const { name, pad_id } = req.body;
  if (!name || !pad_id) return res.status(400).json({ error: 'name y pad_id son requeridos.' });
  const result = await pool.query(
    'INSERT INTO wells (name, pad_id) VALUES ($1, $2) RETURNING *',
    [name, pad_id]
  );
  res.status(201).json(result.rows[0]);
});

// ---------- SERVICES ----------
router.get('/services', async (req, res) => {
  const result = await pool.query('SELECT * FROM services ORDER BY name');
  res.json(result.rows);
});

router.post('/services', requireRole('coordinador'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido.' });
  const result = await pool.query(
    'INSERT INTO services (name) VALUES ($1) RETURNING *',
    [name]
  );
  res.status(201).json(result.rows[0]);
});

module.exports = router;
