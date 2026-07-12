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
    SELECT jobs.*, pads.name AS pad_name, pads.client_id AS client_id, clients.name AS client_name
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

  const peripheralsResult = await pool.query(`
    SELECT job_peripheral_options.* FROM job_peripheral_options
    JOIN job_peripherals ON job_peripherals.option_id = job_peripheral_options.id
    WHERE job_peripherals.job_id = $1
  `, [id]);

  res.json({
    ...jobResult.rows[0],
    wells: wellsResult.rows,
    services: servicesResult.rows,
    peripherals: peripheralsResult.rows
  });
});

// PATCH /api/jobs/:id/details - edicion completa (Coordinador/Super): PAD, pozos, servicios,
// presion en BDP, perifericos y doble dotacion.
router.patch('/:id/details', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;
  const { pad_id, well_ids, service_ids, presion_bdp, doble_dotacion, peripheral_ids } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setClauses = [];
    const values = [];
    if (pad_id !== undefined) { values.push(pad_id); setClauses.push(`pad_id = $${values.length}`); }
    if (presion_bdp !== undefined) { values.push(presion_bdp === '' ? null : presion_bdp); setClauses.push(`presion_bdp = $${values.length}`); }
    if (doble_dotacion !== undefined) { values.push(doble_dotacion || 'NA'); setClauses.push(`doble_dotacion = $${values.length}`); }
    if (setClauses.length > 0) {
      values.push(id);
      await client.query(`UPDATE jobs SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    if (Array.isArray(well_ids)) {
      await client.query('DELETE FROM job_wells WHERE job_id = $1', [id]);
      for (const wellId of well_ids) {
        await client.query('INSERT INTO job_wells (job_id, well_id) VALUES ($1, $2)', [id, wellId]);
      }
    }

    if (Array.isArray(service_ids)) {
      await client.query('DELETE FROM job_services WHERE job_id = $1', [id]);
      for (const serviceId of service_ids) {
        await client.query('INSERT INTO job_services (job_id, service_id) VALUES ($1, $2)', [id, serviceId]);
      }
    }

    if (Array.isArray(peripheral_ids)) {
      await client.query('DELETE FROM job_peripherals WHERE job_id = $1', [id]);
      for (const optId of peripheral_ids) {
        await client.query('INSERT INTO job_peripherals (job_id, option_id) VALUES ($1, $2)', [id, optId]);
      }
    }

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar los detalles del job.' });
  } finally {
    client.release();
  }
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

// PATCH /api/jobs/:id/header - datos de encabezado del Job (Coordinador/Ingeniero/Super).
// Estos valores son los que despues se usan como default en el Reporte de Tiempos,
// para no tener que cargarlos dos veces.
const JOB_HEADER_FIELDS = [
  'rig_name', 'well_status', 'shut_in_tubing_pressure', 'flowing_thp', 'job_objective',
  'representante_cliente', 'expro_representante',
  'supervisor_dia', 'guinchero_dia', 'asistente_dia',
  'supervisor_noche', 'guinchero_noche', 'asistente_noche',
  'unidad_liviana', 'unidad_carga', 'unidad_wl',
  'numero_wls', 'power_pack', 'wire_type_size', 'consumables_used'
];
router.patch('/:id/header', requireRole('coordinador', 'ingeniero'), async (req, res) => {
  const setClauses = [];
  const values = [];
  JOB_HEADER_FIELDS.forEach((field) => {
    if (field in req.body) {
      values.push(req.body[field] || null);
      setClauses.push(`${field} = $${values.length}`);
    }
  });
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE jobs SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
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

// DELETE /api/jobs/:id - eliminar un Job completo (solo Super). El frontend exige confirmar
// la contrasena antes de llamar a este endpoint (ver POST /api/auth/verify-password).
router.delete('/:id', requireRole('super'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Desvincula (sin borrar) registros que deben sobrevivir a la eliminacion del Job:
    // el historial de carreras de los assets (importante para mantenimiento preventivo)
    // y la entrada de Parte Diario de origen, si la tenia.
    await client.query('UPDATE asset_runs SET job_id = NULL WHERE job_id = $1', [id]);
    await client.query('UPDATE daily_board_entries SET job_id = NULL WHERE job_id = $1', [id]);

    // Estas dos tablas se agregaron en migraciones posteriores al schema original y por las
    // dudas no tengan ON DELETE CASCADE configurado: se limpian explicitamente antes de borrar el Job.
    await client.query('DELETE FROM job_services WHERE job_id = $1', [id]);
    await client.query('DELETE FROM job_peripherals WHERE job_id = $1', [id]);

    // El resto (job_wells, required_tools, job_assets, shipping_lists+items, time_reports y todo
    // lo que cuelga de ahi: lineas, assets de linea, bundle stages, assets de stage) ya tiene
    // ON DELETE CASCADE en el schema, asi que se borra solo al borrar el Job.
    const result = await client.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job no encontrado.' });
    }

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el Job. No se borro nada.' });
  } finally {
    client.release();
  }
});

module.exports = router;
