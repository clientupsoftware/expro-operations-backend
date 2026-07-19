// explosiveStock.routes.js
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireRole } = require('./permissionsMiddleware');

const router = express.Router();
router.use(requireAuth);

// ================= BALANCE Y MOVIMIENTOS =================

// GET /api/explosive-stock/balance?pad_id=X - balance actual por tipo, calculado (nunca guardado)
router.get('/balance', async (req, res) => {
  const { pad_id } = req.query;
  if (!pad_id) return res.status(400).json({ error: 'pad_id es requerido.' });

  const result = await pool.query(`
    SELECT
      explosive_types.id AS explosive_type_id,
      explosive_types.descripcion,
      COALESCE(SUM(CASE WHEN tipo_movimiento = 'entrada' THEN cantidad ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN tipo_movimiento = 'salida' THEN cantidad ELSE 0 END), 0) AS balance
    FROM explosive_types
    LEFT JOIN explosive_stock_movements
      ON explosive_stock_movements.explosive_type_id = explosive_types.id
      AND explosive_stock_movements.pad_id = $1
    GROUP BY explosive_types.id, explosive_types.descripcion
    HAVING COALESCE(SUM(CASE WHEN tipo_movimiento = 'entrada' THEN cantidad ELSE 0 END), 0) > 0
        OR COALESCE(SUM(CASE WHEN tipo_movimiento = 'salida' THEN cantidad ELSE 0 END), 0) > 0
    ORDER BY explosive_types.descripcion
  `, [pad_id]);
  res.json(result.rows);
});

// GET /api/explosive-stock/movements?pad_id=X&explosive_type_id=Y&from=&to=
router.get('/movements', async (req, res) => {
  const { pad_id, explosive_type_id, from, to } = req.query;
  if (!pad_id) return res.status(400).json({ error: 'pad_id es requerido.' });

  const conditions = ['explosive_stock_movements.pad_id = $1'];
  const values = [pad_id];
  if (explosive_type_id) { values.push(explosive_type_id); conditions.push(`explosive_stock_movements.explosive_type_id = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`explosive_stock_movements.fecha >= $${values.length}`); }
  if (to) { values.push(to); conditions.push(`explosive_stock_movements.fecha <= $${values.length}`); }

  const result = await pool.query(`
    SELECT explosive_stock_movements.*, explosive_types.descripcion AS explosive_type_descripcion,
           personnel.name AS responsable_nombre,
           bundle_stages.etapa AS stage_etapa, wells.name AS stage_well_name
    FROM explosive_stock_movements
    JOIN explosive_types ON explosive_types.id = explosive_stock_movements.explosive_type_id
    LEFT JOIN personnel ON personnel.id = explosive_stock_movements.responsable_id
    LEFT JOIN bundle_stages ON bundle_stages.id = explosive_stock_movements.bundle_stage_id
    LEFT JOIN wells ON wells.id = bundle_stages.well_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY explosive_stock_movements.fecha DESC, explosive_stock_movements.id DESC
  `, values);
  res.json(result.rows);
});

// POST /api/explosive-stock/entrada - registrar stock nuevo que llego al PAD
router.post('/entrada', requireRole('mantenimiento'), async (req, res) => {
  const { pad_id, explosive_type_id, cantidad, fecha, numero_lote, fecha_fabricacion, numero_remito, responsable_id, detalle } = req.body;
  if (!pad_id || !explosive_type_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'pad_id, explosive_type_id y cantidad (mayor a 0) son requeridos.' });
  }
  const result = await pool.query(
    `INSERT INTO explosive_stock_movements
      (pad_id, explosive_type_id, tipo_movimiento, cantidad, fecha, numero_lote, fecha_fabricacion, numero_remito, responsable_id, detalle, created_by)
     VALUES ($1,$2,'entrada',$3,COALESCE($4, CURRENT_DATE),$5,$6,$7,$8,$9,$10) RETURNING *`,
    [pad_id, explosive_type_id, cantidad, fecha || null, numero_lote || null, fecha_fabricacion || null,
     numero_remito || null, responsable_id || null, detalle || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /api/explosive-stock/movements/:id - solo movimientos manuales (no las salidas automaticas de una etapa)
router.delete('/movements/:id', requireRole('mantenimiento'), async (req, res) => {
  const existing = await pool.query('SELECT bundle_stage_id FROM explosive_stock_movements WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (existing.rows[0].bundle_stage_id) {
    return res.status(400).json({ error: 'Esta salida es automatica (viene de una etapa del Reporte de Tiempos) - para cambiarla, editá o eliminá esa etapa.' });
  }
  await pool.query('DELETE FROM explosive_stock_movements WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

// ================= ALERTAS DE STOCK BAJO =================

router.get('/alert-rules/notify-emails', async (req, res) => {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'explosive_stock_alert_notify_emails'`);
  const emails = result.rows[0]?.value
    ? result.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
  res.json({ emails });
});

router.put('/alert-rules/notify-emails', requireRole('mantenimiento'), async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails (array) es requerido.' });
  const value = emails.map((e) => e.trim()).filter(Boolean).join(',');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('explosive_stock_alert_notify_emails', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [value]
  );
  res.json({ emails: value.split(',').filter(Boolean) });
});

// GET /api/explosive-stock/alert-rules?pad_id=X (opcional, si no se manda trae todas)
router.get('/alert-rules', async (req, res) => {
  const { pad_id } = req.query;
  const values = [];
  let where = '';
  if (pad_id) { values.push(pad_id); where = 'WHERE explosive_stock_alert_rules.pad_id = $1'; }

  const result = await pool.query(`
    SELECT explosive_stock_alert_rules.*, explosive_types.descripcion AS explosive_type_descripcion, pads.name AS pad_name
    FROM explosive_stock_alert_rules
    JOIN explosive_types ON explosive_types.id = explosive_stock_alert_rules.explosive_type_id
    JOIN pads ON pads.id = explosive_stock_alert_rules.pad_id
    ${where}
    ORDER BY pads.name, explosive_types.descripcion
  `, values);
  res.json(result.rows);
});

router.post('/alert-rules', requireRole('mantenimiento'), async (req, res) => {
  const { pad_id, explosive_type_id, umbral_minimo } = req.body;
  if (!pad_id || !explosive_type_id || !umbral_minimo || umbral_minimo <= 0) {
    return res.status(400).json({ error: 'pad_id, explosive_type_id y umbral_minimo (mayor a 0) son requeridos.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO explosive_stock_alert_rules (pad_id, explosive_type_id, umbral_minimo, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [pad_id, explosive_type_id, umbral_minimo, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una regla para este tipo en este PAD.' });
    throw err;
  }
});

router.patch('/alert-rules/:id', requireRole('mantenimiento'), async (req, res) => {
  const { umbral_minimo, active } = req.body;
  const setClauses = [];
  const values = [];
  if (umbral_minimo !== undefined) { values.push(umbral_minimo); setClauses.push(`umbral_minimo = $${values.length}`); }
  if (active !== undefined) { values.push(active); setClauses.push(`active = $${values.length}`); }
  if (setClauses.length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE explosive_stock_alert_rules SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Regla no encontrada.' });
  res.json(result.rows[0]);
});

router.delete('/alert-rules/:id', requireRole('mantenimiento'), async (req, res) => {
  await pool.query('DELETE FROM explosive_stock_alert_rules WHERE id = $1', [req.params.id]);
  res.status(204).send();
});

module.exports = router;
