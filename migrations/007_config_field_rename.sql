-- Ajuste de campos de explosive_program_configs a la terminologia real de operaciones
-- (coincide con las planillas reales de Plug & Perf que se usan en el campo).

-- Gun OD: pasa de texto libre a numerico, hasta 3 decimales (ej: 3.125)
ALTER TABLE explosive_program_configs DROP COLUMN diametro_canon;
ALTER TABLE explosive_program_configs ADD COLUMN gun_od NUMERIC(6,3);

-- Cantidad de clusters -> Gun Quantity (mismo concepto, nombre real)
ALTER TABLE explosive_program_configs RENAME COLUMN cantidad_clusters TO gun_quantity;

-- Gun Length (m): campo nuevo, hasta 2 decimales
ALTER TABLE explosive_program_configs ADD COLUMN gun_length_m NUMERIC(8,2);

-- Fase -> Gun Phase, pasa a numerico (ej: 0, 60, 90)
ALTER TABLE explosive_program_configs DROP COLUMN fase;
ALTER TABLE explosive_program_configs ADD COLUMN gun_phase NUMERIC;

-- Largo de cluster en pies -> Perforating Length en metros, hasta 3 decimales
ALTER TABLE explosive_program_configs DROP COLUMN largo_cluster_ft;
ALTER TABLE explosive_program_configs ADD COLUMN perforating_length_m NUMERIC(8,3);

-- Cargas por cluster -> Quantity Charges/Gun (mismo concepto, nombre real)
ALTER TABLE explosive_program_configs RENAME COLUMN cargas_por_cluster TO quantity_charges_per_gun;

-- Renombres a terminologia real (mismo campo, mismo significado)
ALTER TABLE explosive_program_configs RENAME COLUMN explosive_type_id TO charge_type_id;
ALTER TABLE explosive_program_configs RENAME COLUMN cordon_type_id TO detonating_cord_type_id;
ALTER TABLE explosive_program_configs RENAME COLUMN cordon_cantidad_por_cluster TO detonating_cord_length_m;
ALTER TABLE explosive_program_configs RENAME COLUMN detonador_type_id TO detonator_type_id;

-- TPN ya no aplica a este nivel
ALTER TABLE explosive_program_configs DROP COLUMN tpn;
