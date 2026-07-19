-- Libro de movimientos de stock de explosivos, por PAD. El balance NUNCA se guarda como
-- campo fijo - siempre se calcula sumando entradas y restando salidas (mismo modelo que
-- ya usa la planilla real: Entrada / Salida / Balance).
CREATE TABLE explosive_stock_movements (
  id SERIAL PRIMARY KEY,
  pad_id INT NOT NULL REFERENCES pads(id),
  explosive_type_id INT NOT NULL REFERENCES explosive_types(id),
  tipo_movimiento VARCHAR(10) NOT NULL CHECK (tipo_movimiento IN ('entrada', 'salida')),
  cantidad NUMERIC NOT NULL CHECK (cantidad > 0),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  numero_lote VARCHAR(100),
  fecha_fabricacion DATE,
  numero_remito VARCHAR(100),
  responsable_id INT REFERENCES personnel(id),
  -- Si esta seteado, esta salida es automatica (se genero sola al guardar una etapa de
  -- Bundle P&P) - se borra/actualiza en cascada cuando se edita o borra esa etapa.
  bundle_stage_id INT REFERENCES bundle_stages(id) ON DELETE CASCADE,
  detalle TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_pad_type ON explosive_stock_movements(pad_id, explosive_type_id);
CREATE INDEX idx_stock_movements_bundle_stage ON explosive_stock_movements(bundle_stage_id);

-- Reglas de alerta de stock bajo (mismo patron que asset_alert_rules)
CREATE TABLE explosive_stock_alert_rules (
  id SERIAL PRIMARY KEY,
  pad_id INT NOT NULL REFERENCES pads(id),
  explosive_type_id INT NOT NULL REFERENCES explosive_types(id),
  umbral_minimo NUMERIC NOT NULL CHECK (umbral_minimo > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(pad_id, explosive_type_id)
);

-- Registro de avisos ya disparados (mismo mecanismo de "rearme" que asset_alert_notifications,
-- pero en sentido inverso: se limpia cuando el balance vuelve a subir por ENCIMA del umbral).
CREATE TABLE explosive_stock_alert_notifications (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES explosive_stock_alert_rules(id) ON DELETE CASCADE,
  balance_at_trigger NUMERIC NOT NULL,
  triggered_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(rule_id)
);
