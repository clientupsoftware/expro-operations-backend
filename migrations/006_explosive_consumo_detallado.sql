-- El Tapon se fija una vez por etapa (no por cluster): consume 1 detonador primario,
-- 1 detonador secundario y 1 carga de poder, cada uno del catalogo de tipos.
ALTER TABLE explosive_program_typologies ADD COLUMN tiene_tapon BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE explosive_program_typologies ADD COLUMN tapon_detonador_primario_id INT REFERENCES explosive_types(id);
ALTER TABLE explosive_program_typologies ADD COLUMN tapon_detonador_secundario_id INT REFERENCES explosive_types(id);
ALTER TABLE explosive_program_typologies ADD COLUMN tapon_carga_poder_id INT REFERENCES explosive_types(id);

-- Cada cluster disparado consume, ademas de las cargas (ya existente como explosive_type_id
-- + cargas_por_cluster): 1 detonador, y una cantidad de cordon detonante.
ALTER TABLE explosive_program_configs ADD COLUMN detonador_type_id INT REFERENCES explosive_types(id);
ALTER TABLE explosive_program_configs ADD COLUMN cordon_type_id INT REFERENCES explosive_types(id);
ALTER TABLE explosive_program_configs ADD COLUMN cordon_cantidad_por_cluster NUMERIC;
