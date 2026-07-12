// services/failureReportExport.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, HeadingLevel, AlignmentType, BorderStyle, ImageRun
} = require('docx');

// Colores usados en el template real de Expro (HSEQ-LA-AR-FRM-023-001)
const COLOR_HEADER_TEAL = '0082A3';
const COLOR_SUBHEADER_TEAL = '4BACC6';
const COLOR_VERDE = '00B050';
const COLOR_AMARILLO = 'FFFF00';

function cell(text, { width, bold = false, shading = null, color = '000000', align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shading ? { type: ShadingType.CLEAR, color: 'auto', fill: shading } : undefined,
    children: [
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text, bold, color })]
      })
    ]
  });
}

async function buildFailureReportDoc(report) {
  const children = [];

  // Título
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'REPORTE DE FALLA / NO CONFORMIDAD', bold: true, size: 28 })]
  }));

  // Tabla de datos del evento (verdes + amarillos ya resueltos, formato igual al original)
  const datosRows = [
    ['Fecha del evento:', new Date(report.event_datetime).toLocaleString('es-AR')],
    ['Supervisor:', report.supervisor_nombre || ''],
    ['Pozo/Etapa:', report.pozo_etapa || ''],
    ['Cliente:', report.cliente_nombre || ''],
    ['NPT:', report.npt || ''],
    ['Clasificación:', report.clasificacion_nivel || '']
  ].map(([label, value]) => new TableRow({
    children: [
      cell(label, { width: 3000, bold: true }),
      cell(value, { width: 6500 })
    ]
  }));

  children.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: datosRows
  }));

  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // Sección 1: Descripción del evento
  children.push(new Paragraph({
    spacing: { before: 100, after: 100 },
    children: [new TextRun({ text: '1. Descripción del evento', bold: true, size: 24 })]
  }));

  const seccion = (titulo, texto) => new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [cell(titulo, { width: 9500, bold: true, shading: COLOR_SUBHEADER_TEAL, color: 'FFFFFF' })] }),
      new TableRow({ children: [cell(texto || '', { width: 9500 })] })
    ]
  });

  children.push(seccion('¿Qué sucedió?', report.descripcion_que_sucedio));
  children.push(new Paragraph({ text: '' }));
  children.push(seccion('¿Por qué sucedió?', report.descripcion_por_que));
  children.push(new Paragraph({ text: '' }));
  children.push(seccion('Acciones inmediatas', report.acciones_inmediatas));
  children.push(new Paragraph({ text: '' }));

  // Sección 2: análisis de causa raíz / acción correctiva (nuevo respecto al template original)
  children.push(new Paragraph({
    spacing: { before: 100, after: 100 },
    children: [new TextRun({ text: '2. Análisis y acción correctiva', bold: true, size: 24 })]
  }));
  children.push(seccion('Causa raíz', report.causa_raiz));
  children.push(new Paragraph({ text: '' }));
  children.push(seccion('Acción correctiva', report.accion_correctiva));
  children.push(new Paragraph({ text: '' }));

  const respRows = [
    new TableRow({
      children: [
        cell('Responsable de seguimiento:', { width: 4750, bold: true }),
        cell(report.responsable_nombre || '', { width: 4750 })
      ]
    }),
    new TableRow({
      children: [
        cell('Fecha de cierre:', { width: 4750, bold: true }),
        cell(report.fecha_cierre ? new Date(report.fecha_cierre).toLocaleDateString('es-AR') : '', { width: 4750 })
      ]
    })
  ];
  children.push(new Table({ width: { size: 9500, type: WidthType.DXA }, rows: respRows }));
  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // Sección 3: Assets fallados (nuevo — pedido explícito de mantenimiento)
  children.push(new Paragraph({
    spacing: { before: 100, after: 100 },
    children: [new TextRun({ text: '3. Assets involucrados en la falla', bold: true, size: 24 })]
  }));

  const assetHeaderRow = new TableRow({
    children: [
      cell('Código SAP', { width: 2500, bold: true, shading: COLOR_HEADER_TEAL, color: 'FFFFFF' }),
      cell('Descripción', { width: 3500, bold: true, shading: COLOR_HEADER_TEAL, color: 'FFFFFF' }),
      cell('Carreras acum.', { width: 1750, bold: true, shading: COLOR_HEADER_TEAL, color: 'FFFFFF' }),
      cell('Operaciones acum.', { width: 1750, bold: true, shading: COLOR_HEADER_TEAL, color: 'FFFFFF' })
    ]
  });

  const assetRows = (report.assets || []).map(a => new TableRow({
    children: [
      cell(a.sap_equipment_code || '', { width: 2500 }),
      cell(a.description || '', { width: 3500 }),
      cell(String(a.carreras_acumuladas ?? ''), { width: 1750 }),
      cell(String(a.operaciones_acumuladas ?? ''), { width: 1750 })
    ]
  }));

  children.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [assetHeaderRow, ...assetRows]
  }));
  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // Sección 4: Fotografías
  if (report.photos?.length) {
    children.push(new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: '4. Fotografías', bold: true, size: 24 })]
    }));
    for (const photo of report.photos) {
      if (fs.existsSync(photo.file_path)) {
        const imageBuffer = fs.readFileSync(photo.file_path);
        children.push(new Paragraph({
          children: [new ImageRun({ data: imageBuffer, type: 'jpg', transformation: { width: 500, height: 375 } })]
        }));
        children.push(new Paragraph({ text: '' }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 } } }, // US Letter
      children
    }]
  });

  return doc;
}

async function exportFailureReportToWord(report) {
  const doc = await buildFailureReportDoc(report);
  const buffer = await Packer.toBuffer(doc);
  const outPath = path.join('/tmp', `reporte-falla-${report.id}.docx`);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { exportFailureReportToWord, buildFailureReportDoc };
