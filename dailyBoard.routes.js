const express = require('express');
const multer = require('multer');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

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
  const entriesResult = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha DESC NULLS LAST, daily_board_entries.id DESC
  `);

  const assignmentsResult = await pool.query(`
    SELECT daily_board_assignments.*, personnel.name AS personnel_name
    FROM daily_board_assignments
    LEFT JOIN personnel ON personnel.id = daily_board_assignments.personnel_id
  `);

  const entries = entriesResult.rows.map((entry) => ({
    ...entry,
    assignments: assignmentsResult.rows
      .filter((a) => a.entry_id === entry.id)
      .map((a) => ({ id: a.id, role: a.role, turno: a.turno, personnel_id: a.personnel_id, name: a.personnel_name || a.text_fallback }))
  }));

  res.json(entries);
});

// POST /api/daily-board - crear entrada (Coordinador/Super)
router.post('/', requireRole('coordinador'), async (req, res) => {
  const { estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, comentarios, assignments } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO daily_board_entries
         (estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, comentarios, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [estado || 'proxima_operacion', fecha || null, unidad || null, pozo || null, tipo_unidad || null,
       client_id || null, edp || null, servicios || null, comentarios || null, req.user.id]
    );
    const entry = result.rows[0];

    await replaceAssignments(client, entry.id, assignments);

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

// PATCH /api/daily-board/:id - editar cualquier campo (Coordinador/Super)
const EDITABLE_FIELDS = ['estado', 'fecha', 'unidad', 'pozo', 'tipo_unidad', 'client_id', 'edp', 'servicios', 'comentarios'];
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
  if (setClauses.length === 0 && !hasAssignments) {
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

// DELETE /api/daily-board/:id (Coordinador/Super)
router.delete('/:id', requireRole('coordinador'), async (req, res) => {
  await pool.query('DELETE FROM daily_board_entries WHERE id = $1', [req.params.id]);
  res.status(204).send();
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
// (Estado, Fecha, Unidad, Pozo, Un., Cliente, EDP, Servicios, Supervisor, Comments).
// El Supervisor se carga como texto libre (text_fallback), igual que cuando hoy se escribe
// "nombre no listado" en el picker - queda 100% editable despues desde la UI normal.
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
    const pozo = cellText(v[4]);
    const fecha = parseFecha(v[2]);
    if (!pozo && !fecha) return; // fila vacia
    rows.push({
      estado: parseEstado(v[1]),
      fecha,
      unidad: cellText(v[3]),
      pozo,
      tipo_unidad: cellText(v[5]),
      cliente_nombre: cellText(v[6]),
      edp: cellText(v[7]),
      servicios: cellText(v[8]),
      supervisor: cellText(v[9]),
      comentarios: cellText(v[10])
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
           (estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, comentarios, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [row.estado, row.fecha, row.unidad, row.pozo, row.tipo_unidad, clientId, row.edp, row.servicios, row.comentarios, req.user.id]
      );
      const entryId = entryResult.rows[0].id;

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

// GET /api/daily-board/export - descarga el Excel con el mismo formato de siempre
router.get('/export', async (req, res) => {
  const ExcelJS = require('exceljs');
  const entriesResult = await pool.query(`
    SELECT daily_board_entries.*, clients.name AS client_name
    FROM daily_board_entries
    LEFT JOIN clients ON clients.id = daily_board_entries.client_id
    ORDER BY daily_board_entries.fecha DESC NULLS LAST, daily_board_entries.id DESC
  `);

  const assignmentsResult = await pool.query(`
    SELECT daily_board_assignments.*, personnel.name AS personnel_name
    FROM daily_board_assignments
    LEFT JOIN personnel ON personnel.id = daily_board_assignments.personnel_id
    WHERE role = 'supervisor'
  `);

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

  const headers = ['Estado', 'Fecha', 'Unidad', 'Pozo', 'Un.', 'Cliente', 'EDP', 'Servicios', 'Supervisor', 'Comments'];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  });

  for (const entry of entriesResult.rows) {
    const supDia = assignmentsResult.rows.filter((a) => a.entry_id === entry.id && a.turno === 'dia').map((a) => a.personnel_name || a.text_fallback);
    const supNoche = assignmentsResult.rows.filter((a) => a.entry_id === entry.id && a.turno === 'noche').map((a) => a.personnel_name || a.text_fallback);
    const supervisorCombined = [supDia.join(', '), supNoche.length ? `Noche: ${supNoche.join(', ')}` : ''].filter(Boolean).join(' / ');

    const row = sheet.addRow([
      ESTADO_LABELS[entry.estado] || entry.estado,
      entry.fecha, entry.unidad, entry.pozo, entry.tipo_unidad, entry.client_name, entry.edp, entry.servicios,
      supervisorCombined, entry.comentarios
    ]);
    row.getCell(2).numFmt = 'dd-mmm';
    const color = ESTADO_COLORS[entry.estado];
    if (color) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }

  sheet.columns.forEach((col) => { col.width = 16; });
  sheet.getColumn(10).width = 40;
  sheet.getColumn(1).width = 18;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Parte_Diario.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
