const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/jobs - lista para la pantalla principal (selector de Pozo/Job)
// Todos los roles ven todos los jobs.
router.get('/', async (req, res) => {
  const result = await pool.query(`
    SELECT
      jobs.id, jobs.job_number, jobs.status, jobs.created_at,
      pads.name AS pad_name,
      clients.name AS client_name,
      COALESCE(
        json_agg(DISTINCT services.name) FILTER (WHERE services.name IS NOT NULL), '[]'
      ) AS services,
      COALESCE(
        json_agg(DISTINCT wells.name) FILTER (WHERE wells.name IS NOT NULL), '[]'
      ) AS wells
    FROM jobs
    JOIN pads ON pads.id = jobs.pad_id
    JOIN clients ON clients.id = pads.client_id
    LEFT JOIN job_services ON job_services.job_id = jobs.id
    LEFT JOIN services ON services.id = job_services.service_id
    LEFT JOIN job_wells ON job_wells.job_id = jobs.id
    LEFT JOIN wells ON wells.id = job_wells.well_id
    GROUP BY jobs.id, pads.name, clients.name
    ORDER BY jobs.created_at DESC
  `);
  res.json(result.rows);
});

// GET /api/jobs/:id - detalle completo de un job (banner + contexto activo)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const jobResult = await pool.query(`
    SELECT jobs.*, pads.name AS pad_name, clients.name AS client_name
    FROM jobs
    JOIN pads ON pads.id = jobs.pad_id
    JOIN clients ON clients.id = pads.client_id
    WHERE jobs.id = $1
  `, [id]);

  if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado.' });

  const wellsResult = await pool.query(`
    SELECT wells.* FROM wells
    JOIN job_wells ON job_wells.well_id = wells.id
    WHERE job_wells.job_id = $1
  `, [id]);

  const servicesResult = await pool.query(`
    SELECT services.* FROM services
    JOIN job_services ON job_services.service_id = services.id
    WHERE job_services.job_id = $1
  `, [id]);

  res.json({ ...jobResult.rows[0], wells: wellsResult.rows, services: servicesResult.rows });
});

// POST /api/jobs - crear Job (solo Coordinador). well_ids y service_ids son arrays
router.post('/', requireRole('coordinador'), async (req, res) => {
  const { pad_id, service_ids, well_ids, job_number } = req.body;
  if (!pad_id || !Array.isArray(service_ids) || service_ids.length === 0 || !Array.isArray(well_ids) || well_ids.length === 0) {
    return res.status(400).json({ error: 'pad_id, service_ids (array) y well_ids (array) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobResult = await client.query(
      `INSERT INTO jobs (pad_id, job_number, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [pad_id, job_number || null, req.user.id]
    );
    const job = jobResult.rows[0];

    for (const wellId of well_ids) {
      await client.query('INSERT INTO job_wells (job_id, well_id) VALUES ($1, $2)', [job.id, wellId]);
    }
    for (const serviceId of service_ids) {
      await client.query('INSERT INTO job_services (job_id, service_id) VALUES ($1, $2)', [job.id, serviceId]);
    }

    await client.query('COMMIT');
    res.status(201).json(job);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el job.' });
  } finally {
    client.release();
  }
});

// PATCH /api/jobs/:id/job-number - solo el Coordinador puede asignar/editar el N de Trabajo
router.patch('/:id/job-number', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;
  const { job_number } = req.body;
  const result = await pool.query(
    'UPDATE jobs SET job_number = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [job_number || null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json(result.rows[0]);
});

// ---------- REQUIRED TOOLS (pedido de herramientas del Ingeniero) ----------

// GET /api/jobs/:id/required-tools
router.get('/:id/required-tools', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM required_tools WHERE job_id = $1 ORDER BY created_at',
    [req.params.id]
  );
  res.json(result.rows);
});

// POST /api/jobs/:id/required-tools (Coordinador o Ingeniero)
router.post('/:id/required-tools', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const { tool_description, quantity } = req.body;
  if (!tool_description) return res.status(400).json({ error: 'tool_description es requerido.' });
  const result = await pool.query(
    `INSERT INTO required_tools (job_id, tool_description, quantity, requested_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, tool_description, quantity || 1, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/:id/required-tools/:toolId', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  await pool.query('DELETE FROM required_tools WHERE id = $1 AND job_id = $2', [req.params.toolId, req.params.id]);
  res.status(204).send();
});

module.exports = router;
