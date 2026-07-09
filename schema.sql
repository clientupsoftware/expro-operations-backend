-- ============================================================
-- EXPRO OPERATIONS SYSTEM - ESQUEMA DE BASE DE DATOS
-- PostgreSQL (pensado para correr en Railway)
-- ============================================================

-- ---------- USUARIOS Y ROLES ----------
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('coordinador', 'mantenimiento', 'ingeniero')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- NUCLEO COMPARTIDO (clientes, pads, pozos, servicios, jobs) ----------
CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE pads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  client_id INT REFERENCES clients(id) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE wells (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  pad_id INT REFERENCES pads(id) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE -- CBL, Plug & Perf, WL, Punzado, etc.
);

CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  job_number VARCHAR(50),                 -- nullable, formato tipo "T-10150", solo lo edita el Coordinador
  pad_id INT REFERENCES pads(id) NOT NULL,
  service_id INT REFERENCES services(id) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'activo', -- activo / cerrado
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE job_wells (
  job_id INT REFERENCES jobs(id) ON DELETE CASCADE,
  well_id INT REFERENCES wells(id),
  PRIMARY KEY (job_id, well_id)
);

-- ---------- CATALOGO DE EQUIPOS Y ASSETS REALES (poblado desde SAP) ----------
CREATE TABLE equipment_catalog (
  id SERIAL PRIMARY KEY,
  category VARCHAR(60),               -- Truck, Trailer, Set/PCE, Sheave, SinkerBars, Verifier, HLA, CCL, Setting Tool, etc.
  model_description VARCHAR(255) NOT NULL,
  UNIQUE (category, model_description)
);

CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  equipment_catalog_id INT REFERENCES equipment_catalog(id),
  sap_equipment_code VARCHAR(50) UNIQUE,   -- columna "Equipment (*)" de SAP
  description VARCHAR(255),                -- "Equipment Description"
  equipment_type VARCHAR(50),              -- "Equipment Type (*)"
  serial_number VARCHAR(100),              -- "Manu SerialNo.(*)"
  system_status VARCHAR(50),               -- "System Status (*)" (ej: AVLB)
  current_location VARCHAR(150),           -- "Current Location (*)"
  max_working_pressure VARCHAR(50),        -- "Maximum Working Pressure(PSI)"
  cert_annual_expiry DATE,
  cert_major_expiry DATE,
  cert_load_test_expiry DATE,
  cert_nde_expiry DATE,
  cert_visual_expiry DATE,
  cert_calibration_expiry DATE,
  cumulative_runs INT NOT NULL DEFAULT 0,  -- se incrementa via asset_runs
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_assets_catalog ON assets(equipment_catalog_id);

-- ---------- REQUERIMIENTOS DEL INGENIERO (PreJob) ----------
CREATE TABLE required_tools (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id) ON DELETE CASCADE,
  tool_description VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  requested_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- ---------- KITS / COMBOS REUTILIZABLES (Mantenimiento) ----------
CREATE TABLE kit_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,          -- ej: "Set de Presion #3", "Truck AH177TR"
  category VARCHAR(60),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE kit_template_items (
  id SERIAL PRIMARY KEY,
  kit_template_id INT REFERENCES kit_templates(id) ON DELETE CASCADE,
  equipment_catalog_id INT REFERENCES equipment_catalog(id),
  quantity INT NOT NULL DEFAULT 1
);

-- ---------- ASSETS ASIGNADOS A UN JOB ----------
CREATE TABLE job_assets (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id) ON DELETE CASCADE,
  asset_id INT REFERENCES assets(id),
  kit_template_id INT REFERENCES kit_templates(id),  -- null si se agrego individualmente
  assigned_by INT REFERENCES users(id),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmed_by INT REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_job_assets_job ON job_assets(job_id);

-- ---------- SHIPPING LIST (se genera al confirmar todos los assets) ----------
CREATE TABLE shipping_lists (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
  generated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE shipping_list_items (
  id SERIAL PRIMARY KEY,
  shipping_list_id INT REFERENCES shipping_lists(id) ON DELETE CASCADE,
  asset_id INT REFERENCES assets(id),
  asset_name VARCHAR(255),
  serial_number VARCHAR(100)
);

-- ---------- REPORTES DE TIEMPO ----------
CREATE TABLE time_reports (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id) ON DELETE CASCADE,
  report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('on_call', 'bundle_pp')), -- lo elige el ingeniero
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- Lineas de reporte On Call (la mayoria de los servicios)
CREATE TABLE time_report_lines (
  id SERIAL PRIMARY KEY,
  time_report_id INT REFERENCES time_reports(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  desde TIME,
  hasta TIME,
  actividad VARCHAR(150),
  operacion VARCHAR(150),
  evento_misrun BOOLEAN DEFAULT false,
  profundidad_desde NUMERIC,
  profundidad_hasta NUMERIC,
  comentarios TEXT,
  is_run BOOLEAN NOT NULL DEFAULT false, -- true si esta linea representa un viaje RIH+POOH completo (cuenta como carrera)
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- Assets usados en cada linea On Call (individual o agrupados visualmente en un "string")
CREATE TABLE time_report_line_assets (
  id SERIAL PRIMARY KEY,
  time_report_line_id INT REFERENCES time_report_lines(id) ON DELETE CASCADE,
  asset_id INT REFERENCES assets(id),
  string_label VARCHAR(100) -- ej: "String 1", nullable si es un asset suelto
);

-- Etapas de reporte Bundle P&P (multi-dia, organizado por Stage)
CREATE TABLE bundle_stages (
  id SERIAL PRIMARY KEY,
  time_report_id INT REFERENCES time_reports(id) ON DELETE CASCADE,
  well_id INT REFERENCES wells(id),
  stage_number INT NOT NULL,
  fecha DATE,
  plug_type VARCHAR(100),
  plug_size VARCHAR(50),
  gun_od VARCHAR(50),
  charge_type VARCHAR(100),
  spf VARCHAR(20),
  charge_qty INT,
  gun_qty INT,
  engineer VARCHAR(150),
  crew_leader VARCHAR(150),
  crew_member_2 VARCHAR(150),
  crew_member_3 VARCHAR(150),
  crew_member_4 VARCHAR(150),
  time_well_to_wl TIME,
  time_rih TIME,
  time_start_pump_down TIME,
  time_poo TIME,
  time_bha_in_lubricator TIME,
  time_well_return TIME,
  well_pressure NUMERIC,
  plug_problem BOOLEAN DEFAULT false,
  hse_issue BOOLEAN DEFAULT false,
  misfire BOOLEAN DEFAULT false,
  comentarios TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE bundle_stage_assets (
  id SERIAL PRIMARY KEY,
  bundle_stage_id INT REFERENCES bundle_stages(id) ON DELETE CASCADE,
  asset_id INT REFERENCES assets(id),
  string_label VARCHAR(100)
);

-- ---------- MANTENIMIENTO PREVENTIVO ----------
-- Reglas por MODELO de equipo (no por asset individual), con multiples niveles PM
CREATE TABLE maintenance_rules (
  id SERIAL PRIMARY KEY,
  equipment_catalog_id INT REFERENCES equipment_catalog(id) NOT NULL,
  level VARCHAR(10) NOT NULL,          -- PM1, PM2, PM3, PM4...
  trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('runs', 'condition', 'interpad')),
  trigger_value INT,                    -- cantidad de carreras (null si es condition/interpad)
  execution_location VARCHAR(20) CHECK (execution_location IN ('campo', 'base')),
  task_description TEXT
);

-- Una carrera = un viaje completo RIH+POOH, sin importar el tipo de job
CREATE TABLE asset_runs (
  id SERIAL PRIMARY KEY,
  asset_id INT REFERENCES assets(id) NOT NULL,
  job_id INT REFERENCES jobs(id),
  run_date DATE DEFAULT CURRENT_DATE,
  source VARCHAR(20) -- 'on_call_line' o 'bundle_stage', para trazabilidad
);

CREATE TABLE asset_maintenance_log (
  id SERIAL PRIMARY KEY,
  asset_id INT REFERENCES assets(id) NOT NULL,
  maintenance_rule_id INT REFERENCES maintenance_rules(id),
  performed_at DATE DEFAULT CURRENT_DATE,
  runs_at_time INT,
  notes TEXT,
  logged_by INT REFERENCES users(id)
);

-- ---------- CONFIGURACION GENERAL ----------
CREATE TABLE settings (
  key VARCHAR(60) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('cert_semaphore_threshold_days', '30');

-- ============================================================
-- FIN DEL ESQUEMA
-- ============================================================
