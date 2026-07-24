-- ============================================================
-- 025_daily_board_entry_resources.sql
-- Recursos adicionales elegidos por entrada de Parte Diario: Unidades de carga,
-- Motocompresores, Generadores (multi-seleccion con checkbox). Una sola tabla
-- generica en vez de 3 identicas, distinguiendo por resource_type.
-- ============================================================

CREATE TABLE daily_board_entry_resources (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES daily_board_entries(id) ON DELETE CASCADE,
  resource_type VARCHAR(30) NOT NULL, -- 'unidad_carga' | 'motocompresor' | 'generador'
  resource_id INTEGER NOT NULL,
  UNIQUE (entry_id, resource_type, resource_id)
);
