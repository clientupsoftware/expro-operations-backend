// emailService.js
// Envia emails via la API de Resend usando fetch nativo (disponible desde Node 18+),
// sin agregar ninguna dependencia nueva a package.json.
//
// Variables de entorno necesarias en Railway:
//   RESEND_API_KEY   - la API key de resend.com (empieza con "re_")
//   RESEND_FROM_EMAIL - opcional. Sin dominio verificado en Resend, dejar sin definir
//                        (usa el remitente de pruebas de Resend automaticamente).

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no configurada - se omite el envio de email.');
    return { skipped: true };
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'WellOps <onboarding@resend.dev>',
      to,
      subject,
      html
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error ${res.status}: ${errText}`);
  }
  return res.json();
}

// Arma y manda el mail especifico para un Reporte de Falla recien creado.
async function sendFailureReportNotification(report, recipients) {
  if (!recipients || recipients.length === 0) return { skipped: true };

  const fecha = report.event_datetime ? new Date(report.event_datetime).toLocaleString('es-AR') : '-';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px;">
      <h2 style="color:#d97b2c;">Nuevo Reporte de Falla / No Conformidad</h2>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Fecha del evento</td><td style="padding:4px 8px;">${fecha}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Pozo/Etapa</td><td style="padding:4px 8px;">${report.pozo_etapa || '-'}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">NPT</td><td style="padding:4px 8px;">${report.npt || '-'}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold; color:#555;">Clasificacion</td><td style="padding:4px 8px;">${report.clasificacion_nivel || 'Sin clasificar'}</td></tr>
      </table>
      <p style="font-weight:bold; color:#555;">Que sucedio:</p>
      <p>${report.descripcion_que_sucedio || '-'}</p>
      <p style="color:#888; font-size:13px; margin-top:24px;">Ingresa a WellOps para ver el detalle completo y exportarlo a Word.</p>
    </div>
  `;

  return sendEmail({
    to: recipients,
    subject: `WellOps - Nuevo Reporte de Falla (${report.pozo_etapa || 'sin pozo'})`,
    html
  });
}

module.exports = { sendEmail, sendFailureReportNotification };
