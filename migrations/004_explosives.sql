-- Catalogo de tipos de explosivos
CREATE TABLE explosive_types (
  id SERIAL PRIMARY KEY,
  descripcion VARCHAR(255) NOT NULL,
  tipo VARCHAR(100),
  fabricante VARCHAR(150),
  numero_renar VARCHAR(100),
  numero_sap VARCHAR(100),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Programa de explosivos: PAD y Pozos son texto libre (no dependen del catalogo de
-- PADs/Pozos de Jobs) - un programa puede armarse antes de que ese PAD/Pozo exista
-- formalmente en el sistema.
CREATE TABLE explosive_programs (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre VARCHAR(150),
  cliente_id INT REFERENCES clients(id),
  pad VARCHAR(150),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Pozos dentro de un programa (texto libre)
CREATE TABLE explosive_program_wells (
  id SERIAL PRIMARY KEY,
  program_id INT NOT NULL REFERENCES explosive_programs(id) ON DELETE CASCADE,
  pozo VARCHAR(150) NOT NULL,
  orden INT NOT NULL DEFAULT 0
);

-- Carreras dentro de cada Pozo del programa
CREATE TABLE explosive_program_runs (
  id SERIAL PRIMARY KEY,
  program_well_id INT NOT NULL REFERENCES explosive_program_wells(id) ON DELETE CASCADE,
  nombre VARCHAR(100),
  cantidad_etapas INT,
  diametro_canon VARCHAR(50),
  cantidad_clusters INT,
  largo_cluster_ft NUMERIC,
  spf NUMERIC,
  fase VARCHAR(50),
  cargas_por_cluster INT,
  tipo_bala VARCHAR(100),
  tpn VARCHAR(1) NOT NULL DEFAULT 'Y' CHECK (tpn IN ('Y', 'N')),
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_explosive_programs_cliente ON explosive_programs(cliente_id);
CREATE INDEX idx_explosive_programs_fecha ON explosive_programs(fecha);
CREATE INDEX idx_explosive_program_wells_program ON explosive_program_wells(program_id);
CREATE INDEX idx_explosive_program_runs_well ON explosive_program_runs(program_well_id);
