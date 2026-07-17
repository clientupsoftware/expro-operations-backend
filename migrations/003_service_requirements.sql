-- Requerimientos predefinidos por servicio (plantilla reusable, mismo patron que Kits/Briefing).
-- Al crear un Job con un servicio, estas filas se COPIAN a required_tools de ese Job
-- (no quedan referenciadas en vivo - editar esto despues no cambia Jobs ya creados).
CREATE TABLE service_default_requirements (
  id SERIAL PRIMARY KEY,
  service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  tool_description VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_service_default_requirements_service ON service_default_requirements(service_id);

-- Vinculo opcional: a que requerimiento del Job corresponde este asset asignado.
-- Nullable a proposito: un asset puede estar asignado sin todavia estar etiquetado,
-- y varios assets pueden apuntar al mismo requerimiento (ej: 3 componentes que en conjunto
-- forman el "PCE").
ALTER TABLE job_assets ADD COLUMN required_tool_id INT REFERENCES required_tools(id) ON DELETE SET NULL;

CREATE INDEX idx_job_assets_required_tool ON job_assets(required_tool_id);
