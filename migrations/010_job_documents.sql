-- Documentos relacionados a un Job (programas en PDF, simulaciones, Excel, Word, etc).
-- El archivo en si vive en Cloudflare R2 - aca solo se guarda la referencia (storage_key).
CREATE TABLE job_documents (
  id SERIAL PRIMARY KEY,
  job_id INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  storage_key VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INT,
  content_type VARCHAR(150),
  uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_documents_job ON job_documents(job_id);
