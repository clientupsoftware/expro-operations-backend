const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

// Envuelve cualquier handler async: si algo tira un error (ej: una columna que ya no existe,
// una migracion que falta correr, etc.) devuelve un JSON 500 en vez de tirar abajo el proceso.
function ah(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Error interno del servidor.' });
      }
    });
  };
}

// ================= CUADRILLAS (ciclo configurable: N dias trabajo x M dias descanso) =================

router.get('/crews', ah(async (req, res) => {
  const result = await pool.query('SELECT * FROM crews ORDER BY name');
  res.json(result.rows);
}));

router.post('/crews', requireRole('coordinador'), ah(async (req, res) => {
  const { name, cycle_start_date, work_days, rest_days } = req.body;
  if (!name || !cycle_start_date) return res.status(400).json({ error: 'name y cycle_start_date son requeridos.' });
  const result = await pool.query(
    'INSERT INTO crews (name, cycle_start_date, work_days, rest_days) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, cycle_start_date, work_days || 14, rest_days || 7]
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/crews/:id', requireRole('coordinador'), ah(async (req, res) => {
  const { name, cycle_start_date, work_days, rest_days } = req.body;
  const result = await pool.query(
    'UPDATE crews SET name = $1, cycle_start_date = $2, work_days = $3, rest_days = $4 WHERE id = $5 RETURNING *',
    [name, cycle_start_date, work_days || 14, rest_days || 7, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Cuadrilla no encontrada.' });
  res.json(result.rows[0]);
}));

router.delete('/crews/:id', requireRole('coordinador'), ah(async (req, res) => {
  await pool.query('DELETE FROM crews WHERE id = $1', [req.params.id]);
  res.status(204).send();
}));

// ================= PERSONAL =================

function buildFullName(apellido, nombre) {
  return [apellido, nombre].filter(Boolean).join(', ');
}

router.get('/', ah(async (req, res) => {
  const result = await pool.query(`
    SELECT personnel.*, crews.name AS crew_name, crews.cycle_start_date, crews.work_days, crews.rest_days
    FROM personnel
    LEFT JOIN crews ON crews.id = personnel.crew_id
    ORDER BY personnel.apellido, personnel.nombre
  `);
  res.json(result.rows);
}));

router.post('/', requireRole('coordinador'), ah(async (req, res) => {
  const { apellido, nombre, convenio, puesto, crew_id, numero_empleado, dni_cuit } = req.body;
  if (!apellido || !nombre) return res.status(400).json({ error: 'apellido y nombre son requeridos.' });
  const name = buildFullName(apellido, nombre);
  const result = await pool.query(
    `INSERT INTO personnel (name, apellido, nombre, convenio, puesto, crew_id, numero_empleado, dni_cuit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, apellido, nombre, convenio || null, puesto || null,
     crew_id || null, numero_empleado || null, dni_cuit || null]
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', requireRole('coordinador'), ah(async (req, res) => {
  const { apellido, nombre, convenio, puesto, crew_id, active, numero_empleado, dni_cuit } = req.body;
  const name = buildFullName(apellido, nombre);
  const result = await pool.query(
    `UPDATE personnel SET
       name = $1, apellido = $2, nombre = $3, convenio = $4, puesto = $5,
       crew_id = $6, active = $7, numero_empleado = $8, dni_cuit = $9
     WHERE id = $10 RETURNING *`,
    [name, apellido, nombre, convenio || null, puesto || null,
     crew_id || null, active !== undefined ? active : true, numero_empleado || null, dni_cuit || null,
     req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Persona no encontrada.' });
  res.json(result.rows[0]);
}));

router.delete('/:id', requireRole('coordinador'), ah(async (req, res) => {
  await pool.query('DELETE FROM personnel WHERE id = $1', [req.params.id]);
  res.status(204).send();
}));

// PATCH /api/personnel/bulk-crew - asignar una cuadrilla a varias personas de una vez
router.patch('/bulk-crew', requireRole('coordinador'), ah(async (req, res) => {
  const { personnel_ids, crew_id } = req.body;
  if (!Array.isArray(personnel_ids) || personnel_ids.length === 0) {
    return res.status(400).json({ error: 'personnel_ids (array) es requerido.' });
  }
  await pool.query(
    'UPDATE personnel SET crew_id = $1 WHERE id = ANY($2::int[])',
    [crew_id || null, personnel_ids]
  );
  res.json({ updated: personnel_ids.length });
}));

// ---------- CARGA MASIVA DESDE EXCEL ----------

const IMPORT_HEADERS = ['Apellido', 'Nombre', 'Convenio', 'Puesto', 'Numero de Empleado', 'DNI/CUIT'];

// GET /api/personnel/import-template - descarga una plantilla en blanco con las columnas correctas
router.get('/import-template', ah(async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Personal');
  const headerRow = sheet.addRow(IMPORT_HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  sheet.addRow(['Perez', 'Juan', 'Privados', 'Guinchero', '1234', '20-12345678-9']);
  sheet.columns.forEach((col) => { col.width = 22; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Alta_Personal.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}));

// POST /api/personnel/import - sube el Excel completado y crea el personal en bloque (Coordinador/Super)
router.post('/import', requireRole('coordinador'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "file").' });

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo leer el archivo. Verifica que sea un .xlsx valido.' });
  }

  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // encabezado
    const values = row.values; // values[0] esta vacio en exceljs
    const apellido = values[1];
    const nombre = values[2];
    const convenio = values[3];
    const puesto = values[4];
    const numeroEmpleado = values[5];
    const dniCuit = values[6];
    if (apellido || nombre) {
      rows.push({
        apellido: apellido ? String(apellido).trim() : null,
        nombre: nombre ? String(nombre).trim() : null,
        convenio: convenio ? String(convenio).trim() : null,
        puesto: puesto ? String(puesto).trim() : null,
        numero_empleado: numeroEmpleado ? String(numeroEmpleado).trim() : null,
        dni_cuit: dniCuit ? String(dniCuit).trim() : null
      });
    }
  });

  if (rows.length === 0) return res.status(400).json({ error: 'El archivo no tiene filas para importar.' });

  const client = await pool.connect();
  let created = 0;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      if (!row.apellido || !row.nombre) continue;
      const name = buildFullName(row.apellido, row.nombre);
      await client.query(
        `INSERT INTO personnel (name, apellido, nombre, convenio, puesto, numero_empleado, dni_cuit)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [name, row.apellido, row.nombre, row.convenio, row.puesto, row.numero_empleado, row.dni_cuit]
      );
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
}));

// ================= EXCEPCIONES (franco compensatorio, franco trabajado, licencia, curso, etc.) =================

router.get('/overrides', ah(async (req, res) => {
  const result = await pool.query(`
    SELECT personnel_status_overrides.*, personnel.name AS personnel_name
    FROM personnel_status_overrides
    JOIN personnel ON personnel.id = personnel_status_overrides.personnel_id
    ORDER BY date_from DESC
  `);
  res.json(result.rows);
}));

router.post('/overrides', requireRole('coordinador'), ah(async (req, res) => {
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
}));

// PUT /api/personnel/overrides/:id - editar una excepcion ya cargada (por si se cargo mal)
router.put('/overrides/:id', requireRole('coordinador'), ah(async (req, res) => {
  const { personnel_id, status, date_from, date_to, notas } = req.body;
  if (!personnel_id || !status || !date_from || !date_to) {
    return res.status(400).json({ error: 'personnel_id, status, date_from y date_to son requeridos.' });
  }
  const result = await pool.query(
    `UPDATE personnel_status_overrides SET personnel_id = $1, status = $2, date_from = $3, date_to = $4, notas = $5
     WHERE id = $6 RETURNING *`,
    [personnel_id, status, date_from, date_to, notas || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Excepcion no encontrada.' });
  res.json(result.rows[0]);
}));

router.delete('/overrides/:id', requireRole('coordinador'), ah(async (req, res) => {
  await pool.query('DELETE FROM personnel_status_overrides WHERE id = $1', [req.params.id]);
  res.status(204).send();
}));

// ================= ESTADO CALCULADO Y ESTADISTICAS =================

// Calcula si, segun el ciclo configurable de la cuadrilla (work_days x rest_days), esa fecha cae en diagrama o en franco
function computeCycleStatus(crew, targetDate) {
  if (!crew || !crew.cycle_start_date) return 'sin_cuadrilla';
  const workDays = crew.work_days || 14;
  const restDays = crew.rest_days || 7;
  const cycleLength = workDays + restDays;
  const start = new Date(crew.cycle_start_date);
  const target = new Date(targetDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.round((target - start) / msPerDay);
  const mod = ((diffDays % cycleLength) + cycleLength) % cycleLength;
  return mod < workDays ? 'en_diagrama' : 'franco';
}

router.get('/status', ah(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const personnelResult = await pool.query(`
    SELECT personnel.*, crews.name AS crew_name, crews.cycle_start_date, crews.work_days, crews.rest_days
    FROM personnel
    LEFT JOIN crews ON crews.id = personnel.crew_id
    WHERE personnel.active = true
    ORDER BY personnel.apellido, personnel.nombre
  `);

  const overridesResult = await pool.query(
    'SELECT * FROM personnel_status_overrides WHERE date_from <= $1 AND date_to >= $1',
    [date]
  );
  const overridesByPerson = {};
  overridesResult.rows.forEach((o) => { overridesByPerson[o.personnel_id] = o; });

  const withStatus = personnelResult.rows.map((p) => {
    const cycleStatus = computeCycleStatus(p, date);
    const override = overridesByPerson[p.id];
    return {
      ...p,
      cycle_status: cycleStatus,
      override_status: override ? override.status : null,
      final_status: override ? override.status : cycleStatus
    };
  });

  res.json({ date, personnel: withStatus });
}));

router.get('/stats', ah(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const personnelResult = await pool.query(`
    SELECT personnel.*, crews.cycle_start_date, crews.work_days, crews.rest_days
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
    const cycleStatus = computeCycleStatus(p, date);
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
}));

module.exports = router;
