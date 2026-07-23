-- ============================================================
-- 021_daily_board_email_recipients.sql
-- Catalogo de destinatarios frecuentes para el boton "Enviar por Email"
-- del Parte Diario (se eligen con checkbox en vez de escribir el mail cada vez).
-- ============================================================

CREATE TABLE daily_board_email_recipients (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150),
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
