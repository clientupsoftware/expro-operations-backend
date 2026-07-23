-- ============================================================
-- 022_daily_board_hora_perifericos.sql
-- Parte Diario: hora (24hs) junto a Fecha Inicio/Fin, y periféricos elegidos
-- en la entrada que se copian al Job real cuando se envia a PreJob.
-- ============================================================

ALTER TABLE daily_board_entries ADD COLUMN hora_inicio TIME;
ALTER TABLE daily_board_entries ADD COLUMN hora_fin TIME;

CREATE TABLE daily_board_entry_peripherals (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES daily_board_entries(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES job_peripheral_options(id) ON DELETE CASCADE,
  UNIQUE (entry_id, option_id)
);
