-- Se reemplaza la estructura anterior (Carrera = una fila plana) por dos niveles:
-- Tipologia (nombre reusable, ej "TIPO A") -> Configuracion (puede haber varias por
-- tipologia, ej distintos largos de cluster dentro de la misma tipologia).
-- Dato de prueba perdido a proposito: esta funcion todavia esta en diseño, sin clientes reales.
DROP TABLE IF EXISTS explosive_program_runs;

-- La cantidad de etapas es del Pozo (se repite la misma tipologia en cada etapa),
-- no de cada configuracion puntual.
ALTER TABLE explosive_program_wells ADD COLUMN cantidad_etapas INT;

CREATE TABLE explosive_program_typologies (
  id SERIAL PRIMARY KEY,
  program_well_id INT NOT NULL REFERENCES explosive_program_wells(id) ON DELETE CASCADE,
  nombre VARCHAR(100) NOT NULL,
  orden INT NOT NULL DEFAULT 0
);

-- explosive_type_id es obligatoria (no NULL): el tipo de explosivo pasa a ser siempre
-- del catalogo real (no texto libre), justamente para poder sumar el consumo total
-- agrupado por tipo en todo el programa.
CREATE TABLE explosive_program_configs (
  id SERIAL PRIMARY KEY,
  typology_id INT NOT NULL REFERENCES explosive_program_typologies(id) ON DELETE CASCADE,
  explosive_type_id INT NOT NULL REFERENCES explosive_types(id),
  diametro_canon VARCHAR(50),
  cantidad_clusters INT,
  largo_cluster_ft NUMERIC,
  spf NUMERIC,
  fase VARCHAR(50),
  cargas_por_cluster INT,
  tpn VARCHAR(1) NOT NULL DEFAULT 'Y' CHECK (tpn IN ('Y', 'N')),
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_explosive_program_typologies_well ON explosive_program_typologies(program_well_id);
CREATE INDEX idx_explosive_program_configs_typology ON explosive_program_configs(typology_id);
CREATE INDEX idx_explosive_program_configs_type ON explosive_program_configs(explosive_type_id);
