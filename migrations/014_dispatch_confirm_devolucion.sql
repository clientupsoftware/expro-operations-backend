-- El Despacho ya no genera stock al instante: queda "pendiente" hasta que Operaciones
-- confirma que lo recibio en pozo (mismo patron que ya usamos para Assets: Amarillo -> Verde).
ALTER TABLE explosive_program_dispatches ADD COLUMN confirmado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE explosive_program_dispatches ADD COLUMN confirmado_por INT REFERENCES users(id);
ALTER TABLE explosive_program_dispatches ADD COLUMN confirmado_at TIMESTAMP;

-- Nuevo tipo de movimiento: devolucion de sobrante desde el pozo/Job de vuelta al PAD
-- (distinto de una entrada nueva, para que el historial no confunda "llego mercaderia nueva"
-- con "volvio sobrante que ya estaba contado").
ALTER TABLE explosive_stock_movements DROP CONSTRAINT explosive_stock_movements_tipo_movimiento_check;
ALTER TABLE explosive_stock_movements ADD CONSTRAINT explosive_stock_movements_tipo_movimiento_check
  CHECK (tipo_movimiento IN ('entrada', 'salida', 'devolucion'));
