// explosives.routes.js
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// ================= TIPOS DE EXPLOSIVOS (catalogo) =================

router.get('/types', async (req, res) => {
  const result = await pool.query('SELECT * FROM explosive_types ORDER BY descripcion');
  res.json(result.rows);
});

router.post('/types', requireRole('mantenimiento'), async (req, res) => {
  const { descripcion, tipo, fabricante, numero_renar, numero_sap } = req.body;
  if (!descripcion) return res.status(400).json({ error: 'descripcion es requerido.' });
  const result = await pool.query(
    `INSERT INTO explosive_types (descripcion, tipo, fabricante, numero_renar, numero_sap, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [descripcion, tipo || null, fabricante || null, numero_renar || null, numero_sap || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/types/:id', requireRole('mantenimiento'), async (req, res) => {
  const { descripcion, tipo, fabricante, numero_renar, numero_sap } = req.body;
  const setClauses = [];
  const values = [];
  const fields = { descripcion, tipo, fabricante, numero_renar, numero_sap };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) { values.push(value || null); setClauses.push(`${key} = $${values.length}`); }
  }
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE explosive_types SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Tipo de explosivo no encontrado.' });
  res.json(result.rows[0]);
});

router.delete('/types/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM explosive_types WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= PROGRAMAS =================

// GET /api/explosives/programs?from=&to=&cliente_id= - lista con filtros, resumen anidado
router.get('/programs', async (req, res) => {
  const { from, to, cliente_id } = req.query;
  const conditions = [];
  const values = [];
  if (from) { values.push(from); conditions.push(`explosive_programs.fecha >= $${values.length}`); }
  if (to) { values.push(to); conditions.push(`explosive_programs.fecha <= $${values.length}`); }
  if (cliente_id) { values.push(cliente_id); conditions.push(`explosive_programs.cliente_id = $${values.length}`); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const programsResult = await pool.query(`
    SELECT explosive_programs.*, clients.name AS cliente_nombre
    FROM explosive_programs
    LEFT JOIN clients ON clients.id = explosive_programs.cliente_id
    ${whereClause}
    ORDER BY explosive_programs.fecha DESC, explosive_programs.id DESC
  `, values);
  const programs = programsResult.rows;
  if (programs.length === 0) return res.json([]);

  const programIds = programs.map((p) => p.id);
  const wellsResult = await pool.query(
    `SELECT * FROM explosive_program_wells WHERE program_id = ANY($1::int[]) ORDER BY orden`,
    [programIds]
  );
  const wellIds = wellsResult.rows.map((w) => w.id);
  const runsResult = wellIds.length
    ? await pool.query(`SELECT * FROM explosive_program_runs WHERE program_well_id = ANY($1::int[]) ORDER BY orden`, [wellIds])
    : { rows: [] };

  res.json(programs.map((p) => ({
    ...p,
    wells: wellsResult.rows
      .filter((w) => w.program_id === p.id)
      .map((w) => ({ ...w, runs: runsResult.rows.filter((r) => r.program_well_id === w.id) }))
  })));
});

// GET /api/explosives/programs/:id - un programa puntual, con todo su detalle
router.get('/programs/:id', async (req, res) => {
  const programResult = await pool.query(`
    SELECT explosive_programs.*, clients.name AS cliente_nombre
    FROM explosive_programs
    LEFT JOIN clients ON clients.id = explosive_programs.cliente_id
    WHERE explosive_programs.id = $1
  `, [req.params.id]);
  if (programResult.rows.length === 0) return res.status(404).json({ error: 'Programa no encontrado.' });
  const program = programResult.rows[0];

  const wellsResult = await pool.query('SELECT * FROM explosive_program_wells WHERE program_id = $1 ORDER BY orden', [program.id]);
  const wellIds = wellsResult.rows.map((w) => w.id);
  const runsResult = wellIds.length
    ? await pool.query('SELECT * FROM explosive_program_runs WHERE program_well_id = ANY($1::int[]) ORDER BY orden', [wellIds])
    : { rows: [] };

  res.json({
    ...program,
    wells: wellsResult.rows.map((w) => ({ ...w, runs: runsResult.rows.filter((r) => r.program_well_id === w.id) }))
  });
});

// Inserta wells + runs para un programa (usado por POST y PATCH)
async function insertWells(client, programId, wells) {
  let wellOrden = 0;
  for (const well of wells) {
    const wellResult = await client.query(
      'INSERT INTO explosive_program_wells (program_id, pozo, orden) VALUES ($1,$2,$3) RETURNING id',
      [programId, well.pozo, wellOrden++]
    );
    const wellId = wellResult.rows[0].id;
    let runOrden = 0;
    for (const run of (well.runs || [])) {
      await client.query(
        `INSERT INTO explosive_program_runs
          (program_well_id, nombre, cantidad_etapas, diametro_canon, cantidad_clusters,
           largo_cluster_ft, spf, fase, cargas_por_cluster, tipo_bala, tpn, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          wellId, run.nombre || null, run.cantidad_etapas || null, run.diametro_canon || null,
          run.cantidad_clusters || null, run.largo_cluster_ft || null, run.spf || null,
          run.fase || null, run.cargas_por_cluster || null, run.tipo_bala || null,
          run.tpn === 'N' ? 'N' : 'Y', runOrden++
        ]
      );
    }
  }
}

// POST /api/explosives/programs - crear un programa completo (pozos + carreras incluidos)
router.post('/programs', requireRole('mantenimiento'), async (req, res) => {
  const { fecha, nombre, cliente_id, pad, wells } = req.body;
  if (!Array.isArray(wells) || wells.length === 0) {
    return res.status(400).json({ error: 'wells (array, al menos 1 pozo) es requerido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const programResult = await client.query(
      `INSERT INTO explosive_programs (fecha, nombre, cliente_id, pad, created_by)
       VALUES (COALESCE($1, CURRENT_DATE), $2, $3, $4, $5) RETURNING *`,
      [fecha || null, nombre || null, cliente_id || null, pad || null, req.user.id]
    );
    const program = programResult.rows[0];

    await insertWells(client, program.id, wells);

    await client.query('COMMIT');
    res.status(201).json(program);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el programa de explosivos.' });
  } finally {
    client.release();
  }
});

// PATCH /api/explosives/programs/:id - editar datos generales y/o reemplazar pozos+carreras
router.patch('/programs/:id', requireRole('mantenimiento'), async (req, res) => {
  const { id } = req.params;
  const { fecha, nombre, cliente_id, pad, wells } = req.body;

  if (wells !== undefined && (!Array.isArray(wells) || wells.length === 0)) {
    return res.status(400).json({ error: 'Si mandas wells, tiene que ser un array con al menos 1 pozo.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setClauses = [];
    const values = [];
    if (fecha !== undefined) { values.push(fecha); setClauses.push(`fecha = $${values.length}`); }
    if (nombre !== undefined) { values.push(nombre || null); setClauses.push(`nombre = $${values.length}`); }
    if (cliente_id !== undefined) { values.push(cliente_id || null); setClauses.push(`cliente_id = $${values.length}`); }
    if (pad !== undefined) { values.push(pad || null); setClauses.push(`pad = $${values.length}`); }

    if (setClauses.length > 0) {
      values.push(id);
      const result = await client.query(
        `UPDATE explosive_programs SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Programa no encontrado.' });
      }
    }

    if (Array.isArray(wells)) {
      await client.query('DELETE FROM explosive_program_wells WHERE program_id = $1', [id]);
      await insertWells(client, id, wells);
    }

    await client.query('COMMIT');

    const updated = await pool.query('SELECT * FROM explosive_programs WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al editar el programa de explosivos.' });
  } finally {
    client.release();
  }
});

router.delete('/programs/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM explosive_programs WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
