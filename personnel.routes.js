const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// ================= CUADRILLAS (ciclo 14x7 compartido) =================

router.get('/crews', async (req, res) => {
  const result = await pool.query('SELECT * FROM crews ORDER BY name');
  res.json(result.rows);
});

router.post('/crews', requireRole('coordinador'), async (req, res) => {
  const { name, cycle_start_date } = req.body;
  if (!name || !cycle_start_date) return res.status(400).json({ error: 'name y cycle_start_date son requeridos.' });
  const result = await pool.query(
    'INSERT INTO crews (name, cycle_start_date) VALUES ($1, $2) RETURNING *',
    [name, cycle_start_date]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/crews/:id', requireRole('coordinador'), async (req, res) => {
  const { name, cycle_start_date } = req.body;
  const result = await pool.query(
    'UPDATE crews SET name = $1, cycle_start_date = $2 WHERE id = $3 RETURNING *',
    [name, cycle_start_date, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Cuadrilla no encontrada.' });
  res.json(result.rows[0]);
});

router.delete('/crews/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM crews WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= PERSONAL =================

router.get('/', async (req, res) => {
  const result = await pool.query(`
    SELECT personnel.*, crews.name AS crew_name, crews.cycle_start_date
    FROM personnel
    LEFT JOIN crews ON crews.id = personnel.crew_id
    ORDER BY personnel.category, personnel.name
  `);
  res.json(result.rows);
});

router.post('/', requireRole('coordinador'), async (req, res) => {
  const { name, category, puesto, crew_id } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name y category son requeridos.' });
  const result = await pool.query(
    'INSERT INTO personnel (name, category, puesto, crew_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, category, puesto || null, crew_id || null]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', requireRole('coordinador'), async (req, res) => {
  const { name, category, puesto, crew_id, active } = req.body;
  const result = await pool.query(
    `UPDATE personnel SET name = $1, category = $2, puesto = $3, crew_id = $4, active = $5 WHERE id = $6 RETURNING *`,
    [name, category, puesto || null, crew_id || null, active !== undefined ? active : true, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Persona no encontrada.' });
  res.json(result.rows[0]);
});

router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM personnel WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= EXCEPCIONES (franco compensatorio, licencia, curso, etc.) =================

router.get('/overrides', async (req, res) => {
  const result = await pool.query(`
    SELECT personnel_status_overrides.*, personnel.name AS personnel_name
    FROM personnel_status_overrides
    JOIN personnel ON personnel.id = personnel_status_overrides.personnel_id
    ORDER BY date_from DESC
  `);
  res.json(result.rows);
});

router.post('/overrides', requireRole('coordinador'), async (req, res) => {
  const { personnel_id, status, date_from, date_to, notas } = req.body;
  if (!personnel_id || !status || !date_from || !date_to) {
    return res.status(400).json({ error: 'personnel_id, status, date_from y date_to son requeridos.' });
  }
  const result = await pool.query(
    `INSERT INTO personnel_status_overrides (personnel_id, status, date_from, date_to, notas, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [personnel_id, status, date_from, date_to, notas || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/overrides/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM personnel_status_overrides WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= ESTADO CALCULADO Y ESTADISTICAS =================

// Calcula si, segun el ciclo 14x7 de la cuadrilla, esa fecha cae en diagrama o en franco
function computeCycleStatus(cycleStartDate, targetDate) {
  if (!cycleStartDate) return 'sin_cuadrilla';
  const start = new Date(cycleStartDate);
  const target = new Date(targetDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.round((target - start) / msPerDay);
  const mod = ((diffDays % 21) + 21) % 21; // ciclo de 21 dias: 14 en diagrama + 7 de franco
  return mod < 14 ? 'en_diagrama' : 'franco';
}

// GET /api/personnel/status?date=YYYY-MM-DD - estado de cada persona para esa fecha
router.get('/status', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const personnelResult = await pool.query(`
    SELECT personnel.*, crews.name AS crew_name, crews.cycle_start_date
    FROM personnel
    LEFT JOIN crews ON crews.id = personnel.crew_id
    WHERE personnel.active = true
    ORDER BY personnel.category, personnel.name
  `);

  const overridesResult = await pool.query(
    'SELECT * FROM personnel_status_overrides WHERE date_from <= $1 AND date_to >= $1',
    [date]
  );
  const overridesByPerson = {};
  overridesResult.rows.forEach((o) => { overridesByPerson[o.personnel_id] = o; });

  const withStatus = personnelResult.rows.map((p) => {
    const cycleStatus = computeCycleStatus(p.cycle_start_date, date);
    const override = overridesByPerson[p.id];
    return {
      ...p,
      cycle_status: cycleStatus,
      override_status: override ? override.status : null,
      final_status: override ? override.status : cycleStatus
    };
  });

  res.json({ date, personnel: withStatus });
});

// GET /api/personnel/stats?date=YYYY-MM-DD - los numeros para el dashboard
router.get('/stats', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const personnelResult = await pool.query(`
    SELECT personnel.*, crews.cycle_start_date
    FROM personnel
    LEFT JOIN crews ON crews.id = personnel.crew_id
    WHERE personnel.active = true
  `);

  const overridesResult = await pool.query(
    'SELECT * FROM personnel_status_overrides WHERE date_from <= $1 AND date_to >= $1',
    [date]
  );
  const overridesByPerson = {};
  overridesResult.rows.forEach((o) => { overridesByPerson[o.personnel_id] = o; });

  let esperadosEnDiagrama = 0;
  let realmenteDisponibles = 0;
  const porEstado = {};

  personnelResult.rows.forEach((p) => {
    const cycleStatus = computeCycleStatus(p.cycle_start_date, date);
    if (cycleStatus === 'en_diagrama') esperadosEnDiagrama += 1;

    const override = overridesByPerson[p.id];
    const finalStatus = override ? override.status : cycleStatus;
    porEstado[finalStatus] = (porEstado[finalStatus] || 0) + 1;

    if (cycleStatus === 'en_diagrama' && !override) realmenteDisponibles += 1;
  });

  res.json({
    date,
    totalActivos: personnelResult.rows.length,
    esperadosEnDiagrama,
    realmenteDisponibles,
    porEstado
  });
});

module.exports = router;
