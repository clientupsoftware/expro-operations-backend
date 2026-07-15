// migrate_runner.js
// Corre las migraciones de /migrations que todavia no se aplicaron a esta base,
// en orden por nombre de archivo, y lleva registro de cuales ya corrieron
// (tabla schema_migrations) para no volver a aplicarlas por error.
//
// Uso: node migrate_runner.js
//
// Como usarlo con un cliente/proyecto nuevo (base vacia):
//   Corre 000_baseline_schema.sql (crea todo el esquema actual) + cualquier
//   migracion posterior que se haya agregado despues.
//
// Como usarlo en una base ya existente (ej: Expro, wellops-demo):
//   Salta automaticamente las migraciones que ya tiene aplicadas (asumiendo que
//   ya corrieron a mano antes de que existiera este sistema - ver nota abajo)
//   y solo aplica las nuevas que se vayan agregando de ahi en mas.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((r) => r.filename));
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // los nombres empiezan con numero (000_, 001_, ...) asi que el orden alfabetico = orden cronologico

    if (files.length === 0) {
      console.log('No hay archivos .sql en /migrations.');
      return;
    }

    let pendientes = files.filter((f) => !applied.has(f));

    if (pendientes.length === 0) {
      console.log('Ya estan todas las migraciones aplicadas. Nada para correr.');
      return;
    }

    console.log(`Migraciones pendientes: ${pendientes.join(', ')}`);

    for (const filename of pendientes) {
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`\nCorriendo ${filename}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('SET search_path TO public'); // por si la migracion lo modifico
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`  OK - ${filename} aplicada.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERROR en ${filename}: ${err.message}`);
        console.error('  Se detiene la corrida - revisar el error antes de seguir.');
        process.exitCode = 1;
        return;
      }
    }

    console.log('\nListo. Todas las migraciones pendientes se aplicaron correctamente.');
  } finally {
    client.release();
    await pool.end();
  }
}

run();
