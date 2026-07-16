// assetAlertChecker.js
// Revisa todas las reglas de alerta activas contra los contadores actuales de cada asset,
// y dispara un mail cuando corresponde. Pensado para correr periodicamente (ver server.js),
// pero tambien se puede invocar manualmente (endpoint de prueba, o a mano en la consola).
const pool = require('./db');
const { sendEmail } = require('./emailService');

async function getNotifyEmails() {
  const result = await pool.query(`SELECT value FROM settings WHERE key = 'asset_alert_notify_emails'`);
  return result.rows[0]?.value
    ? result.rows[0].value.split(',').map((e) => e.trim()).filter(Boolean)
    : [];
}

function buildAlertEmailHtml(rule, asset, valorActual) {
  const disparadorLabel = rule.disparador === 'runs' ? 'Carreras (runs)' : 'Operaciones';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px;">
      <h2 style="color:#d97b2c;">Alerta de mantenimiento de asset</h2>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Asset</td><td style="padding:4px 8px;">${asset.sap_equipment_code} - ${asset.description || ''}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Regla</td><td style="padding:4px 8px;">${rule.nombre || '(sin nombre)'}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Disparador</td><td style="padding:4px 8px;">${disparadorLabel}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Umbral configurado</td><td style="padding:4px 8px;">${rule.umbral}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Valor actual</td><td style="padding:4px 8px;">${valorActual}</td></tr>
      </table>
      <p style="color:#888; font-size:13px;">Ingresa a WellOps (Mantenimiento) para ver el detalle o gestionar el mantenimiento correspondiente.</p>
    </div>
  `;
}

async function checkAssetAlerts() {
  const rulesResult = await pool.query('SELECT * FROM asset_alert_rules WHERE active = true');
  if (rulesResult.rows.length === 0) return { checked: 0, triggered: 0 };

  const recipients = await getNotifyEmails();
  let triggered = 0;

  for (const rule of rulesResult.rows) {
    const columnaContador = rule.disparador === 'runs' ? 'cumulative_runs' : 'cumulative_operations';

    const assetsResult = await pool.query(
      `SELECT a.id, a.sap_equipment_code, a.description, a.${columnaContador} AS valor_actual
       FROM asset_alert_rule_assets aara
       JOIN assets a ON a.id = aara.asset_id
       WHERE aara.rule_id = $1`,
      [rule.id]
    );

    for (const asset of assetsResult.rows) {
      const existing = await pool.query(
        'SELECT * FROM asset_alert_notifications WHERE rule_id = $1 AND asset_id = $2',
        [rule.id, asset.id]
      );
      const yaAvisado = existing.rows.length > 0;

      if (asset.valor_actual < rule.umbral) {
        // Por debajo del umbral: si tenia un aviso previo (ej: se reseteo el contador
        // despues de haber avisado), se limpia - asi cuando vuelva a superar el umbral
        // en el futuro, se considera un aviso nuevo, no "ya avisado".
        if (yaAvisado) {
          await pool.query('DELETE FROM asset_alert_notifications WHERE rule_id = $1 AND asset_id = $2', [rule.id, asset.id]);
        }
        continue;
      }

      // valor_actual >= umbral
      if (yaAvisado) continue; // ya se aviso para este ciclo, no repetir

      if (recipients.length > 0) {
        try {
          await sendEmail({
            to: recipients,
            subject: `WellOps - Alerta de mantenimiento (${asset.sap_equipment_code})`,
            html: buildAlertEmailHtml(rule, asset, asset.valor_actual)
          });
        } catch (emailErr) {
          console.error(`No se pudo enviar alerta de asset (regla ${rule.id}, asset ${asset.id}):`, emailErr.message);
          continue; // no marcar como avisado si el mail fallo, para reintentar en el proximo chequeo
        }
      }

      await pool.query(
        `INSERT INTO asset_alert_notifications (rule_id, asset_id, counter_value_at_trigger) VALUES ($1, $2, $3)`,
        [rule.id, asset.id, asset.valor_actual]
      );
      triggered += 1;
    }
  }

  return { checked: rulesResult.rows.length, triggered };
}

module.exports = { checkAssetAlerts };
