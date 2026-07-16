-- Reglas de alerta de assets: "avisame cuando este asset llegue a X carreras/operaciones"
CREATE TABLE asset_alert_rules (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150),
  disparador VARCHAR(20) NOT NULL CHECK (disparador IN ('runs', 'operations')),
  umbral INT NOT NULL CHECK (umbral > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- A que assets aplica cada regla (una regla puede apuntar a varios assets)
CREATE TABLE asset_alert_rule_assets (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES asset_alert_rules(id) ON DELETE CASCADE,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  UNIQUE(rule_id, asset_id)
);

-- Registro de avisos ya disparados, para no repetir el mismo mail una y otra vez.
-- counter_value_at_trigger guarda el valor del contador en el momento del aviso:
-- si despues de un reseteo el contador vuelve a superar el umbral, counter_value_at_trigger
-- va a ser mayor al valor actual en algun momento intermedio, lo que permite "rearmar"
-- la alerta sin tener que tocar la logica de reseteo de contadores en ningun otro lado.
CREATE TABLE asset_alert_notifications (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES asset_alert_rules(id) ON DELETE CASCADE,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  counter_value_at_trigger INT NOT NULL,
  triggered_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(rule_id, asset_id)
);

CREATE INDEX idx_asset_alert_rule_assets_rule ON asset_alert_rule_assets(rule_id);
CREATE INDEX idx_asset_alert_rule_assets_asset ON asset_alert_rule_assets(asset_id);
