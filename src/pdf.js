const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_REG = path.join(__dirname, '..', 'fonts', 'Sarabun-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'Sarabun-Bold.ttf');

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_SHORT_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const STATUS_INFO = {
  0: { label: 'รออนุมัติ', color: '#b45309', bg: '#fef3c7' },
  1: { label: 'อนุมัติแล้ว', color: '#047857', bg: '#d1fae5' },
  2: { label: 'อยู่ระหว่างเดินทาง', color: '#4338ca', bg: '#e0e7ff' },
  6: { label: 'เสร็จสิ้นภารกิจ', color: '#0f766e', bg: '#ccfbf1' },
  9: { label: 'ไม่อนุมัติ / ยกเลิก', color: '#be123c', bg: '#ffe4e6' },
};

function fmtThaiDateFull(iso) {
  if (!iso || String(iso).startsWith('0000')) return '-';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  const y = Number(p[0]) + 543;
  const m = THAI_MONTHS[Number(p[1]) - 1] || p[1];
  return `${Number(p[2])} ${m} ${y}`;
}

function fmtThaiDateShort(iso) {
  if (!iso || String(iso).startsWith('0000')) return '-';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  const y = Number(p[0]) + 543;
  const m = THAI_SHORT_MONTHS[Number(p[1]) - 1] || p[1];
  return `${Number(p[2])} ${m} ${String(y).slice(-2)}`;
}

function generateTravelRequestPdf(item, res, download = false) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 38, bottom: 38, left: 42, right: 42 },
    info: {
      Title: `ใบขออนุมัติเดินทางไปราชการ ${item.doc_no || `#${item.row_id}`}`,
      Author: 'โรงพยาบาลโคกศรีสุพรรณ',
    },
  });

  const filename = `travel-${item.row_id}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  doc.pipe(res);

  doc.registerFont('Sarabun', FONT_REG);
  doc.registerFont('Sarabun-Bold', FONT_BOLD);

  const pageW = doc.page.width;
  const left = 42;
  const contentW = pageW - left * 2;

  // ===== HEADER BANNER =====
  doc.roundedRect(left, 36, contentW, 70, 8).fillAndStroke('#eef2ff', '#4f46e5');

  doc.fillColor('#312e81').font('Sarabun-Bold').fontSize(16)
    .text('ใบขออนุมัติเดินทางไปราชการออนไลน์', left + 16, 46, { width: 330 });
  doc.fillColor('#334155').font('Sarabun').fontSize(11)
    .text('โรงพยาบาลโคกศรีสุพรรณ จังหวัดสกลนคร', left + 16, 68, { width: 330 });
  doc.fillColor('#64748b').fontSize(9.5)
    .text(`วันที่ยื่นคำขอ: ${item.created_at || '-'}`, left + 16, 85, { width: 330 });

  const st = STATUS_INFO[item.status] || { label: `สถานะ ${item.status}`, color: '#334155', bg: '#e2e8f0' };
  doc.roundedRect(left + contentW - 160, 44, 146, 54, 6).fillAndStroke('#ffffff', '#c7d2fe');
  doc.fillColor('#64748b').font('Sarabun').fontSize(8.5)
    .text('เลขที่คำขอไปราชการ', left + contentW - 160, 48, { width: 146, align: 'center' });
  doc.fillColor('#1e1b4b').font('Sarabun-Bold').fontSize(12.5)
    .text(item.doc_no || `#${item.row_id}`, left + contentW - 160, 60, { width: 146, align: 'center' });

  doc.roundedRect(left + contentW - 142, 80, 110, 14, 7).fill(st.bg);
  doc.fillColor(st.color).font('Sarabun-Bold').fontSize(8.5)
    .text(st.label, left + contentW - 142, 81, { width: 110, align: 'center' });

  // ===== SECTION 1 =====
  let y = 122;
  doc.fillColor('#312e81').font('Sarabun-Bold').fontSize(12).text('1. ข้อมูลผู้ขออนุญาตและการเดินทางไปราชการ', left, y);
  y += 20;

  const labelW = 155;
  const valW = contentW - labelW;

  const dateRange = item.start_date === item.end_date
    ? fmtThaiDateFull(item.start_date)
    : `${fmtThaiDateFull(item.start_date)} ถึง ${fmtThaiDateFull(item.end_date)}`;

  const rows1 = [
    ['ผู้ขออนุญาต / ตำแหน่ง', `${item.requester_name || '-'}${item.requester_position ? ` (${item.requester_position})` : ''}`],
    ['หน่วยงาน / กลุ่มงาน', `${item.unit_name || item.unit_custom || '-'}${item.requester_tel ? `  โทร. ${item.requester_tel}` : ''}`],
    ['เรื่อง / วัตถุประสงค์', item.subject || '-', true],
    ['ประเภทการไปราชการ', item.travel_type || '-'],
    ['สถานที่ / จังหวัด', `${item.destination || '-'}  (จ.${item.province || '-'})`],
    ['วัน-เวลาที่เดินทาง', `${dateRange}   เวลา ${item.start_time || '-'} - ${item.end_time || '-'} น.`],
    ['รายชื่อผู้ร่วมเดินทาง', `${item.travelers || '-'}  (รวม ${item.traveler_count || 1} คน)`],
    ['พาหนะ / งบประมาณ', `${item.transport_type || '-'}  |  ${item.budget_source || '-'} (ประมาณการ ${Number(item.estimated_cost || 0).toLocaleString()} บาท)`],
  ];

  for (let i = 0; i < rows1.length; i++) {
    const [lbl, val, boldVal] = rows1[i];
    doc.font(boldVal ? 'Sarabun-Bold' : 'Sarabun').fontSize(10);
    const textH = doc.heightOfString(String(val), { width: valW - 16 });
    const rowH = Math.max(24, textH + 11);

    doc.rect(left, y, labelW, rowH).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.rect(left + labelW, y, valW, rowH).fillAndStroke('#ffffff', '#cbd5e1');

    doc.fillColor('#334155').font('Sarabun-Bold').fontSize(9.5)
      .text(lbl, left + 10, y + 6, { width: labelW - 16 });
    doc.fillColor('#0f172a').font(boldVal ? 'Sarabun-Bold' : 'Sarabun').fontSize(10)
      .text(String(val), left + labelW + 10, y + 6, { width: valW - 16 });

    y += rowH;
  }

  // ===== SECTION 2 =====
  y += 14;
  doc.fillColor('#065f46').font('Sarabun-Bold').fontSize(12).text('2. การพิจารณาอนุมัติและมอบหมายผู้ดำเนินการ', left, y);
  y += 20;

  const rows2 = [
    ['สถานะการอนุมัติ', st.label, true],
    ['ผู้ประสานงาน / พขร. / ผู้ดำเนินการ', item.assigned_to || '-'],
    ['ผู้อนุมัติ / วันที่อนุมัติ', `${item.approver_name || '-'}${item.approved_at ? `  (${item.approved_at})` : ''}`],
    ['ความเห็น / หมายเหตุอนุมัติ', item.approval_note || item.memo || '-'],
    ['ค่าใช้จ่ายจริง (หลังเสร็จภารกิจ)', `${Number(item.actual_cost || 0).toLocaleString()} บาท`],
  ];

  for (let i = 0; i < rows2.length; i++) {
    const [lbl, val, boldVal] = rows2[i];
    doc.font(boldVal ? 'Sarabun-Bold' : 'Sarabun').fontSize(10);
    const textH = doc.heightOfString(String(val), { width: valW - 16 });
    const rowH = Math.max(24, textH + 11);

    doc.rect(left, y, labelW, rowH).fillAndStroke('#ecfdf5', '#cbd5e1');
    doc.rect(left + labelW, y, valW, rowH).fillAndStroke('#ffffff', '#cbd5e1');

    doc.fillColor('#065f46').font('Sarabun-Bold').fontSize(9.5)
      .text(lbl, left + 10, y + 6, { width: labelW - 16 });
    doc.fillColor('#0f172a').font(boldVal ? 'Sarabun-Bold' : 'Sarabun').fontSize(10)
      .text(String(val), left + labelW + 10, y + 6, { width: valW - 16 });

    y += rowH;
  }

  // ===== SIGNATURE BLOCK =====
  const sigY = Math.max(y + 28, 660);
  const colW = contentW / 3;
  const sigs = [
    { title: 'ผู้ขออนุญาตไปราชการ', name: item.requester_name || '' },
    { title: 'หัวหน้ากลุ่มงาน / ผู้เห็นชอบ', name: '' },
    { title: 'ผู้อำนวยการ / ผู้อนุมัติ', name: item.approver_name || '' },
  ];

  sigs.forEach((s, idx) => {
    const sx = left + idx * colW;
    doc.fillColor('#334155').font('Sarabun').fontSize(10)
      .text('ลงชื่อ ...............................................', sx, sigY, { width: colW, align: 'center' });
    doc.text(`( ${s.name ? s.name : '...........................................'} )`, sx, sigY + 18, { width: colW, align: 'center' });
    doc.font('Sarabun-Bold').text(s.title, sx, sigY + 35, { width: colW, align: 'center' });
    doc.font('Sarabun').fontSize(9).fillColor('#64748b')
      .text('วันที่ ........../........../..........', sx, sigY + 52, { width: colW, align: 'center' });
  });

  const nowStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  doc.fillColor('#94a3b8').font('Sarabun').fontSize(8.5)
    .text(`พิมพ์จากระบบขออนุมัติไปราชการออนไลน์ โรงพยาบาลโคกศรีสุพรรณ | พิมพ์เมื่อ ${nowStr}`, left, 790, {
      width: contentW,
      align: 'center',
    });

  doc.end();
}

function generateTravelBoardPdf(items, filterDesc, res, download = false) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 32, bottom: 32, left: 30, right: 30 },
    info: {
      Title: 'รายงานการเดินทางไปราชการ โรงพยาบาลโคกศรีสุพรรณ',
      Author: 'โรงพยาบาลโคกศรีสุพรรณ',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="travel-board.pdf"`);
  doc.pipe(res);

  doc.registerFont('Sarabun', FONT_REG);
  doc.registerFont('Sarabun-Bold', FONT_BOLD);

  const left = 30;
  const contentW = doc.page.width - left * 2;

  const drawHeader = () => {
    doc.fillColor('#312e81').font('Sarabun-Bold').fontSize(14)
      .text('รายงานสรุปการขออนุมัติเดินทางไปราชการ โรงพยาบาลโคกศรีสุพรรณ', left, 26, { width: contentW, align: 'center' });
    doc.fillColor('#475569').font('Sarabun').fontSize(9.5)
      .text(filterDesc || 'รายการทั้งหมด', left, 46, { width: contentW, align: 'center' });

    const cols = [
      { label: 'เลขที่คำขอ', w: 72 },
      { label: 'วันที่เดินทาง', w: 76 },
      { label: 'เรื่อง / วัตถุประสงค์', w: 185 },
      { label: 'สถานที่ / จังหวัด', w: 120 },
      { label: 'หน่วยงาน / ผู้ขอ', w: 112 },
      { label: 'พาหนะ / ผู้ดำเนินการ', w: 96 },
      { label: 'งบ (บ.)', w: 54 },
      { label: 'สถานะ', w: 66 },
    ];
    let cx = left;
    const hy = 66;
    cols.forEach((c) => {
      doc.rect(cx, hy, c.w, 22).fillAndStroke('#e0e7ff', '#94a3b8');
      doc.fillColor('#1e1b4b').font('Sarabun-Bold').fontSize(9)
        .text(c.label, cx + 4, hy + 5, { width: c.w - 8, align: 'center' });
      cx += c.w;
    });
    return { cols, startY: hy + 22 };
  };

  let { cols, startY: y } = drawHeader();

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const st = STATUS_INFO[r.status] || { label: String(r.status), color: '#334155' };
    const vals = [
      r.doc_no || `#${r.row_id}`,
      `${fmtThaiDateShort(r.start_date)}${r.end_date && r.end_date !== r.start_date ? `\nถึง ${fmtThaiDateShort(r.end_date)}` : ''}`,
      r.subject || '-',
      `${r.destination || '-'}\n(จ.${r.province || '-'})`,
      `${r.unit_name || r.unit_custom || '-'}\n${r.requester_name || '-'}`,
      `${r.transport_type || '-'}${r.assigned_to ? `\n(${r.assigned_to})` : ''}`,
      Number(r.estimated_cost || 0).toLocaleString(),
      st.label,
    ];

    doc.font('Sarabun').fontSize(8.5);
    let maxH = 20;
    vals.forEach((v, idx) => {
      const h = doc.heightOfString(String(v), { width: cols[idx].w - 8 }) + 8;
      if (h > maxH) maxH = h;
    });

    if (y + maxH > doc.page.height - 36) {
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 32, bottom: 32, left: 30, right: 30 } });
      ({ cols, startY: y } = drawHeader());
    }

    let cx = left;
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    vals.forEach((v, idx) => {
      doc.rect(cx, y, cols[idx].w, maxH).fillAndStroke(rowBg, '#cbd5e1');
      doc.fillColor(idx === 7 ? st.color : '#0f172a')
        .font(idx === 7 ? 'Sarabun-Bold' : 'Sarabun')
        .fontSize(8.5)
        .text(String(v), cx + 4, y + 4, { width: cols[idx].w - 8 });
      cx += cols[idx].w;
    });
    y += maxH;
  }

  doc.end();
}

module.exports = { generateTravelRequestPdf, generateTravelBoardPdf };
