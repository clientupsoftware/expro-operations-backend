// Carga datos iniciales minimos: un usuario por rol, clientes, y servicios.
// Uso: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Creando usuarios iniciales...');

    const users = [
      { name: 'Alva (Coordinador)', email: 'coordinador@expro.com', role: 'coordinador', password: 'cambiar123' },
      { name: 'Mantenimiento', email: 'mantenimiento@expro.com', role: 'mantenimiento', password: 'cambiar123' },
      { name: 'Ingeniero de Campo', email: 'ingeniero@expro.com', role: 'ingeniero', password: 'cambiar123' }
    ];

    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [u.name, u.email, hash, u.role]
      );
    }

    console.log('Creando clientes de ejemplo...');
    const clients = ['YPF', 'Tecpetrol', 'Phoenix', 'Pluspetrol', 'GeoPark'];
    for (const name of clients) {
      await client.query(
        `INSERT INTO clients (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    console.log('Creando servicios base...');
    const services = ['CBL', 'Plug & Perf', 'WL', 'Punzado', 'Pistoneo'];
    for (const name of services) {
      await client.query(
        `INSERT INTO services (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    console.log('Listo. Usuarios de prueba (cambiar password luego):');
    users.forEach(u => console.log(`  - ${u.email} / ${u.password} (${u.role})`));
  } catch (err) {
    console.error('Error en el seed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
