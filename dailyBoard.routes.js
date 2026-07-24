const express = require('express');
const multer = require('multer');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');
const { applyDailyBoardAutoTransitions } = require('./dailyBoardStatusChecker');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(requireAuth);

// Reemplaza todas las asignaciones (supervisor/guinchero/ayudante, dia/noche) de una entrada
async function replaceAssignments(client, entryId, assignments) {
  await client.query('DELETE FROM daily_board_assignments WHERE entry_id = $1', [entryId]);
  if (!Array.isArray(assignments)) return;
  for (const a of assignments) {
    if (!a.role || !a.turno) continue;
    if (!a.personnel_id && !a.text_fallback) continue;
    await client.query(
      `INSERT INTO daily_board_assignments (entry_id, role, turno, personnel_id, text_fallback)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, a.role, a.turno, a.personnel_id || null, a.personnel_id ? null : (a.text_fallback || null)]
    );
  }
}

// GET /api/daily-board - todos los roles ven el tablero completo
router.get('/', async (req, res) => {
  await applyDailyBoardAutoTransitions();

  const entriesResult = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha_inicio DESC NULLS LAST, daily_board_entries.id DESC
  `);

  const assignmentsResult = await pool.query(`
    SELECT daily_board_assignments.*, personnel.name AS personnel_name
    FROM daily_board_assignments
    LEFT JOIN personnel ON personnel.id = daily_board_assignments.personnel_id
  `);

  const commentsResult = await pool.query(`
    SELECT * FROM daily_board_comments ORDER BY fecha ASC
  `);

  const peripheralsResult = await pool.query(`
    SELECT daily_board_entry_peripherals.*, job_peripheral_options.name AS option_name
    FROM daily_board_entry_peripherals
    JOIN job_peripheral_options ON job_peripheral_options.id = daily_board_entry_peripherals.option_id
  `);

  const resourcesResult = await pool.query('SELECT * FROM daily_board_entry_resources');

  const entries = entriesResult.rows.map((entry) => ({
    ...entry,
    assignments: assignmentsResult.rows
      .filter((a) => a.entry_id === entry.id)
      .map((a) => ({ id: a.id, role: a.role, turno: a.turno, personnel_id: a.personnel_id, name: a.personnel_name || a.text_fallback })),
    comments: commentsResult.rows
      .filter((c) => c.entry_id === entry.id)
      .map((c) => ({ fecha: c.fecha.toISOString ? c.fecha.toISOString().slice(0, 10) : c.fecha, comentario: c.comentario })),
    peripherals: peripheralsResult.rows
      .filter((p) => p.entry_id === entry.id)
      .map((p) => ({ option_id: p.option_id, name: p.option_name })),
    resources: resourcesResult.rows
      .filter((r) => r.entry_id === entry.id)
      .map((r) => ({ resource_type: r.resource_type, resource_id: r.resource_id }))
  }));

  res.json(entries);
});

// POST /api/daily-board - crear entrada (Coordinador/Super)
router.post('/', requireRole('coordinador'), async (req, res) => {
  const {
    estado, fecha_inicio, fecha_fin, hora_inicio, hora_fin, unidad, pozo, tipo_unidad,
    client_id, edp, servicios, assignments, peripheral_ids, resources
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO daily_board_entries
         (estado, fecha_inicio, fecha_fin, hora_inicio, hora_fin, unidad, pozo, tipo_unidad, client_id, edp, servicios, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [estado || 'proxima_operacion', fecha_inicio || null, fecha_fin || fecha_inicio || null,
       hora_inicio || null, hora_fin || null, unidad || null, pozo || null,
       tipo_unidad || null, client_id || null, edp || null, servicios || null, req.user.id]
    );
    const entry = result.rows[0];

    await replaceAssignments(client, entry.id, assignments);
    await replacePeripherals(client, entry.id, peripheral_ids);
    await replaceResources(client, entry.id, resources);

    await client.query('COMMIT');
    res.status(201).json(entry);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear la entrada.' });
  } finally {
    client.release();
  }
});

// Reemplaza (delete + insert) los perifericos elegidos para esta entrada.
async function replacePeripherals(client, entryId, peripheralIds) {
  if (!Array.isArray(peripheralIds)) return;
  await client.query('DELETE FROM daily_board_entry_peripherals WHERE entry_id = $1', [entryId]);
  for (const optionId of peripheralIds) {
    await client.query(
      'INSERT INTO daily_board_entry_peripherals (entry_id, option_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [entryId, optionId]
    );
  }
}

// Reemplaza (delete + insert) los recursos adicionales (Unidades de carga, Motocompresor,
// Generador) elegidos para esta entrada. resources: [{resource_type, resource_id}, ...]
async function replaceResources(client, entryId, resources) {
  if (!Array.isArray(resources)) return;
  await client.query('DELETE FROM daily_board_entry_resources WHERE entry_id = $1', [entryId]);
  for (const r of resources) {
    if (!r.resource_type || !r.resource_id) continue;
    await client.query(
      'INSERT INTO daily_board_entry_resources (entry_id, resource_type, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [entryId, r.resource_type, r.resource_id]
    );
  }
}

// PATCH /api/daily-board/:id - editar cualquier campo (Coordinador/Super)
const EDITABLE_FIELDS = ['estado', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin', 'unidad', 'pozo', 'tipo_unidad', 'client_id', 'edp', 'servicios'];
router.patch('/:id', requireRole('coordinador'), async (req, res) => {
  const setClauses = [];
  const values = [];
  EDITABLE_FIELDS.forEach((field) => {
    if (field in req.body) {
      values.push(req.body[field] || null);
      setClauses.push(`${field} = $${values.length}`);
    }
  });
  const hasAssignments = Array.isArray(req.body.assignments);
  const hasPeripherals = Array.isArray(req.body.peripheral_ids);
  const hasResources = Array.isArray(req.body.resources);
  if (setClauses.length === 0 && !hasAssignments && !hasPeripherals && !hasResources) {
    return res.status(400).json({ error: 'Nada para actualizar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let entry;
    if (setClauses.length > 0) {
      values.push(req.params.id);
      const result = await client.query(
        `UPDATE daily_board_entries SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entrada no encontrada.' });
      }
      entry = result.rows[0];
    }

    if (hasAssignments) {
      await replaceAssignments(client, req.params.id, req.body.assignments);
    }
    if (hasPeripherals) {
      await replacePeripherals(client, req.params.id, req.body.peripheral_ids);
    }
    if (hasResources) {
      await replaceResources(client, req.params.id, req.body.resources);
    }

    if (!entry) {
      const current = await client.query('SELECT * FROM daily_board_entries WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entrada no encontrada.' });
      }
      entry = current.rows[0];
    }

    if ('estado' in req.body && entry.job_id) {
      await client.query('UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', [entry.estado, entry.job_id]);
    }

    await client.query('COMMIT');
    res.json(entry);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la entrada.' });
  } finally {
    client.release();
  }
});

// PUT /api/daily-board/:id/comments - upsert del comentario de un dia puntual dentro del
// rango de la entrada. Mandar comentario vacio/null borra el comentario de ese dia.
router.put('/:id/comments', requireRole('coordinador'), async (req, res) => {
  const { fecha, comentario } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha es requerida.' });

  if (!comentario || !comentario.trim()) {
    await pool.query('DELETE FROM daily_board_comments WHERE entry_id = $1 AND fecha = $2', [req.params.id, fecha]);
    return res.json({ fecha, comentario: null });
  }

  const result = await pool.query(
    `INSERT INTO daily_board_comments (entry_id, fecha, comentario, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (entry_id, fecha) DO UPDATE SET comentario = $3, updated_by = $4, updated_at = now()
     RETURNING fecha, comentario`,
    [req.params.id, fecha, comentario.trim(), req.user.id]
  );
  res.json(result.rows[0]);
});

// DELETE /api/daily-board/:id (Coordinador/Super)
router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM daily_board_entries WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// POST /api/daily-board/:id/duplicate - copia esta entrada a una nueva (misma unidad, pozo,
// cliente, servicios, supervisor/guinchero/ayudante, etc.), lista para ajustar y guardar.
// No hereda el estado (arranca en Prox. Operacion), el vinculo a Job, ni los comentarios por
// dia (son especificos de la entrada original).
router.post('/:id/duplicate', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalResult = await client.query('SELECT * FROM daily_board_entries WHERE id = $1', [id]);
    if (originalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entrada no encontrada.' });
    }
    const o = originalResult.rows[0];

    const insertedResult = await client.query(
      `INSERT INTO daily_board_entries
         (estado, fecha_inicio, fecha_fin, hora_inicio, hora_fin, unidad, pozo, tipo_unidad, client_id, edp, servicios, created_by)
       VALUES ('proxima_operacion', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [o.fecha_inicio, o.fecha_fin, o.hora_inicio, o.hora_fin, o.unidad, o.pozo, o.tipo_unidad, o.client_id, o.edp, o.servicios, req.user.id]
    );
    const newEntry = insertedResult.rows[0];

    const assignmentsResult = await client.query(
      'SELECT role, turno, personnel_id, text_fallback FROM daily_board_assignments WHERE entry_id = $1',
      [id]
    );
    for (const a of assignmentsResult.rows) {
      await client.query(
        'INSERT INTO daily_board_assignments (entry_id, role, turno, personnel_id, text_fallback) VALUES ($1,$2,$3,$4,$5)',
        [newEntry.id, a.role, a.turno, a.personnel_id, a.text_fallback]
      );
    }

    const peripheralsToCopy = await client.query(
      'SELECT option_id FROM daily_board_entry_peripherals WHERE entry_id = $1',
      [id]
    );
    for (const p of peripheralsToCopy.rows) {
      await client.query('INSERT INTO daily_board_entry_peripherals (entry_id, option_id) VALUES ($1, $2)', [newEntry.id, p.option_id]);
    }

    const resourcesToCopy = await client.query(
      'SELECT resource_type, resource_id FROM daily_board_entry_resources WHERE entry_id = $1',
      [id]
    );
    for (const r of resourcesToCopy.rows) {
      await client.query(
        'INSERT INTO daily_board_entry_resources (entry_id, resource_type, resource_id) VALUES ($1, $2, $3)',
        [newEntry.id, r.resource_type, r.resource_id]
      );
    }

    await client.query('COMMIT');

    const assignmentsWithNames = await pool.query(`
      SELECT daily_board_assignments.*, personnel.name AS personnel_name
      FROM daily_board_assignments
      LEFT JOIN personnel ON personnel.id = daily_board_assignments.personnel_id
      WHERE entry_id = $1
    `, [newEntry.id]);

    const peripheralsWithNames = await pool.query(`
      SELECT daily_board_entry_peripherals.*, job_peripheral_options.name AS option_name
      FROM daily_board_entry_peripherals
      JOIN job_peripheral_options ON job_peripheral_options.id = daily_board_entry_peripherals.option_id
      WHERE entry_id = $1
    `, [newEntry.id]);

    const resourcesForNewEntry = await pool.query(
      'SELECT resource_type, resource_id FROM daily_board_entry_resources WHERE entry_id = $1',
      [newEntry.id]
    );

    res.status(201).json({
      ...newEntry,
      assignments: assignmentsWithNames.rows.map((a) => ({
        id: a.id, role: a.role, turno: a.turno, personnel_id: a.personnel_id, name: a.personnel_name || a.text_fallback
      })),
      peripherals: peripheralsWithNames.rows.map((p) => ({ option_id: p.option_id, name: p.option_name })),
      resources: resourcesForNewEntry.rows,
      comments: []
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al duplicar la entrada.' });
  } finally {
    client.release();
  }
});

// POST /api/daily-board/:id/promote - convierte la entrada en un Job real (PreJob)
router.post('/:id/promote', requireRole('coordinador'), async (req, res) => {
  const { id } = req.params;

  const entryResult = await pool.query('SELECT * FROM daily_board_entries WHERE id = $1', [id]);
  if (entryResult.rows.length === 0) return res.status(404).json({ error: 'Entrada no encontrada.' });
  const entry = entryResult.rows[0];

  if (!entry.client_id) return res.status(400).json({ error: 'La entrada necesita un cliente asignado antes de enviarla a PreJob.' });
  if (!entry.pozo) return res.status(400).json({ error: 'La entrada necesita un pozo cargado antes de enviarla a PreJob.' });
  if (entry.job_id) return res.status(400).json({ error: 'Esta entrada ya fue enviada a PreJob.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let padResult = await client.query('SELECT * FROM pads WHERE name = $1 AND client_id = $2', [entry.pozo, entry.client_id]);
    let pad = padResult.rows[0];
    if (!pad) {
      const inserted = await client.query('INSERT INTO pads (name, client_id) VALUES ($1, $2) RETURNING *', [entry.pozo, entry.client_id]);
      pad = inserted.rows[0];
    }

    let wellResult = await client.query('SELECT * FROM wells WHERE name = $1 AND pad_id = $2', [entry.pozo, pad.id]);
    let well = wellResult.rows[0];
    if (!well) {
      const inserted = await client.query('INSERT INTO wells (name, pad_id) VALUES ($1, $2) RETURNING *', [entry.pozo, pad.id]);
      well = inserted.rows[0];
    }

    const serviceNames = (entry.servicios || '').split(/[+/,]/).map((s) => s.trim()).filter(Boolean);
    const serviceIds = [];
    for (const name of serviceNames) {
      let svcResult = await client.query('SELECT * FROM services WHERE LOWER(name) = LOWER($1)', [name]);
      let svc = svcResult.rows[0];
      if (!svc) {
        const inserted = await client.query('INSERT INTO services (name) VALUES ($1) RETURNING *', [name]);
        svc = inserted.rows[0];
      }
      serviceIds.push(svc.id);
    }

    const jobResult = await client.query(
      `INSERT INTO jobs (pad_id, created_by, status) VALUES ($1, $2, $3) RETURNING *`,
      [pad.id, req.user.id, entry.estado]
    );
    const job = jobResult.rows[0];

    await client.query('INSERT INTO job_wells (job_id, well_id) VALUES ($1, $2)', [job.id, well.id]);
    for (const serviceId of serviceIds) {
      await client.query('INSERT INTO job_services (job_id, service_id) VALUES ($1, $2)', [job.id, serviceId]);
    }

    // Los perifericos elegidos en el Parte Diario quedan preseleccionados en el Job real.
    const peripheralsResult = await client.query(
      'SELECT option_id FROM daily_board_entry_peripherals WHERE entry_id = $1',
      [id]
    );
    for (const p of peripheralsResult.rows) {
      await client.query('INSERT INTO job_peripherals (job_id, option_id) VALUES ($1, $2)', [job.id, p.option_id]);
    }

    await client.query(`UPDATE daily_board_entries SET job_id = $1, updated_at = now() WHERE id = $2`, [job.id, id]);

    await client.query('COMMIT');
    res.status(201).json({ job, message: 'Job creado y enviado a PreJob.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la entrada a PreJob.' });
  } finally {
    client.release();
  }
});

// POST /api/daily-board/import - carga masiva desde un Excel con el mismo formato de "Exportar a Excel"
// (Estado, Fecha Inicio, Fecha Fin, Unidad, Pozo, Un., Cliente, EDP, Servicios, Supervisor, Comments).
// El Supervisor se carga como texto libre (text_fallback), igual que cuando hoy se escribe
// "nombre no listado" en el picker - queda 100% editable despues desde la UI normal.
// El comentario importado (si viene) se guarda como el comentario del dia de fecha_inicio;
// para aclarar dia por dia hay que editarlo despues desde la UI.
router.post('/import', requireRole('coordinador'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "file").' });

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo leer el archivo. Verifica que sea un .xlsx valido.' });
  }

  const ESTADO_LABEL_TO_VALUE = {
    'prox. op': 'proxima_operacion',
    'en op.': 'en_operacion',
    'op. finalizada': 'operacion_finalizada',
    'op. cancelada': 'operacion_cancelada',
    'op. rechazada': 'operacion_rechazada'
  };

  function parseEstado(value) {
    if (!value) return 'proxima_operacion';
    const normalized = String(value).trim().toLowerCase();
    return ESTADO_LABEL_TO_VALUE[normalized] || 'proxima_operacion';
  }

  function parseFecha(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  function cellText(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
  }

  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // encabezado
    const v = row.values; // v[0] vacio en exceljs, columnas arrancan en v[1]
    const pozo = cellText(v[5]);
    const fechaInicio = parseFecha(v[2]);
    if (!pozo && !fechaInicio) return; // fila vacia
    rows.push({
      estado: parseEstado(v[1]),
      fecha_inicio: fechaInicio,
      fecha_fin: parseFecha(v[3]) || fechaInicio,
      unidad: cellText(v[4]),
      pozo,
      tipo_unidad: cellText(v[6]),
      cliente_nombre: cellText(v[7]),
      edp: cellText(v[8]),
      servicios: cellText(v[9]),
      supervisor: cellText(v[10]),
      comentarios: cellText(v[11])
    });
  });

  if (rows.length === 0) return res.status(400).json({ error: 'El archivo no tiene filas para importar.' });

  const client = await pool.connect();
  let created = 0;
  const clientIdCache = {};
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      let clientId = null;
      if (row.cliente_nombre) {
        const key = row.cliente_nombre.toLowerCase();
        if (clientIdCache[key]) {
          clientId = clientIdCache[key];
        } else {
          const existing = await client.query('SELECT id FROM clients WHERE LOWER(name) = LOWER($1)', [row.cliente_nombre]);
          if (existing.rows.length > 0) {
            clientId = existing.rows[0].id;
          } else {
            const inserted = await client.query('INSERT INTO clients (name) VALUES ($1) RETURNING id', [row.cliente_nombre]);
            clientId = inserted.rows[0].id;
          }
          clientIdCache[key] = clientId;
        }
      }

      const entryResult = await client.query(
        `INSERT INTO daily_board_entries
           (estado, fecha_inicio, fecha_fin, unidad, pozo, tipo_unidad, client_id, edp, servicios, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [row.estado, row.fecha_inicio, row.fecha_fin, row.unidad, row.pozo, row.tipo_unidad, clientId, row.edp, row.servicios, req.user.id]
      );
      const entryId = entryResult.rows[0].id;

      if (row.comentarios && row.fecha_inicio) {
        await client.query(
          'INSERT INTO daily_board_comments (entry_id, fecha, comentario, updated_by) VALUES ($1, $2, $3, $4)',
          [entryId, row.fecha_inicio, row.comentarios, req.user.id]
        );
      }

      if (row.supervisor) {
        await client.query(
          `INSERT INTO daily_board_assignments (entry_id, role, turno, personnel_id, text_fallback)
           VALUES ($1, 'supervisor', 'dia', NULL, $2)`,
          [entryId, row.supervisor]
        );
      }

      created += 1;
    }

    await client.query('COMMIT');
    res.json({ message: 'Importacion completa.', created, total_procesados: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error durante la importacion. No se guardo ningun cambio.' });
  } finally {
    client.release();
  }
});

// Genera el mismo Workbook que ya arma "Exportar a Excel" - se comparte entre el endpoint
// de descarga y el de envio por email, para que ambos queden siempre identicos.
async function buildDailyBoardWorkbook() {
  const ExcelJS = require('exceljs');
  const entriesResult = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha_inicio DESC NULLS LAST, daily_board_entries.id DESC
  `);

  const assignmentsResult = await pool.query(`
    SELECT daily_board_assignments.*, personnel.name AS personnel_name
    FROM daily_board_assignments
    LEFT JOIN personnel ON personnel.id = daily_board_assignments.personnel_id
    WHERE role = 'supervisor'
  `);

  const commentsResult = await pool.query(`SELECT * FROM daily_board_comments ORDER BY fecha ASC`);

  const ESTADO_LABELS = {
    proxima_operacion: 'Prox. Op', en_operacion: 'En Op.', operacion_finalizada: 'Op. Finalizada',
    operacion_cancelada: 'Op. Cancelada', operacion_rechazada: 'Op. Rechazada'
  };
  const ESTADO_COLORS = {
    proxima_operacion: 'FFF6C244', en_operacion: 'FF7C5CFF', operacion_finalizada: 'FFD9E1F2',
    operacion_cancelada: 'FFF4B3B3', operacion_rechazada: 'FFF4B3B3'
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Parte Diario');

  const headers = ['Estado', 'Fecha Inicio', 'Fecha Fin', 'Unidad', 'Pozo', 'Un.', 'Cliente', 'EDP', 'Servicios', 'Supervisor', 'Comments'];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  });

  for (const entry of entriesResult.rows) {
    const supDia = assignmentsResult.rows.filter((a) => a.entry_id === entry.id && a.turno === 'dia').map((a) => a.personnel_name || a.text_fallback);
    const supNoche = assignmentsResult.rows.filter((a) => a.entry_id === entry.id && a.turno === 'noche').map((a) => a.personnel_name || a.text_fallback);
    const supervisorCombined = [supDia.join(', '), supNoche.length ? `Noche: ${supNoche.join(', ')}` : ''].filter(Boolean).join(' / ');

    const commentsCombined = commentsResult.rows
      .filter((c) => c.entry_id === entry.id && c.comentario)
      .map((c) => `${c.fecha.toISOString ? c.fecha.toISOString().slice(0, 10) : c.fecha}: ${c.comentario}`)
      .join(' | ');

    const row = sheet.addRow([
      ESTADO_LABELS[entry.estado] || entry.estado,
      entry.fecha_inicio, entry.fecha_fin, entry.unidad, entry.pozo, entry.tipo_unidad, entry.client_name, entry.edp, entry.servicios,
      supervisorCombined, commentsCombined
    ]);
    row.getCell(2).numFmt = 'dd-mmm';
    row.getCell(3).numFmt = 'dd-mmm';
    const color = ESTADO_COLORS[entry.estado];
    if (color) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }

  sheet.columns.forEach((col) => { col.width = 16; });
  sheet.getColumn(11).width = 50;
  sheet.getColumn(1).width = 18;

  return workbook;
}

// GET /api/daily-board/export - descarga el Excel con el mismo formato de siempre
router.get('/export', async (req, res) => {
  const workbook = await buildDailyBoardWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Parte_Diario.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= DESTINATARIOS FRECUENTES (boton "Enviar por Email") =================

router.get('/email-recipients', async (req, res) => {
  const result = await pool.query('SELECT * FROM daily_board_email_recipients ORDER BY nombre, email');
  res.json(result.rows);
});

router.post('/email-recipients', requireRole('coordinador'), async (req, res) => {
  const { nombre, email } = req.body;
  if (!email || !email.trim()) return res.status(400).json({ error: 'email es requerido.' });
  const result = await pool.query(
    'INSERT INTO daily_board_email_recipients (nombre, email) VALUES ($1, $2) RETURNING *',
    [nombre || null, email.trim()]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/email-recipients/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM daily_board_email_recipients WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// POST /api/daily-board/send-email - manda el Parte Diario (Excel adjunto + captura del
// Gantt incrustada, generada por el frontend) a los destinatarios elegidos.
router.post('/send-email', requireRole('coordinador'), async (req, res) => {
  const { recipient_ids, gantt_image_base64 } = req.body;
  if (!Array.isArray(recipient_ids) || recipient_ids.length === 0) {
    return res.status(400).json({ error: 'Elegi al menos un destinatario.' });
  }

  const recipientsResult = await pool.query(
    'SELECT email FROM daily_board_email_recipients WHERE id = ANY($1::int[])',
    [recipient_ids]
  );
  const recipients = recipientsResult.rows.map((r) => r.email);
  if (recipients.length === 0) return res.status(400).json({ error: 'No se encontraron los destinatarios elegidos.' });

  const { sendDailyBoardEmail } = require('./emailService');
  const workbook = await buildDailyBoardWorkbook();
  const excelBuffer = await workbook.xlsx.writeBuffer();

  const today = new Date();
  const MONTH_LABELS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const excelFilename = `Parte diario ${String(today.getDate()).padStart(2, '0')}-${MONTH_LABELS_ES[today.getMonth()]}.xlsx`;

  try {
    await sendDailyBoardEmail({
      recipients,
      excelBuffer: Buffer.from(excelBuffer),
      excelFilename,
      ganttImageBase64: gantt_image_base64 || null
    });
    res.json({ sent: true, recipients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el email: ' + err.message });
  }
});

module.exports = router;
