// Calcula el color de semaforo de un asset en base a sus 6 fechas de certificacion.
// Regla: el color final = el mas critico de todos los certificados que tengan fecha.
// (si un certificado esta vencido, el asset se ve rojo aunque el resto este ok)

const CERT_FIELDS = [
  'cert_annual_expiry',
  'cert_major_expiry',
  'cert_load_test_expiry',
  'cert_nde_expiry',
  'cert_visual_expiry',
  'cert_calibration_expiry'
];

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

/**
 * @param {object} asset - fila de la tabla assets
 * @param {number} thresholdDays - dias de anticipacion para "amarillo" (viene de settings)
 * @returns {'verde'|'amarillo'|'rojo'|'sin_certificados'}
 */
function computeSemaphore(asset, thresholdDays = 30) {
  const relevantDates = CERT_FIELDS
    .map((field) => asset[field])
    .filter((value) => value !== null && value !== undefined);

  if (relevantDates.length === 0) return 'sin_certificados';

  const daysList = relevantDates.map(daysUntil);
  const mostCritical = Math.min(...daysList);

  if (mostCritical < 0) return 'rojo';
  if (mostCritical <= thresholdDays) return 'amarillo';
  return 'verde';
}

module.exports = { computeSemaphore, CERT_FIELDS };
