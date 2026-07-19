-- Un "Despacho" registra que se envio stock de explosivos desde un Programa hacia un Job
-- especifico (parcial, total, o con ajuste manual respecto de lo calculado en el programa).
CREATE TABLE explosive_program_dispatches (
  id SERIAL PRIMARY KEY,
  program_id INT NOT NULL REFERENCES explosive_programs(id),
  job_id INT NOT NULL REFERENCES jobs(id),
  pad_id INT NOT NULL REFERENCES pads(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Detalle por tipo: cuanto pedia el programa (cantidad_programada, solo referencia/auditoria)
-- vs cuanto se mando realmente (cantidad, puede ser menor, mayor, o distinto por ajuste).
CREATE TABLE explosive_program_dispatch_items (
  id SERIAL PRIMARY KEY,
  dispatch_id INT NOT NULL REFERENCES explosive_program_dispatches(id) ON DELETE CASCADE,
  explosive_type_id INT NOT NULL REFERENCES explosive_types(id),
  cantidad_programada NUMERIC NOT NULL,
  cantidad NUMERIC NOT NULL
);

-- Vinculo directo a Job en el libro de movimientos, para poder responder rapido
-- "que entro y que se gasto en ESTE job" sin tener que hacer joins profundos.
-- Se completa tanto en las entradas por despacho como en las salidas automaticas de Bundle P&P.
ALTER TABLE explosive_stock_movements ADD COLUMN job_id INT REFERENCES jobs(id);
ALTER TABLE explosive_stock_movements ADD COLUMN dispatch_id INT REFERENCES explosive_program_dispatches(id) ON DELETE CASCADE;

CREATE INDEX idx_stock_movements_job ON explosive_stock_movements(job_id);
CREATE INDEX idx_program_dispatches_job ON explosive_program_dispatches(job_id);
