-- ============================================================
-- 018_plug_perf_sheet.sql
-- Hoja de Paradas: agrega el unico campo fisico que faltaba (el tramo fijo
-- entre el Plug y el Cluster 1) y los 2 datos de campo que carga el
-- ingeniero por etapa. El paso entre clusters restantes usa directamente
-- gun_length_m / perforating_length_m, que ya existen en
-- explosive_typology_configs - no hace falta nada mas.
-- ============================================================

ALTER TABLE explosive_typologies ADD COLUMN plug_to_first_cluster_length_m NUMERIC(8,3);

ALTER TABLE bundle_stages ADD COLUMN plug_depth_m NUMERIC(10,2);
ALTER TABLE bundle_stages ADD COLUMN ccl_to_top_shot_ref_m NUMERIC(8,3);
