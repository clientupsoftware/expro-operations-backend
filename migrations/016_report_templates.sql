-- ============================================================
-- 006_report_templates.sql
-- Plantillas configurables para Reporte de Tiempos Bundle P&P.
-- Cada cliente puede pedir un set distinto de campos de tiempo
-- y de "slots" de asset por linea (CCL, Knuckle Joint, IS, etc.).
--
-- Los templates son el catalogo editable (Configuracion). Cada
-- Reporte de Tiempos, al crearse, copia ("snapshot") los campos
-- y slots del template elegido a sus propias tablas, para que
-- editar el template despues no altere reportes ya creados
-- (mismo criterio que ya se usa en el resto del sistema).
-- ============================================================

-- ---------- Catalogo maestro (editable en Configuracion) ----------

CREATE TABLE report_templates (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE report_template_time_fields (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  label VARCHAR(150) NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  obligatorio BOOLEAN NOT NULL DEFAULT false,
  tipo_campo VARCHAR(20) NOT NULL DEFAULT 'hora', -- 'hora' | 'numero' | 'texto'
  excel_columna VARCHAR(5) -- ej 'C' - se completa cuando se sube el excel base
);

CREATE TABLE report_template_asset_slots (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  label VARCHAR(150) NOT NULL, -- ej "CCL", "Knuckle Joint", "Setting Tool"
  orden INTEGER NOT NULL DEFAULT 0,
  unit_type_id INTEGER REFERENCES unit_types(id) ON DELETE SET NULL, -- filtra el picklist; null = cualquier asset
  excel_columna VARCHAR(5)
);

-- Archivo Excel base de cada plantilla, guardado en la DB (Railway no
-- persiste filesystem entre deploys). fila_inicio = primera fila de
-- datos donde empieza a escribirse la primera linea/etapa del reporte.
CREATE TABLE report_template_files (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  archivo BYTEA NOT NULL,
  nombre_archivo VARCHAR(255),
  hoja VARCHAR(100), -- nombre de la hoja/sheet a usar dentro del excel
  fila_inicio INTEGER NOT NULL DEFAULT 1,
  uploaded_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------- Snapshot por reporte (inmutable una vez creado) ----------

ALTER TABLE time_reports ADD COLUMN report_template_id INTEGER REFERENCES report_templates(id) ON DELETE SET NULL;

CREATE TABLE time_report_time_fields (
  id SERIAL PRIMARY KEY,
  time_report_id INTEGER NOT NULL REFERENCES time_reports(id) ON DELETE CASCADE,
  label VARCHAR(150) NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  obligatorio BOOLEAN NOT NULL DEFAULT false,
  tipo_campo VARCHAR(20) NOT NULL DEFAULT 'hora',
  excel_columna VARCHAR(5)
);

CREATE TABLE time_report_asset_slots (
  id SERIAL PRIMARY KEY,
  time_report_id INTEGER NOT NULL REFERENCES time_reports(id) ON DELETE CASCADE,
  label VARCHAR(150) NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  unit_type_id INTEGER REFERENCES unit_types(id) ON DELETE SET NULL,
  excel_columna VARCHAR(5)
);

-- Valores cargados por stage, uno por cada campo de tiempo del snapshot.
CREATE TABLE time_report_field_values (
  id SERIAL PRIMARY KEY,
  bundle_stage_id INTEGER NOT NULL REFERENCES bundle_stages(id) ON DELETE CASCADE,
  time_report_time_field_id INTEGER NOT NULL REFERENCES time_report_time_fields(id) ON DELETE CASCADE,
  valor TEXT,
  UNIQUE (bundle_stage_id, time_report_time_field_id)
);

-- Asset por slot: agrega la columna al lado de la ya existente
-- bundle_stage_assets.asset_id (no se toca lo que ya funciona).
ALTER TABLE bundle_stage_assets ADD COLUMN time_report_asset_slot_id INTEGER REFERENCES time_report_asset_slots(id) ON DELETE SET NULL;

-- ============================================================
-- Migracion automatica: plantilla default + reportes existentes
-- ============================================================

-- 1) Plantilla default con los 7 campos que ya existen hoy como columnas fijas
INSERT INTO report_templates (nombre, client_id, activo) VALUES ('Planilla Expro (Default)', NULL, true);

DO $$
DECLARE
  default_template_id INTEGER;
BEGIN
  SELECT id INTO default_template_id FROM report_templates WHERE nombre = 'Planilla Expro (Default)';

  INSERT INTO report_template_time_fields (template_id, label, orden, tipo_campo) VALUES
    (default_template_id, 'Well to WL', 1, 'hora'),
    (default_template_id, 'RIH', 2, 'hora'),
    (default_template_id, 'Start Pump Down', 3, 'hora'),
    (default_template_id, 'POOH', 4, 'hora'),
    (default_template_id, 'BHA in Lubricator', 5, 'hora'),
    (default_template_id, 'Well Return', 6, 'hora'),
    (default_template_id, 'Presion de pozo', 7, 'numero');
END $$;

-- 2) Para cada time_report tipo bundle_pp que ya existe, se le asigna la
--    plantilla default y se crea su propio snapshot (mismo criterio que
--    aplicaria si se hubiera elegido la plantilla al crear el reporte).
DO $$
DECLARE
  default_template_id INTEGER;
  r RECORD;
  new_field_id INTEGER;
  field_map RECORD;
BEGIN
  SELECT id INTO default_template_id FROM report_templates WHERE nombre = 'Planilla Expro (Default)';

  FOR r IN SELECT id FROM time_reports WHERE report_type = 'bundle_pp' LOOP
    UPDATE time_reports SET report_template_id = default_template_id WHERE id = r.id;

    -- snapshot de los 7 campos para este reporte puntual
    FOR field_map IN
      SELECT label, orden, obligatorio, tipo_campo, excel_columna
      FROM report_template_time_fields WHERE template_id = default_template_id ORDER BY orden
    LOOP
      INSERT INTO time_report_time_fields (time_report_id, label, orden, obligatorio, tipo_campo, excel_columna)
      VALUES (r.id, field_map.label, field_map.orden, field_map.obligatorio, field_map.tipo_campo, field_map.excel_columna);
    END LOOP;
  END LOOP;
END $$;

-- 3) Backfill de los valores ya cargados en las columnas viejas hacia
--    time_report_field_values, mapeando por nombre de campo.
DO $$
DECLARE
  s RECORD;
  fid INTEGER;
BEGIN
  FOR s IN
    SELECT bundle_stages.id AS stage_id, bundle_stages.time_report_id,
           bundle_stages.time_well_to_wl, bundle_stages.time_rih,
           bundle_stages.time_start_pump_down, bundle_stages.time_poo,
           bundle_stages.time_bha_in_lubricator, bundle_stages.time_well_return,
           bundle_stages.well_pressure
    FROM bundle_stages
  LOOP
    IF s.time_well_to_wl IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'Well to WL';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_well_to_wl::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.time_rih IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'RIH';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_rih::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.time_start_pump_down IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'Start Pump Down';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_start_pump_down::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.time_poo IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'POOH';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_poo::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.time_bha_in_lubricator IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'BHA in Lubricator';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_bha_in_lubricator::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.time_well_return IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'Well Return';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.time_well_return::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF s.well_pressure IS NOT NULL THEN
      SELECT id INTO fid FROM time_report_time_fields WHERE time_report_id = s.time_report_id AND label = 'Presion de pozo';
      IF fid IS NOT NULL THEN
        INSERT INTO time_report_field_values (bundle_stage_id, time_report_time_field_id, valor) VALUES (s.stage_id, fid, s.well_pressure::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END $$;

-- NOTA: las 7 columnas viejas de bundle_stages (time_well_to_wl, time_rih, etc.)
-- se dejan sin tocar por ahora como respaldo. Una vez que confirmes que el
-- frontend nuevo funciona bien leyendo/escribiendo desde time_report_field_values,
-- las eliminamos en una migracion aparte (007_drop_legacy_time_columns.sql).
