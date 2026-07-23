// emailService.js
// Envia emails via la API de Resend usando fetch nativo (disponible desde Node 18+),
// sin agregar ninguna dependencia nueva a package.json.
//
// Variables de entorno necesarias en Railway:
//   RESEND_API_KEY   - la API key de resend.com (empieza con "re_")
//   RESEND_FROM_EMAIL - opcional. Sin dominio verificado en Resend, dejar sin definir
//                        (usa el remitente de pruebas de Resend automaticamente).

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no configurada - se omite el envio de email.');
    return { skipped: true };
  }

  const body = {
    from: process.env.RESEND_FROM_EMAIL || 'WellOps <onboarding@resend.dev>',
    to,
    subject,
    html
  };
  if (attachments && attachments.length > 0) {
    // Resend espera el contenido en base64 (sin el prefijo "data:...;base64,").
    // content_id (opcional) permite referenciar el adjunto como <img src="cid:..."> en el
    // HTML - necesario porque Gmail/Outlook bloquean las imagenes embebidas como data URI directo.
    body.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
      ...(a.contentId ? { content_id: a.contentId } : {})
    }));
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
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

// Arma y manda el mail de Parte Diario: Excel adjunto (mismo que "Exportar a Excel") +
// la captura del Gantt (semana actual) incrustada como imagen en el cuerpo del mensaje.
async function sendDailyBoardEmail({ recipients, excelBuffer, excelFilename, ganttImageBase64 }) {
  if (!recipients || recipients.length === 0) return { skipped: true };

  // ganttImageBase64 llega como data URI completo (data:image/png;base64,AAAA...) - Resend
  // necesita solo la parte base64, sin el prefijo, para el adjunto.
  const ganttBase64Content = ganttImageBase64 ? ganttImageBase64.split(',')[1] : null;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <p>Estimados, adjunto parte diario actual.</p>
      ${ganttBase64Content ? `<img src="cid:gantt-image" alt="Gantt Parte Diario" style="max-width:100%; border:1px solid #ccc; border-radius:6px; margin: 12px 0;" />` : ''}
      <p>Saludos.</p>
    </div>
  `;

  const attachments = [{ filename: excelFilename, contentBase64: excelBuffer.toString('base64') }];
  if (ganttBase64Content) {
    attachments.push({ filename: 'gantt.png', contentBase64: ganttBase64Content, contentId: 'gantt-image' });
  }

  return sendEmail({
    to: recipients,
    subject: `WellOps - Parte Diario`,
    html,
    attachments
  });
}

module.exports = { sendEmail, sendFailureReportNotification, sendDailyBoardEmail };
