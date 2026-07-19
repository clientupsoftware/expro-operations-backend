-- Unidades de transporte de un envio (Unidad de WL, Semi #1, Semi #2, etc.), con su patente.
CREATE TABLE shipping_list_transport_units (
  id SERIAL PRIMARY KEY,
  shipping_list_id INT NOT NULL REFERENCES shipping_lists(id) ON DELETE CASCADE,
  tipo VARCHAR(100) NOT NULL,
  patente VARCHAR(50),
  orden INT NOT NULL DEFAULT 0
);

-- Cada item de la Shipping List puede asignarse a una unidad de transporte (o quedar sin asignar).
ALTER TABLE shipping_list_items ADD COLUMN transport_unit_id INT REFERENCES shipping_list_transport_units(id) ON DELETE SET NULL;

CREATE INDEX idx_shipping_transport_units_list ON shipping_list_transport_units(shipping_list_id);
