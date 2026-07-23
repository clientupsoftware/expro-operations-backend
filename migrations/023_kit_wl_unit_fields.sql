-- ============================================================
-- 023_kit_wl_unit_fields.sql
-- 2 campos nuevos en kit_templates, pensados para kits de categoria WL_UNIT:
-- - activo: Activo/Inactivo (dropdown)
-- - tipo_cable: Tipo de Cable/Alambre (texto libre)
-- Quedan NULL/sin usar para el resto de las categorias de kit.
-- ============================================================

ALTER TABLE kit_templates ADD COLUMN activo BOOLEAN DEFAULT true;
ALTER TABLE kit_templates ADD COLUMN tipo_cable VARCHAR(150);
