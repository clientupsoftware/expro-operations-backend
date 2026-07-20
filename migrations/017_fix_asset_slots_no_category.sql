-- ============================================================
-- 017_fix_asset_slots_no_category.sql
-- Correccion de la 016: el slot de asset (CCL, Knuckle Joint, etc.)
-- NO puede filtrar por unit_type_id porque los assets todavia no
-- tienen una categoria propia (unit_types es para camiones/equipos
-- de transporte, no para herramientas individuales). Por ahora el
-- slot queda solo como etiqueta organizativa; el filtro automatico
-- por categoria se suma mas adelante cuando se categorice el
-- catalogo de Assets (Equipment catalog screen, ya pendiente).
-- ============================================================

ALTER TABLE report_template_asset_slots DROP COLUMN unit_type_id;
ALTER TABLE time_report_asset_slots DROP COLUMN unit_type_id;
