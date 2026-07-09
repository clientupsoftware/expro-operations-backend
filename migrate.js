// Ejecuta schema.sql contra la base de datos indicada en DATABASE_URL.
// Uso: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Conectando a la base de datos...');
  const client = await pool.connect();
  try {
    console.log('Ejecutando schema.sql...');
    await client.query(schema);
    console.log('Listo. Todas las tablas fueron creadas correctamente.');
  } catch (err) {
    console.error('Error al ejecutar el schema:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
