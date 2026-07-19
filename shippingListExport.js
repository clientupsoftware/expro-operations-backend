// shippingListExport.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType } = require('docx');

function headerCell(text) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: 'D9D9D9' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })]
  });
}
function cell(text) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph(text || '-')]
  });
}

function itemsTable(items) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [5000, 5000],
    rows: [
      new TableRow({ children: [headerCell('Asset'), headerCell('N° de Serie')] }),
      ...items.map((it) => new TableRow({ children: [cell(it.asset_name), cell(it.serial_number)] }))
    ]
  });
}

// job: {client_name, pad_name, job_number}
// transportUnits: [{id, tipo, patente}]
// itemsByUnit: { [unit_id]: [items] }
// unassignedItems: [items]
async function exportShippingListToWord({ job, transportUnits, itemsByUnit, unassignedItems }) {
  const children = [
    new Paragraph({ text: 'Remito de Transporte', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `${job.client_name} · ${job.pad_name}${job.job_number ? ` · ${job.job_number}` : ''}`, bold: true })] }),
    new Paragraph({ text: `Fecha: ${new Date().toLocaleDateString('es-AR')}` }),
    new Paragraph({ text: '' })
  ];

  for (const unit of transportUnits) {
    const items = itemsByUnit[unit.id] || [];
    children.push(new Paragraph({ text: `${unit.tipo}${unit.patente ? ` — Patente: ${unit.patente}` : ''}`, heading: HeadingLevel.HEADING_2 }));
    if (items.length === 0) {
      children.push(new Paragraph({ text: 'Sin assets asignados a esta unidad.' }));
    } else {
      children.push(itemsTable(items));
    }
    children.push(new Paragraph({ text: '' }));
  }

  if (unassignedItems.length > 0) {
    children.push(new Paragraph({ text: 'Sin asignar a una unidad', heading: HeadingLevel.HEADING_2 }));
    children.push(itemsTable(unassignedItems));
  }

  const doc = new Document({
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children }]
  });

  const buffer = await Packer.toBuffer(doc);
  const filePath = path.join(os.tmpdir(), `remito-${Date.now()}.docx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { exportShippingListToWord };
