// explosiveStockAlertChecker.js
const pool = require('./db');
const { sendEmail } = require('./emailService');

async function getNotifyEmails() {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'explosive_stock_alert_notify_emails'`);
  return result.rows[0]?.value
    ? result.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
}

function buildAlertEmailHtml(rule, balance) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px;">
      <h2 style="color:#d97b2c;">Alerta de stock bajo de explosivos</h2>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">PAD</td><td style="padding:4px 8px;">${rule.pad_name}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Tipo de explosivo</td><td style="padding:4px 8px;">${rule.explosive_type_descripcion}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Umbral minimo configurado</td><td style="padding:4px 8px;">${rule.umbral_minimo}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Balance actual</td><td style="padding:4px 8px; color:#c0392b; font-weight:bold;">${balance}</td></tr>
      </table>
      <p style="color:#888; font-size:13px;">Ingresa a WellOps (Explosivos → Inventario) para registrar una nueva entrada de stock.</p>
    </div>
  `;
}

// Calcula el balance actual de un tipo en un PAD (misma formula que el endpoint de balance).
async function getBalance(padId, explosiveTypeId) {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo_movimiento = 'entrada' THEN cantidad ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN tipo_movimiento = 'salida' THEN cantidad ELSE 0 END), 0) AS balance
    FROM explosive_stock_movements
    WHERE pad_id = $1 AND explosive_type_id = $2
  `, [padId, explosiveTypeId]);
  return Number(result.rows[0].balance);
}

async function checkExplosiveStockAlerts() {
  const rulesResult = await pool.query(`
    SELECT explosive_stock_alert_rules.*, explosive_types.descripcion AS explosive_type_descripcion, pads.name AS pad_name
    FROM explosive_stock_alert_rules
    JOIN explosive_types ON explosive_types.id = explosive_stock_alert_rules.explosive_type_id
    JOIN pads ON pads.id = explosive_stock_alert_rules.pad_id
    WHERE active = true
  `);
  if (rulesResult.rows.length === 0) return { checked: 0, triggered: 0 };

  const recipients = await getNotifyEmails();
  let triggered = 0;

  for (const rule of rulesResult.rows) {
    const balance = await getBalance(rule.pad_id, rule.explosive_type_id);

    const existing = await pool.query(
      'SELECT * FROM explosive_stock_alert_notifications WHERE rule_id = $1',
      [rule.id]
    );
    const yaAvisado = existing.rows.length > 0;

    if (balance > rule.umbral_minimo) {
      // Por encima del umbral: si tenia un aviso previo (ej: entro stock nuevo), se limpia -
      // asi si vuelve a bajar del umbral en el futuro, se considera un aviso nuevo.
      if (yaAvisado) {
        await pool.query('DELETE FROM explosive_stock_alert_notifications WHERE rule_id = $1', [rule.id]);
      }
      continue;
    }

    // balance <= umbral_minimo
    if (yaAvisado) continue; // ya se aviso para este ciclo, no repetir

    if (recipients.length > 0) {
      try {
        await sendEmail({
          to: recipients,
          subject: `WellOps - Stock bajo de explosivos (${rule.pad_name} · ${rule.explosive_type_descripcion})`,
          html: buildAlertEmailHtml(rule, balance)
        });
      } catch (emailErr) {
        console.error(`No se pudo enviar alerta de stock (regla ${rule.id}):`, emailErr.message);
        continue;
      }
    }

    await pool.query(
      `INSERT INTO explosive_stock_alert_notifications (rule_id, balance_at_trigger) VALUES ($1, $2)`,
      [rule.id, balance]
    );
    triggered += 1;
  }

  return { checked: rulesResult.rows.length, triggered };
}

module.exports = { checkExplosiveStockAlerts };
