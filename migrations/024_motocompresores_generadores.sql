-- ============================================================
-- 024_motocompresores_generadores.sql
-- Catalogos simples nuevos en Configuracion, mismo patron que Tipos de Unidad /
-- Puestos de Personal (solo nombre, sin campos extra).
-- ============================================================

CREATE TABLE motocompresores (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE generadores (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
