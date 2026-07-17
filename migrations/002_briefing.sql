-- Plantillas de Briefing (reusables entre Jobs, mismo patron que kit_templates)
CREATE TABLE briefing_templates (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE briefing_template_items (
  id SERIAL PRIMARY KEY,
  template_id INT NOT NULL REFERENCES briefing_templates(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  orden INT NOT NULL DEFAULT 0
);

-- Instancia real de un Briefing completado para un Job especifico.
-- Las preguntas se COPIAN de la plantilla al crear la instancia (no quedan referenciadas
-- en vivo), para que editar la plantilla despues no altere Briefings de Jobs ya cerrados.
CREATE TABLE job_briefings (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_id INT REFERENCES briefing_templates(id),
  comentario_final TEXT,
  supervisor_signed_by INT REFERENCES users(id),
  supervisor_signed_at TIMESTAMP,
  manager_signed_by INT REFERENCES users(id),
  manager_signed_at TIMESTAMP,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE job_briefing_items (
  id SERIAL PRIMARY KEY,
  job_briefing_id INT NOT NULL REFERENCES job_briefings(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  respuesta VARCHAR(5) CHECK (respuesta IS NULL OR respuesta IN ('SI', 'NO', 'NA')),
  comentario VARCHAR(255),
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_job_briefings_job ON job_briefings(job_id);
CREATE INDEX idx_job_briefing_items_briefing ON job_briefing_items(job_briefing_id);
