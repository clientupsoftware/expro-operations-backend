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

// ================= TIPOLOGIAS DE CARRERAS (catalogo, reusable entre programas) =================

router.get('/typologies', async (req, res) => {
  const typologiesResult = await pool.query('SELECT * FROM explosive_typologies ORDER BY nombre');
  const typologies = typologiesResult.rows;
  if (typologies.length === 0) return res.json([]);

  const typologyIds = typologies.map((t) => t.id);
  const configsResult = await pool.query(
    'SELECT * FROM explosive_typology_configs WHERE typology_id = ANY($1::int[]) ORDER BY orden',
    [typologyIds]
  );

  res.json(typologies.map((t) => ({
    ...t,
    configs: configsResult.rows.filter((c) => c.typology_id === t.id)
  })));
});

async function insertTypologyConfigs(client, typologyId, configs) {
  let orden = 0;
  for (const config of (configs || [])) {
    if (!config.charge_type_id) continue; // obligatorio, se descarta silenciosamente si falta
    await client.query(
      `INSERT INTO explosive_typology_configs
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
        orden++
      ]
    );
  }
}

router.post('/typologies', requireRole('mantenimiento'), async (req, res) => {
  const {
    nombre, tiene_tapon, tapon_detonador_primario_id, tapon_detonador_secundario_id,
    tapon_carga_poder_id, plug_to_first_cluster_length_m, configs
  } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (!Array.isArray(configs) || configs.length === 0) {
    return res.status(400).json({ error: 'configs (array, al menos 1 configuracion de gun) es requerido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tieneTapon = tiene_tapon !== false;
    const typologyResult = await client.query(
      `INSERT INTO explosive_typologies
        (nombre, tiene_tapon, tapon_detonador_primario_id, tapon_detonador_secundario_id, tapon_carga_poder_id,
         plug_to_first_cluster_length_m, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        nombre, tieneTapon,
        tieneTapon ? (tapon_detonador_primario_id || null) : null,
        tieneTapon ? (tapon_detonador_secundario_id || null) : null,
        tieneTapon ? (tapon_carga_poder_id || null) : null,
        tieneTapon ? (plug_to_first_cluster_length_m || null) : null,
        req.user.id
      ]
    );
    const typologyId = typologyResult.rows[0].id;
    await insertTypologyConfigs(client, typologyId, configs);
    await client.query('COMMIT');

    const full = await pool.query('SELECT * FROM explosive_typologies WHERE id = $1', [typologyId]);
    const fullConfigs = await pool.query('SELECT * FROM explosive_typology_configs WHERE typology_id = $1 ORDER BY orden', [typologyId]);
    res.status(201).json({ ...full.rows[0], configs: fullConfigs.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la tipología.' });
  } finally {
    client.release();
  }
});

router.patch('/typologies/:id', requireRole('mantenimiento'), async (req, res) => {
  const { id } = req.params;
  const {
    nombre, tiene_tapon, tapon_detonador_primario_id, tapon_detonador_secundario_id,
    tapon_carga_poder_id, plug_to_first_cluster_length_m, configs
  } = req.body;

  if (configs !== undefined && (!Array.isArray(configs) || configs.length === 0)) {
    return res.status(400).json({ error: 'Si mandas configs, tiene que ser un array con al menos 1 elemento.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setClauses = [];
    const values = [];
    if (nombre !== undefined) { values.push(nombre); setClauses.push(`nombre = $${values.length}`); }
    if (tiene_tapon !== undefined) {
      values.push(tiene_tapon); setClauses.push(`tiene_tapon = $${values.length}`);
      values.push(tiene_tapon ? (tapon_detonador_primario_id || null) : null); setClauses.push(`tapon_detonador_primario_id = $${values.length}`);
      values.push(tiene_tapon ? (tapon_detonador_secundario_id || null) : null); setClauses.push(`tapon_detonador_secundario_id = $${values.length}`);
      values.push(tiene_tapon ? (tapon_carga_poder_id || null) : null); setClauses.push(`tapon_carga_poder_id = $${values.length}`);
      values.push(tiene_tapon ? (plug_to_first_cluster_length_m || null) : null); setClauses.push(`plug_to_first_cluster_length_m = $${values.length}`);
    }

    if (setClauses.length > 0) {
      values.push(id);
      const result = await client.query(
        `UPDATE explosive_typologies SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Tipología no encontrada.' });
      }
    }

    if (Array.isArray(configs)) {
      await client.query('DELETE FROM explosive_typology_configs WHERE typology_id = $1', [id]);
      await insertTypologyConfigs(client, id, configs);
    }

    await client.query('COMMIT');
    const full = await pool.query('SELECT * FROM explosive_typologies WHERE id = $1', [id]);
    const fullConfigs = await pool.query('SELECT * FROM explosive_typology_configs WHERE typology_id = $1 ORDER BY orden', [id]);
    res.json({ ...full.rows[0], configs: fullConfigs.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al editar la tipología.' });
  } finally {
    client.release();
  }
});

router.delete('/typologies/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM explosive_typologies WHERE id = $1', [req.params.id]);
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

// Trae el detalle completo de un programa: pozos -> vinculos a Tipologias (cada uno con
// su propia cantidad de etapas) -> la Tipologia real viene del catalogo (con sus configs).
// Ademas calcula el consumo total por tipo de explosivo en todo el programa.
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

  const linksResult = wellIds.length
    ? await pool.query('SELECT * FROM explosive_program_well_typologies WHERE program_well_id = ANY($1::int[]) ORDER BY orden', [wellIds])
    : { rows: [] };

  const typologyIds = [...new Set(linksResult.rows.map((l) => l.typology_id))];
  const typologiesResult = typologyIds.length
    ? await pool.query('SELECT * FROM explosive_typologies WHERE id = ANY($1::int[])', [typologyIds])
    : { rows: [] };
  const configsResult = typologyIds.length
    ? await pool.query('SELECT * FROM explosive_typology_configs WHERE typology_id = ANY($1::int[]) ORDER BY orden', [typologyIds])
    : { rows: [] };

  const typesResult = await pool.query('SELECT id, descripcion FROM explosive_types');
  const typeDescById = {};
  typesResult.rows.forEach((t) => { typeDescById[t.id] = t.descripcion; });

  const typologiesById = {};
  typologiesResult.rows.forEach((t) => {
    typologiesById[t.id] = { ...t, configs: configsResult.rows.filter((c) => c.typology_id === t.id) };
  });

  const wells = wellsResult.rows.map((w) => ({
    ...w,
    typology_links: linksResult.rows
      .filter((l) => l.program_well_id === w.id)
      .map((l) => ({ ...l, typology: typologiesById[l.typology_id] || null }))
  }));

  // Consumo total por tipo de explosivo en todo el programa. Por cada vinculo Pozo-Tipologia,
  // usando su propia cantidad_etapas: Tapon (si aplica, 1 vez por etapa) + cada Config de la
  // Tipologia (gun_quantity * cargas/detonador/cordon, por etapa).
  const consumoPorTipo = {};
  function sumar(typeId, cantidad) {
    if (!typeId || !cantidad) return;
    if (!consumoPorTipo[typeId]) {
      consumoPorTipo[typeId] = { explosive_type_id: typeId, descripcion: typeDescById[typeId] || '?', cantidad: 0 };
    }
    consumoPorTipo[typeId].cantidad += cantidad;
  }

  for (const well of wells) {
    for (const link of well.typology_links) {
      const etapas = link.cantidad_etapas || 0;
      const typology = link.typology;
      if (!typology) continue;

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

  return {
    ...program,
    wells,
    consumo_total: Object.values(consumoPorTipo).map((c) => ({ ...c, cantidad: Math.round(c.cantidad * 1000) / 1000 }))
  };
}

router.get('/programs/:id', async (req, res) => {
  const detail = await getProgramDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Programa no encontrado.' });
  res.json(detail);
});

// Inserta wells -> vinculos a Tipologias (cada uno con su propia cantidad_etapas)
async function insertWells(client, programId, wells) {
  let wellOrden = 0;
  for (const well of wells) {
    const wellResult = await client.query(
      'INSERT INTO explosive_program_wells (program_id, pozo, orden) VALUES ($1,$2,$3) RETURNING id',
      [programId, well.pozo, wellOrden++]
    );
    const wellId = wellResult.rows[0].id;

    let linkOrden = 0;
    for (const link of (well.typology_links || [])) {
      if (!link.typology_id) continue; // obligatorio, se descarta silenciosamente si falta
      await client.query(
        'INSERT INTO explosive_program_well_typologies (program_well_id, typology_id, cantidad_etapas, orden) VALUES ($1,$2,$3,$4)',
        [wellId, link.typology_id, link.cantidad_etapas || 0, linkOrden++]
      );
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

// POST /api/explosives/programs/:id/dispatch - despacha stock de este programa hacia un Job.
// items: [{explosive_type_id, cantidad}] - la cantidad final a enviar (puede ser parcial,
// total, o con ajuste manual respecto de lo que calcula el programa). El PAD de destino se
// saca solo del Job elegido (siempre entra al PAD de ese Job).
router.post('/programs/:id/dispatch', requireRole('mantenimiento'), async (req, res) => {
  const { id: programId } = req.params;
  const { job_id, items } = req.body;
  if (!job_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'job_id e items (array, al menos 1) son requeridos.' });
  }

  const jobResult = await pool.query('SELECT pad_id FROM jobs WHERE id = $1', [job_id]);
  if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado.' });
  const padId = jobResult.rows[0].pad_id;
  if (!padId) return res.status(400).json({ error: 'Este Job no tiene un PAD asignado todavia.' });

  const programDetail = await getProgramDetail(programId);
  if (!programDetail) return res.status(404).json({ error: 'Programa no encontrado.' });
  const programadoPorTipo = {};
  programDetail.consumo_total.forEach((c) => { programadoPorTipo[c.explosive_type_id] = c.cantidad; });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dispatchResult = await client.query(
      `INSERT INTO explosive_program_dispatches (program_id, job_id, pad_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [programId, job_id, padId, req.user.id]
    );
    const dispatchId = dispatchResult.rows[0].id;

    let itemsCreados = 0;
    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (!item.explosive_type_id || !cantidad || cantidad <= 0) continue;
      const cantidadProgramada = programadoPorTipo[item.explosive_type_id] || 0;

      await client.query(
        `INSERT INTO explosive_program_dispatch_items (dispatch_id, explosive_type_id, cantidad_programada, cantidad)
         VALUES ($1,$2,$3,$4)`,
        [dispatchId, item.explosive_type_id, cantidadProgramada, cantidad]
      );
      // OJO: el movimiento de stock (entrada) NO se crea aca todavia - queda pendiente
      // hasta que Operaciones confirme la recepcion en pozo (ver POST /dispatches/:id/confirm).
      itemsCreados += 1;
    }

    if (itemsCreados === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ningun item tenia una cantidad valida mayor a 0.' });
    }

    await client.query('COMMIT');
    res.status(201).json({ id: dispatchId, items: itemsCreados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al despachar el programa.' });
  } finally {
    client.release();
  }
});

// GET /api/explosives/programs/:id/dispatches - historial de despachos de este programa
router.get('/programs/:id/dispatches', async (req, res) => {
  const dispatchesResult = await pool.query(`
    SELECT explosive_program_dispatches.*, jobs.job_number, pads.name AS pad_name
    FROM explosive_program_dispatches
    JOIN jobs ON jobs.id = explosive_program_dispatches.job_id
    JOIN pads ON pads.id = explosive_program_dispatches.pad_id
    WHERE program_id = $1 ORDER BY created_at DESC
  `, [req.params.id]);
  const dispatchIds = dispatchesResult.rows.map((d) => d.id);
  const itemsResult = dispatchIds.length
    ? await pool.query(`
        SELECT explosive_program_dispatch_items.*, explosive_types.descripcion
        FROM explosive_program_dispatch_items
        JOIN explosive_types ON explosive_types.id = explosive_program_dispatch_items.explosive_type_id
        WHERE dispatch_id = ANY($1::int[])
      `, [dispatchIds])
    : { rows: [] };

  res.json(dispatchesResult.rows.map((d) => ({
    ...d,
    items: itemsResult.rows.filter((i) => i.dispatch_id === d.id)
  })));
});

// POST /api/explosives/dispatches/:id/confirm - Operaciones confirma que recibio el despacho
// en pozo. Recien aca se genera el movimiento real de entrada de stock (antes solo era un
// "pendiente" - mismo patron que el semaforo Amarillo->Verde de Assets).
router.post('/dispatches/:id/confirm', requireAuth, async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dispatchResult = await client.query('SELECT * FROM explosive_program_dispatches WHERE id = $1', [id]);
    if (dispatchResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Despacho no encontrado.' });
    }
    const dispatch = dispatchResult.rows[0];
    if (dispatch.confirmado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este despacho ya estaba confirmado.' });
    }

    const itemsResult = await client.query(
      `SELECT explosive_program_dispatch_items.*, explosive_types.descripcion
       FROM explosive_program_dispatch_items
       JOIN explosive_types ON explosive_types.id = explosive_program_dispatch_items.explosive_type_id
       WHERE dispatch_id = $1`,
      [id]
    );

    const programResult = await client.query('SELECT nombre FROM explosive_programs WHERE id = $1', [dispatch.program_id]);
    const programNombre = programResult.rows[0]?.nombre || `#${dispatch.program_id}`;

    for (const item of itemsResult.rows) {
      await client.query(
        `INSERT INTO explosive_stock_movements
          (pad_id, explosive_type_id, tipo_movimiento, cantidad, fecha, job_id, dispatch_id, detalle, created_by)
         VALUES ($1,$2,'entrada',$3,CURRENT_DATE,$4,$5,$6,$7)`,
        [dispatch.pad_id, item.explosive_type_id, item.cantidad, dispatch.job_id, dispatch.id,
         `Despacho confirmado - Programa "${programNombre}"`, req.user.id]
      );
    }

    await client.query(
      'UPDATE explosive_program_dispatches SET confirmado = true, confirmado_por = $1, confirmado_at = now() WHERE id = $2',
      [req.user.id, id]
    );

    await client.query('COMMIT');
    res.json({ confirmado: true, items: itemsResult.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al confirmar el despacho.' });
  } finally {
    client.release();
  }
});

// DELETE /api/explosives/dispatches/:id - cancela un despacho que todavia NO fue confirmado
// (si ya esta confirmado, hay stock real de por medio - no se puede borrar asi nomas).
router.delete('/dispatches/:id', requireRole('mantenimiento'), async (req, res) => {
  const dispatchResult = await pool.query('SELECT confirmado FROM explosive_program_dispatches WHERE id = $1', [req.params.id]);
  if (dispatchResult.rows.length === 0) return res.status(404).json({ error: 'Despacho no encontrado.' });
  if (dispatchResult.rows[0].confirmado) {
    return res.status(400).json({ error: 'Este despacho ya fue confirmado - no se puede cancelar (ya genero stock real).' });
  }
  await pool.query('DELETE FROM explosive_program_dispatches WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
