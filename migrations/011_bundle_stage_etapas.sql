-- Bundle P&P: cada Stage ahora indica explicitamente que ETAPA de ese Pozo es (no un
-- numero global), si fue efectiva, y si es un repunzado deliberado de una etapa ya
-- completada. stage_number se mantiene tal cual (orden de creacion, para mostrar en tabla).
ALTER TABLE bundle_stages ADD COLUMN etapa INT;
ALTER TABLE bundle_stages ADD COLUMN etapa_efectiva BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bundle_stages ADD COLUMN es_repunzado BOOLEAN NOT NULL DEFAULT false;

-- Vinculo opcional a la Tipologia de Explosivos (catalogo) usada realmente en esta etapa,
-- para poder registrar el detalle de que cañones/clusters dispararon.
ALTER TABLE bundle_stages ADD COLUMN typology_id INT REFERENCES explosive_typologies(id);
ALTER TABLE bundle_stages ADD COLUMN tapon_fired BOOLEAN;

-- Detalle real de disparo, cañon por cañon/cluster (por Configuracion de la Tipologia elegida).
CREATE TABLE bundle_stage_config_results (
  id SERIAL PRIMARY KEY,
  bundle_stage_id INT NOT NULL REFERENCES bundle_stages(id) ON DELETE CASCADE,
  typology_config_id INT NOT NULL REFERENCES explosive_typology_configs(id),
  guns_planned INT NOT NULL,
  guns_fired INT NOT NULL,
  orden INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_bundle_stages_well_etapa ON bundle_stages(well_id, etapa);
CREATE INDEX idx_bundle_stage_config_results_stage ON bundle_stage_config_results(bundle_stage_id);
