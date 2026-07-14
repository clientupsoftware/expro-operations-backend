// seed_demo.js
// Carga un set de datos 100% ficticios para el entorno de demostración.
// Pensado para correr contra una base recien vaciada (ver demo.routes.js -> reset).
// Se puede usar de 2 formas:
//   1) Linea de comandos: node seed_demo.js
//   2) Importado desde otro archivo: const { seedDemo } = require('./seed_demo'); await seedDemo(pool);
const bcrypt = require('bcryptjs');

async function seedDemo(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---------- USUARIOS DEMO ----------
    console.log('Creando usuarios demo...');
    const demoPassword = await bcrypt.hash('demo2026', 10);
    const userRows = {};
    const users = [
      { key: 'super', name: 'Admin Demo', email: 'demo@wellops.com', role: 'super' },
      { key: 'coordinador', name: 'Laura Ibarra (Coordinadora)', email: 'coordinador@demo.wellops.com', role: 'coordinador' },
      { key: 'mantenimiento', name: 'Diego Farías (Mantenimiento)', email: 'mantenimiento@demo.wellops.com', role: 'mantenimiento' },
      { key: 'ingeniero', name: 'Marina Solis (Ingeniera)', email: 'ingeniero@demo.wellops.com', role: 'ingeniero' }
    ];
    for (const u of users) {
      const res = await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
        [u.name, u.email, demoPassword, u.role]
      );
      userRows[u.key] = res.rows[0].id;
    }

    // ---------- CATALOGOS ----------
    console.log('Creando catalogos base...');
    const clientIds = {};
    for (const name of ['Austral Energy', 'PetroDemo S.A.', 'Cuenca Sur Petróleo']) {
      const r = await client.query('INSERT INTO clients (name) VALUES ($1) RETURNING id', [name]);
      clientIds[name] = r.rows[0].id;
    }

    const serviceIds = {};
    for (const name of ['CBL', 'Plug & Perf', 'WL', 'Punzado', 'Pistoneo']) {
      const r = await client.query('INSERT INTO services (name) VALUES ($1) RETURNING id', [name]);
      serviceIds[name] = r.rows[0].id;
    }

    for (const name of ['Supervisor', 'Guinchero', 'Ayudante']) {
      await client.query('INSERT INTO personnel_positions (name) VALUES ($1)', [name]);
    }
    for (const name of ['Camión', 'Trailer', 'Grúa']) {
      await client.query('INSERT INTO physical_units (name) VALUES ($1)', [name]);
    }
    for (const name of ['WL', 'SLK', 'WO']) {
      await client.query('INSERT INTO unit_types (name) VALUES ($1)', [name]);
    }
    for (const name of ['Grúa auxiliar', 'Unidad de bombeo', 'Generador']) {
      await client.query('INSERT INTO job_peripheral_options (name) VALUES ($1)', [name]);
    }
    for (const name of ['Carrera de logging', 'Punzado', 'Pistoneo', 'CBL', 'Rig Down', 'Rig Up']) {
      await client.query('INSERT INTO time_report_operations (name) VALUES ($1)', [name]);
    }

    // ---------- PADS Y POZOS ----------
    console.log('Creando pads y pozos...');
    const padWell = []; // [{padId, wellId, padName, wellName, clientId}]
    const padPlan = [
      { client: 'Austral Energy', pad: 'AE-Norte 1105', wells: ['AE-1105'] },
      { client: 'Austral Energy', pad: 'AE-Sur 2280', wells: ['AE-2280', 'AE-2281'] },
      { client: 'PetroDemo S.A.', pad: 'PD-Centro 340', wells: ['PD-340'] },
      { client: 'Cuenca Sur Petróleo', pad: 'CSP-Oeste 88', wells: ['CSP-088'] }
    ];
    for (const p of padPlan) {
      const padRes = await client.query('INSERT INTO pads (name, client_id) VALUES ($1,$2) RETURNING id', [p.pad, clientIds[p.client]]);
      for (const wellName of p.wells) {
        const wellRes = await client.query('INSERT INTO wells (name, pad_id) VALUES ($1,$2) RETURNING id', [wellName, padRes.rows[0].id]);
        padWell.push({ padId: padRes.rows[0].id, wellId: wellRes.rows[0].id, padName: p.pad, wellName, clientId: clientIds[p.client] });
      }
    }

    // ---------- EQUIPOS Y ASSETS ----------
    console.log('Creando catalogo de equipos y assets...');
    const catalogIds = {};
    const catalogPlan = [
      { category: 'Truck', model: 'Camión Wireline 12Ton', mode: 'operacion' },
      { category: 'Set/PCE', model: 'Set de Presión Estándar', mode: 'carrera' },
      { category: 'Sheave', model: 'Sheave 22" G2', mode: 'operacion' },
      { category: 'HLA', model: 'HLA Standard', mode: 'carrera' },
      { category: 'CCL', model: 'CCL Colision Locator', mode: 'carrera' }
    ];
    for (const c of catalogPlan) {
      const r = await client.query(
        'INSERT INTO equipment_catalog (category, model_description, counting_mode) VALUES ($1,$2,$3) RETURNING id',
        [c.category, c.model, c.mode]
      );
      catalogIds[c.model] = r.rows[0].id;
    }

    const today = new Date();
    function daysFromNow(n) {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    }

    const assetPlan = [
      { code: 'DEMO-TRK-101', desc: 'Camión Wireline 12Ton #1', type: 'Truck', model: 'Camión Wireline 12Ton', runs: 42, ops: 118, certDays: 45 },
      { code: 'DEMO-TRK-102', desc: 'Camión Wireline 12Ton #2', type: 'Truck', model: 'Camión Wireline 12Ton', runs: 18, ops: 60, certDays: 12 }, // por vencer
      { code: 'DEMO-PCE-201', desc: 'Set de Presión Estándar #1', type: 'Set/PCE', model: 'Set de Presión Estándar', runs: 76, ops: 76, certDays: 90 },
      { code: 'DEMO-PCE-202', desc: 'Set de Presión Estándar #2', type: 'Set/PCE', model: 'Set de Presión Estándar', runs: 30, ops: 30, certDays: 5 }, // por vencer
      { code: 'DEMO-SHV-301', desc: 'Sheave 22" G2 #1', type: 'Sheave', model: 'Sheave 22" G2', runs: 12, ops: 55, certDays: 200 },
      { code: 'DEMO-HLA-401', desc: 'HLA Standard #1', type: 'HLA', model: 'HLA Standard', runs: 64, ops: 64, certDays: 150 },
      { code: 'DEMO-CCL-501', desc: 'CCL Colision Locator #1', type: 'CCL', model: 'CCL Colision Locator', runs: 21, ops: 21, certDays: 300 }
    ];
    const assetIds = {};
    for (const a of assetPlan) {
      const r = await client.query(
        `INSERT INTO assets
          (equipment_catalog_id, sap_equipment_code, description, equipment_type, serial_number, system_status,
           current_location, cumulative_runs, cumulative_operations, cert_annual_expiry, cert_calibration_expiry)
         VALUES ($1,$2,$3,$4,$5,'AVLB',$6,$7,$8,$9,$9) RETURNING id`,
        [catalogIds[a.model], a.code, a.desc, a.type, `SN-${a.code}`, 'Base Neuquén', a.runs, a.ops, daysFromNow(a.certDays)]
      );
      assetIds[a.code] = r.rows[0].id;
    }

    // ---------- KIT ----------
    const kitRes = await client.query(
      'INSERT INTO kit_templates (name, category, created_by) VALUES ($1,$2,$3) RETURNING id',
      ['Set Estándar Wireline', 'Set/PCE', userRows.mantenimiento]
    );
    for (const code of ['DEMO-PCE-201', 'DEMO-SHV-301', 'DEMO-HLA-401']) {
      await client.query('INSERT INTO kit_template_items (kit_template_id, asset_id, quantity) VALUES ($1,$2,1)', [kitRes.rows[0].id, assetIds[code]]);
    }

    // ---------- CUADRILLAS Y PERSONAL ----------
    console.log('Creando cuadrillas y personal...');
    const crewIds = {};
    for (const c of [
      { name: 'Cuadrilla Azul', start: daysFromNow(-5), work: 14, rest: 7 },
      { name: 'Cuadrilla Verde', start: daysFromNow(-2), work: 14, rest: 7 }
    ]) {
      const r = await client.query(
        'INSERT INTO crews (name, cycle_start_date, work_days, rest_days) VALUES ($1,$2,$3,$4) RETURNING id',
        [c.name, c.start, c.work, c.rest]
      );
      crewIds[c.name] = r.rows[0].id;
    }

    const personnelPlan = [
      { apellido: 'Gómez', nombre: 'Ricardo', puesto: 'Supervisor', crew: 'Cuadrilla Azul' },
      { apellido: 'Fernández', nombre: 'Pablo', puesto: 'Guinchero', crew: 'Cuadrilla Azul' },
      { apellido: 'Rojas', nombre: 'Matías', puesto: 'Ayudante', crew: 'Cuadrilla Azul' },
      { apellido: 'Correa', nombre: 'Nicolás', puesto: 'Ayudante', crew: 'Cuadrilla Azul' },
      { apellido: 'Torres', nombre: 'Emilia', puesto: 'Supervisor', crew: 'Cuadrilla Verde' },
      { apellido: 'Medina', nombre: 'Julián', puesto: 'Guinchero', crew: 'Cuadrilla Verde' },
      { apellido: 'Aguirre', nombre: 'Bruno', puesto: 'Ayudante', crew: 'Cuadrilla Verde' }
    ];
    const personnelIds = {};
    for (const p of personnelPlan) {
      const r = await client.query(
        `INSERT INTO personnel (name, apellido, nombre, puesto, crew_id, convenio, active)
         VALUES ($1,$2,$3,$4,$5,'Privados', true) RETURNING id`,
        [`${p.apellido}, ${p.nombre}`, p.apellido, p.nombre, p.puesto, crewIds[p.crew]]
      );
      personnelIds[`${p.apellido} ${p.nombre}`] = r.rows[0].id;
    }

    // ---------- JOBS ----------
    console.log('Creando Jobs...');
    const jobPlan = [
      { padWell: padWell[0], job_number: 'D-1001', service: 'CBL', status: 'activo' },
      { padWell: padWell[1], job_number: 'D-1002', service: 'Plug & Perf', status: 'activo' },
      { padWell: padWell[2], job_number: null, service: 'WL', status: 'activo' },
      { padWell: padWell[3], job_number: 'D-0998', service: 'Punzado', status: 'cerrado' }
    ];
    const jobIds = [];
    for (const j of jobPlan) {
      const r = await client.query(
        `INSERT INTO jobs
          (job_number, pad_id, service_id, status, created_by, representante_cliente, expro_representante,
           supervisor_dia, guinchero_dia, unidad_wl, wire_type_size, presion_bdp, doble_dotacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [j.job_number, j.padWell.padId, serviceIds[j.service], j.status, userRows.coordinador,
         'Rep. Cliente Demo', 'Rep. Operador Demo', 'Gómez, Ricardo', 'Fernández, Pablo',
         'DEMO-WL-01', '0.108" Mono', 2500, 'NA']
      );
      await client.query('INSERT INTO job_wells (job_id, well_id) VALUES ($1,$2)', [r.rows[0].id, j.padWell.wellId]);
      await client.query('INSERT INTO job_services (job_id, service_id) VALUES ($1,$2)', [r.rows[0].id, serviceIds[j.service]]);
      jobIds.push(r.rows[0].id);
    }

    // Assets asignados al primer job
    await client.query(
      `INSERT INTO job_assets (job_id, asset_id, assigned_by, confirmed, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,true,$4,now())`,
      [jobIds[0], assetIds['DEMO-TRK-101'], userRows.mantenimiento, userRows.ingeniero]
    );
    await client.query(
      `INSERT INTO job_assets (job_id, asset_id, kit_template_id, assigned_by, confirmed)
       VALUES ($1,$2,$3,$4,true)`,
      [jobIds[0], assetIds['DEMO-PCE-201'], kitRes.rows[0].id, userRows.mantenimiento]
    );

    // ---------- REPORTE DE TIEMPOS (On Call) ----------
    console.log('Creando Reporte de Tiempos...');
    const trResult = await client.query(
      `INSERT INTO time_reports (job_id, report_type, created_by, expro_representante)
       VALUES ($1,'on_call',$2,'Rep. Operador Demo') RETURNING id`,
      [jobIds[0], userRows.ingeniero]
    );
    const timeReportId = trResult.rows[0].id;

    const lineRes1 = await client.query(
      `INSERT INTO time_report_lines (time_report_id, fecha, desde, hasta, actividad, operacion, is_run, created_by)
       VALUES ($1,$2,'08:00','12:30','Rig up y bajada de set de presión','Rig Up', false, $3) RETURNING id`,
      [timeReportId, daysFromNow(-2), userRows.ingeniero]
    );
    const lineRes2 = await client.query(
      `INSERT INTO time_report_lines
        (time_report_id, fecha, desde, hasta, actividad, operacion, is_run, evento_misrun, created_by)
       VALUES ($1,$2,'12:30','18:45','Carrera de CBL en pozo, se detecta anomalía en lectura','Carrera de logging', true, true, $3) RETURNING id`,
      [timeReportId, daysFromNow(-2), userRows.ingeniero]
    );
    await client.query(
      'INSERT INTO time_report_line_assets (time_report_line_id, asset_id) VALUES ($1,$2), ($1,$3)',
      [lineRes2.rows[0].id, assetIds['DEMO-PCE-201'], assetIds['DEMO-SHV-301']]
    );

    // ---------- REPORTES DE FALLA ----------
    console.log('Creando Reportes de Falla...');
    const failurePlan = [
      {
        line: lineRes2.rows[0].id, job: jobIds[0], daysAgo: -2, nivel: 'nivel2', estado: 'cerrado',
        que: 'Lectura anómala del CCL durante la carrera de logging, con ruido excesivo en la señal.',
        porque: 'Se detectó humedad en el conector del cable del CCL.',
        acciones: 'Se reemplazó el conector y se repitió la carrera con lectura normal.',
        causa: 'Sello defectuoso en el conector, posible desgaste por uso.',
        correctiva: 'Inspección de sellos de conectores antes de cada movilización.'
      },
      {
        line: lineRes2.rows[0].id, job: jobIds[0], daysAgo: -8, nivel: 'nivel1', estado: 'enviado',
        que: 'Falla en el sistema hidráulico del camión durante rig up.',
        porque: 'Pérdida de presión en manguera hidráulica principal.',
        acciones: 'Se aisló la línea y se movilizó unidad de respaldo.',
        causa: 'Manguera con desgaste superior al esperado para su antigüedad.',
        correctiva: 'Reforzar frecuencia de inspección de mangueras hidráulicas.'
      },
      {
        line: lineRes1.rows[0].id, job: jobIds[0], daysAgo: -15, nivel: 'nivel3', estado: 'borrador',
        que: 'Demora de 40 minutos en rig up por falta de acceso al locación.',
        porque: 'Camino de acceso con obstrucción no informada previamente.',
        acciones: 'Se coordinó con cliente el despeje del acceso.',
        causa: '', correctiva: ''
      }
    ];
    for (const f of failurePlan) {
      const fr = await client.query(
        `INSERT INTO failure_reports
          (job_id, time_report_line_id, event_datetime, supervisor_id, cliente_id, pozo_etapa, npt,
           descripcion_que_sucedio, descripcion_por_que, acciones_inmediatas, clasificacion_nivel,
           causa_raiz, accion_correctiva, estado, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [f.job, f.line, `${daysFromNow(f.daysAgo)}T14:30:00`, personnelIds['Gómez Ricardo'], clientIds['Austral Energy'],
         'AE-1105 / Etapa 3', '2', f.que, f.porque, f.acciones, f.nivel, f.causa || null, f.correctiva || null,
         f.estado, userRows.ingeniero]
      );
      await client.query(
        'INSERT INTO failure_report_assets (failure_report_id, asset_id) VALUES ($1,$2)',
        [fr.rows[0].id, assetIds['DEMO-CCL-501']]
      );
    }

    // ---------- PARTE DIARIO ----------
    console.log('Creando entradas de Parte Diario...');
    const estados = ['proxima_operacion', 'en_operacion', 'operacion_finalizada', 'operacion_finalizada', 'operacion_cancelada', 'operacion_rechazada'];
    let entryIdx = 0;
    for (let d = -20; d <= 2; d += 3) {
      const pw = padWell[entryIdx % padWell.length];
      const estado = estados[entryIdx % estados.length];
      const svc = Object.keys(serviceIds)[entryIdx % Object.keys(serviceIds).length];
      const entryRes = await client.query(
        `INSERT INTO daily_board_entries
          (estado, fecha, unidad, pozo, tipo_unidad, client_id, edp, servicios, comentarios, created_by)
         VALUES ($1,$2,$3,$4,'WL',$5,$6,$7,$8,$9) RETURNING id`,
        [estado, daysFromNow(d), `Unidad-0${(entryIdx % 4) + 1}`, pw.padName, pw.clientId,
         `SET ${(entryIdx % 3) + 1}`, svc, entryIdx % 4 === 0 ? 'Operación estándar sin novedades.' : null, userRows.coordinador]
      );
      const entryId = entryRes.rows[0].id;

      // asignaciones de dia para algunas entradas
      if (entryIdx % 2 === 0) {
        await client.query(
          `INSERT INTO daily_board_assignments (entry_id, role, turno, personnel_id) VALUES
           ($1,'supervisor','dia',$2), ($1,'guinchero','dia',$3)`,
          [entryId, personnelIds['Gómez Ricardo'], personnelIds['Fernández Pablo']]
        );
      } else {
        await client.query(
          `INSERT INTO daily_board_assignments (entry_id, role, turno, personnel_id) VALUES
           ($1,'supervisor','dia',$2), ($1,'guinchero','dia',$3)`,
          [entryId, personnelIds['Torres Emilia'], personnelIds['Medina Julián']]
        );
      }
      entryIdx += 1;
    }

    await client.query('COMMIT');
    return users;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Si se corre directo (node seed_demo.js), usa su propia conexion y despues cierra todo.
if (require.main === module) {
  require('dotenv').config();
  const pool = require('./db');
  seedDemo(pool)
    .then((users) => {
      console.log('');
      console.log('Seed de demo completo. Usuarios de acceso:');
      users.forEach((u) => console.log(`  - ${u.email} / demo2026 (${u.role})`));
    })
    .catch((err) => {
      console.error('Error en el seed de demo:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedDemo };
