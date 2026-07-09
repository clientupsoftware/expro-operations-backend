const { Pool } = require('pg');

// Railway inyecta DATABASE_URL automaticamente en el servicio conectado a Postgres.
// En Railway generalmente hace falta SSL; en local (sin SSL) no pasa nada si se ignora el flag.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres:', err);
});

module.exports = pool;
