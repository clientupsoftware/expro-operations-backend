const pool = require('./db');

// Reglas automaticas de estado en Parte Diario, segun fecha_inicio/fecha_fin vs hoy:
// - Si esta "En Operacion" y ya paso su fecha_fin -> "Op. Finalizada".
// - Si esta "Prox. Operacion" y hoy cae dentro de su rango -> "En Operacion".
// Ambas solo se disparan desde esos 2 estados puntuales - un trabajo Cancelado,
// Rechazado o ya Finalizado nunca se toca automaticamente, para no revivirlo ni
// pisarlo solo porque su fecha cayo en rango.
async function applyDailyBoardAutoTransitions() {
  const finished = await pool.query(`
    UPDATE daily_board_entries SET estado = 'operacion_finalizada', updated_at = now()
    WHERE estado = 'en_operacion' AND fecha_fin IS NOT NULL AND fecha_fin < CURRENT_DATE
    RETURNING id, job_id
  `);
  const started = await pool.query(`
    UPDATE daily_board_entries SET estado = 'en_operacion', updated_at = now()
    WHERE estado = 'proxima_operacion'
      AND fecha_inicio IS NOT NULL AND fecha_inicio <= CURRENT_DATE
      AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE)
    RETURNING id, job_id
  `);

  // Si la entrada ya fue promovida a Job, el Job real tambien refleja el cambio de estado.
  for (const row of finished.rows) {
    if (row.job_id) await pool.query('UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', ['operacion_finalizada', row.job_id]);
  }
  for (const row of started.rows) {
    if (row.job_id) await pool.query('UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2', ['en_operacion', row.job_id]);
  }

  return { finished: finished.rowCount, started: started.rowCount };
}

module.exports = { applyDailyBoardAutoTransitions };
