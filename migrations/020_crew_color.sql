-- ============================================================
-- 020_crew_color.sql
-- Cada cuadrilla puede elegir su propio color, usado en la barra
-- "En diagrama" del Gantt de Personal (Cuadrillas / Personal Privado / Jerarquico).
-- ============================================================

ALTER TABLE crews ADD COLUMN color VARCHAR(7) DEFAULT '#4caf7d';
