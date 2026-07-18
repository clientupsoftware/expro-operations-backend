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

  res.json(programs.map((p) => ({
    ...p,
    wells: wellsResult.rows.filter((w) => w.program_id === p.id)
  })));
});

// Trae el detalle completo (pozos -> tipologias -> configuraciones) de un programa,
// mas el consumo total por tipo de explosivo en todo el programa.
async function getProgramDetail(programId) {
  const programResult = await pool.query(`
    SELECT explosive_programs.*, clients.name AS cliente_nombre
    FROM explosive_programs
    LEFT JOIN clients ON clients.id = explosive_programs.cliente_id
    WHERE explosive_programs.id = $1
  `, [programId]);
  if (programResult.rows.length === 0) return null;
  const program = programResult.rows[0];

  const wellsResult = await pool.query('SELECT * FROM explosive_program_wells WHERE program_id = $1 ORDER BY orden', [program.id]);
  const wellIds = wellsResult.rows.map((w) => w.id);

  const typologiesResult = wellIds.length
    ? await pool.query('SELECT * FROM explosive_program_typologies WHERE program_well_id = ANY($1::int[]) ORDER BY orden', [wellIds])
    : { rows: [] };
  const typologyIds = typologiesResult.rows.map((t) => t.id);

  const configsResult = typologyIds.length
    ? await pool.query('SELECT * FROM explosive_program_configs WHERE typology_id = ANY($1::int[]) ORDER BY orden', [typologyIds])
    : { rows: [] };

  const typesResult = await pool.query('SELECT id, descripcion FROM explosive_types');
  const typeDescById = {};
  typesResult.rows.forEach((t) => { typeDescById[t.id] = t.descripcion; });

  const wells = wellsResult.rows.map((w) => ({
    ...w,
    typologies: typologiesResult.rows
      .filter((t) => t.program_well_id === w.id)
      .map((t) => ({ ...t, configs: configsResult.rows.filter((c) => c.typology_id === t.id) }))
  }));

  // Consumo total por tipo de explosivo en todo el programa. Dos fuentes por etapa:
  // 1) El Tapon (si tiene_tapon): 1 detonador primario + 1 secundario + 1 carga de poder,
  //    una sola vez por etapa (no depende de la cantidad de clusters).
  // 2) Cada Configuracion de cluster: (cargas_por_cluster) cargas + 1 detonador + cordon
  //    detonante, todo multiplicado por cantidad_clusters de esa config.
  // Todo eso, a su vez, multiplicado por cantidad_etapas del Pozo.
  const consumoPorTipo = {};
  function sumar(typeId, cantidad) {
    if (!typeId || !cantidad) return;
    if (!consumoPorTipo[typeId]) {
      consumoPorTipo[typeId] = { explosive_type_id: typeId, descripcion: typeDescById[typeId] || '?', cantidad: 0 };
    }
    consumoPorTipo[typeId].cantidad += cantidad;
  }

  for (const well of wells) {
    const etapas = well.cantidad_etapas || 0;
    for (const typology of well.typologies) {
      if (typology.tiene_tapon) {
        sumar(typology.tapon_detonador_primario_id, 1 * etapas);
        sumar(typology.tapon_detonador_secundario_id, 1 * etapas);
        sumar(typology.tapon_carga_poder_id, 1 * etapas);
      }
      for (const config of typology.configs) {
        const cantidad = config.gun_quantity || 0;
        sumar(config.charge_type_id, cantidad * (config.quantity_charges_per_gun || 0) * etapas);
        sumar(config.detonator_type_id, cantidad * 1 * etapas);
        sumar(config.detonating_cord_type_id, cantidad * (config.detonating_cord_length_m || 0) * etapas);
      }
    }
  }

  return { ...program, wells, consumo_total: Object.values(consumoPorTipo).map((c) => ({ ...c, cantidad: Math.round(c.cantidad * 1000) / 1000 })) };
}

router.get('/programs/:id', async (req, res) => {
  const detail = await getProgramDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Programa no encontrado.' });
  res.json(detail);
});

// Inserta wells -> typologies -> configs para un programa (usado por POST y PATCH)
async function insertWells(client, programId, wells) {
  let wellOrden = 0;
  for (const well of wells) {
    const wellResult = await client.query(
      'INSERT INTO explosive_program_wells (program_id, pozo, cantidad_etapas, orden) VALUES ($1,$2,$3,$4) RETURNING id',
      [programId, well.pozo, well.cantidad_etapas || null, wellOrden++]
    );
    const wellId = wellResult.rows[0].id;

    let typologyOrden = 0;
    for (const typology of (well.typologies || [])) {
      const tieneTapon = typology.tiene_tapon !== false; // default true
      const typologyResult = await client.query(
        `INSERT INTO explosive_program_typologies
          (program_well_id, nombre, tiene_tapon, tapon_detonador_primario_id, tapon_detonador_secundario_id, tapon_carga_poder_id, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          wellId, typology.nombre || null, tieneTapon,
          tieneTapon ? (typology.tapon_detonador_primario_id || null) : null,
          tieneTapon ? (typology.tapon_detonador_secundario_id || null) : null,
          tieneTapon ? (typology.tapon_carga_poder_id || null) : null,
          typologyOrden++
        ]
      );
      const typologyId = typologyResult.rows[0].id;

      let configOrden = 0;
      for (const config of (typology.configs || [])) {
        if (!config.charge_type_id) continue; // obligatorio, se descarta silenciosamente si falta
        await client.query(
          `INSERT INTO explosive_program_configs
            (typology_id, charge_type_id, gun_od, gun_quantity, gun_length_m,
             gun_phase, spf, perforating_length_m, quantity_charges_per_gun,
             detonator_type_id, detonating_cord_type_id, detonating_cord_length_m, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            typologyId, config.charge_type_id, config.gun_od || null,
            config.gun_quantity || null, config.gun_length_m || null,
            config.gun_phase || null, config.spf || null, config.perforating_length_m || null,
            config.quantity_charges_per_gun || null,
            config.detonator_type_id || null, config.detonating_cord_type_id || null, config.detonating_cord_length_m || null,
            configOrden++
          ]
        );
      }
    }
  }
}

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
       VALUES (COALESCE($1, CURRENT_DATE), $2, $3, $4, $5) RETURNING id`,
      [fecha || null, nombre || null, cliente_id || null, pad || null, req.user.id]
    );
    const programId = programResult.rows[0].id;

    await insertWells(client, programId, wells);

    await client.query('COMMIT');
    const detail = await getProgramDetail(programId);
    res.status(201).json(detail);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el programa de explosivos.' });
  } finally {
    client.release();
  }
});

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
    const detail = await getProgramDetail(id);
    res.json(detail);
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
