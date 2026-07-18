-- La cuadrilla del Bundle P&P pasa de texto libre a referencias reales al Personal ya cargado.
ALTER TABLE bundle_stages DROP COLUMN engineer;
ALTER TABLE bundle_stages DROP COLUMN crew_leader;
ALTER TABLE bundle_stages DROP COLUMN crew_member_2;
ALTER TABLE bundle_stages DROP COLUMN crew_member_3;
ALTER TABLE bundle_stages DROP COLUMN crew_member_4;
ALTER TABLE bundle_stages ADD COLUMN engineer_id INT REFERENCES personnel(id);
ALTER TABLE bundle_stages ADD COLUMN crew_leader_id INT REFERENCES personnel(id);
ALTER TABLE bundle_stages ADD COLUMN crew_member_2_id INT REFERENCES personnel(id);
ALTER TABLE bundle_stages ADD COLUMN crew_member_3_id INT REFERENCES personnel(id);
ALTER TABLE bundle_stages ADD COLUMN crew_member_4_id INT REFERENCES personnel(id);

-- Se quitan estos 6 campos: ahora se cubren desde el Programa de Explosivos (Tipologia elegida
-- para esa carrera), no hace falta volver a tipearlos de nuevo (data entry redundante).
ALTER TABLE bundle_stages DROP COLUMN plug_size;
ALTER TABLE bundle_stages DROP COLUMN gun_od;
ALTER TABLE bundle_stages DROP COLUMN charge_type;
ALTER TABLE bundle_stages DROP COLUMN spf;
ALTER TABLE bundle_stages DROP COLUMN charge_qty;
ALTER TABLE bundle_stages DROP COLUMN gun_qty;

-- Reportes de falla: ahora tambien se pueden vincular a una etapa de Bundle P&P
-- (ademas de a una linea de On Call). En cada reporte, exactamente uno de los dos
-- (time_report_line_id / bundle_stage_id) va a estar seteado.
ALTER TABLE failure_reports ALTER COLUMN time_report_line_id DROP NOT NULL;
ALTER TABLE failure_reports ADD COLUMN bundle_stage_id INT REFERENCES bundle_stages(id) ON DELETE CASCADE;

CREATE INDEX idx_failure_reports_bundle_stage ON failure_reports(bundle_stage_id);
