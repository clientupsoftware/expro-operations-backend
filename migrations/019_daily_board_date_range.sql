-- ============================================================
-- 019_daily_board_date_range.sql
-- Parte Diario: un trabajo pasa a tener fecha_inicio y fecha_fin (antes solo
-- "fecha"), para poder verlo como un rango en el Gantt. Los comentarios pasan
-- de ser un solo campo por entrada a uno por dia (daily_board_comments), asi
-- se puede aclarar "ayer etapas 3,4,5 - hoy perfiles" sin pisar el anterior.
-- ============================================================

ALTER TABLE daily_board_entries RENAME COLUMN fecha TO fecha_inicio;
ALTER TABLE daily_board_entries ADD COLUMN fecha_fin DATE;
UPDATE daily_board_entries SET fecha_fin = fecha_inicio WHERE fecha_fin IS NULL;

CREATE TABLE daily_board_comments (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES daily_board_entries(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  comentario TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (entry_id, fecha)
);

-- El comentario unico que ya existia se migra como el comentario del primer dia
-- (fecha_inicio). La columna vieja "comentarios" se deja de respaldo, sin usar.
INSERT INTO daily_board_comments (entry_id, fecha, comentario)
SELECT id, fecha_inicio, comentarios FROM daily_board_entries
WHERE comentarios IS NOT NULL AND comentarios != '' AND fecha_inicio IS NOT NULL;
