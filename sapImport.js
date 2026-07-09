const XLSX = require('xlsx');

// Nombres EXACTOS de columna tal cual vienen en el Excel exportado de SAP
// (hoja "RawData" del archivo SAP_Base_de_datos.xlsx que usamos de referencia).
const COLUMN_MAP = {
  code: 'Equipment (*)',
  description: 'Equipment Description',
  equipmentType: 'Equipment Type (*)',
  systemStatus: 'System Status (*)',
  currentLocation: 'Current Location (*)',
  serialNumber: 'Manu SerialNo.(*)',
  maxWorkingPressure: 'Maximum Working Pressure(PSI)',
  certAnnual: 'Annual Cert Expiry Date',
  certMajor: 'Major Cert Expiry Date',
  certLoadTest: 'Load Test',
  certNde: 'NDE Report',
  certVisual: 'Visual Examination',
  certCalibration: 'Calibration Cert'
};

function excelDateToJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  // A veces SAP exporta como numero serial de Excel en vez de fecha real
  if (typeof value === 'number') {
    return XLSX.SSF.parse_date_code(value)
      ? new Date(Math.round((value - 25569) * 86400 * 1000))
      : null;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parsea el buffer del archivo .xlsx de SAP y devuelve un array de objetos
 * listos para upsert-ear en la tabla `assets`.
 * @param {Buffer} fileBuffer
 * @param {string} sheetName - por defecto 'RawData', que es donde vive la data cruda
 */
function parseSapExcel(fileBuffer, sheetName = 'RawData') {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

  const targetSheet = workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0]; // fallback por si el nombre de hoja cambia

  const sheet = workbook.Sheets[targetSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  return rows
    .filter((row) => row[COLUMN_MAP.code]) // ignorar filas sin codigo de equipo
    .map((row) => ({
      sap_equipment_code: String(row[COLUMN_MAP.code]).trim(),
      description: row[COLUMN_MAP.description] || null,
      equipment_type: row[COLUMN_MAP.equipmentType] || null,
      system_status: row[COLUMN_MAP.systemStatus] || null,
      current_location: row[COLUMN_MAP.currentLocation] || null,
      serial_number: row[COLUMN_MAP.serialNumber] || null,
      max_working_pressure: row[COLUMN_MAP.maxWorkingPressure]
        ? String(row[COLUMN_MAP.maxWorkingPressure])
        : null,
      cert_annual_expiry: excelDateToJsDate(row[COLUMN_MAP.certAnnual]),
      cert_major_expiry: excelDateToJsDate(row[COLUMN_MAP.certMajor]),
      cert_load_test_expiry: excelDateToJsDate(row[COLUMN_MAP.certLoadTest]),
      cert_nde_expiry: excelDateToJsDate(row[COLUMN_MAP.certNde]),
      cert_visual_expiry: excelDateToJsDate(row[COLUMN_MAP.certVisual]),
      cert_calibration_expiry: excelDateToJsDate(row[COLUMN_MAP.certCalibration])
    }));
}

module.exports = { parseSapExcel, COLUMN_MAP };
