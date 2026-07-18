-- Las Tipologias dejan de vivir "dentro" de un programa puntual y pasan a ser un
-- catalogo reusable (mismo patron que Kits): se crean una vez, se usan en cualquier
-- programa despues. Se reemplazan las tablas anteriores (todavia en diseño, sin
-- clientes reales usandolo).
DROP TABLE IF EXISTS explosive_program_typologies CASCADE; -- explosive_program_configs cae con el CASCADE

-- Catalogo de Tipologias (reusable entre programas)
CREATE TABLE explosive_typologies (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  tiene_tapon BOOLEAN NOT NULL DEFAULT true,
  tapon_detonador_primario_id INT REFERENCES explosive_types(id),
  tapon_detonador_secundario_id INT REFERENCES explosive_types(id),
  tapon_carga_poder_id INT REFERENCES explosive_types(id),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Configuraciones de Gun/Cluster dentro de una Tipologia (tambien parte del catalogo reusable)
CREATE TABLE explosive_typology_configs (
  id SERIAL PRIMARY KEY,
  typology_id INT NOT NULL REFERENCES explosive_typologies(id) ON DELETE CASCADE,
  gun_od NUMERIC(6,3),
  gun_quantity INT,
  gun_length_m NUMERIC(8,2),
  gun_phase NUMERIC,
  spf NUMERIC,
  perforating_length_m NUMERIC(8,3),
  quantity_charges_per_gun INT,
  charge_type_id INT NOT NULL REFERENCES explosive_types(id),
  detonating_cord_type_id INT REFERENCES explosive_types(id),
  detonating_cord_length_m NUMERIC(8,2),
  detonator_type_id INT REFERENCES explosive_types(id),
  orden INT NOT NULL DEFAULT 0
);

-- El Pozo del programa ya no tiene su propia cantidad_etapas fija: ahora puede usar
-- VARIAS Tipologias distintas, cada una con su propia cantidad de etapas
-- (ej: 10 etapas con Tipologia A + 15 etapas con Tipologia B, en el mismo Pozo).
ALTER TABLE explosive_program_wells DROP COLUMN cantidad_etapas;

CREATE TABLE explosive_program_well_typologies (
  id SERIAL PRIMARY KEY,
  program_well_id INT NOT NULL REFERENCES explosive_program_wells(id) ON DELETE CASCADE,
  typology_id INT NOT NULL REFERENCES explosive_typologies(id),
  cantidad_etapas INT NOT NULL DEFAULT 0,
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_explosive_typology_configs_typology ON explosive_typology_configs(typology_id);
CREATE INDEX idx_explosive_program_well_typologies_well ON explosive_program_well_typologies(program_well_id);
CREATE INDEX idx_explosive_program_well_typologies_typology ON explosive_program_well_typologies(typology_id);
