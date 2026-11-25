const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const FONT_REG = path.join(__dirname, '..', 'fonts', 'THSarabun.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'THSarabun-Bold.ttf');
const GARUDA_PATH = path.join(__dirname, '..', 'public', 'garuda.png');

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];

function toThaiDigits(val) {
  return String(val ?? '').replace(/\d/g, (d) => THAI_DIGITS[Number(d)]);
}

function fmtThaiDatePlain(iso) {
  if (!iso || String(iso).startsWith('0000')) return '';
  const s = String(iso).slice(0, 10);
  const p = s.split('-');
  if (p.length !== 3) return s;
  return `${Number(p[2])} ${THAI_MONTHS_FULL[Number(p[1]) - 1] || p[1]} ${Number(p[0]) + 543}`;
}

function fmtMoney(n) {
  const num = Number(n || 0);
  return num > 0 ? num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

function isThaiCombining(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

function splitThaiLines(doc, text, firstW, nextW, maxLines = 2) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (doc.widthOfString(clean) <= firstW) return [clean];

  const fitSlice = (str, maxW) => {
    if (doc.widthOfString(str) <= maxW) return [str, ''];
    let best = 1;
    let lastSpace = -1;
    for (let i = 1; i <= str.length; i++) {
      if (i < str.length && isThaiCombining(str[i])) continue;
      const sub = str.slice(0, i);
      if (doc.widthOfString(sub) <= maxW) {
        best = i;
        if (str[i - 1] === ' ') lastSpace = i;
      } else {
        break;
      }
    }
    const cut = lastSpace > Math.floor(best * 0.65) ? lastSpace : best;
    return [str.slice(0, cut).trim(), str.slice(cut).trim()];
  };

  const lines = [];
  let remaining = clean;
  for (let idx = 0; idx < maxLines; idx++) {
    const w = idx === 0 ? firstW : nextW;
    if (idx === maxLines - 1) {
      lines.push(remaining);
      break;
    }
    const [head, tail] = fitSlice(remaining, w);
    lines.push(head);
    if (!tail) break;
    remaining = tail;
  }
  return lines;
}

function drawDottedLine(doc, x1, x2, y) {
  if (x2 <= x1) return;
  doc.save();
  doc.lineWidth(0.55).dash(1.1, { space: 1.8 }).moveTo(x1, y).lineTo(x2, y).stroke('#333333');
  doc.undash().restore();
}

function drawField(doc, label, value, x, endX, y, opts = {}) {
  const { boldLabel = false, align = 'left', fontSize = 16, padLeft = 6 } = opts;
  doc.font(boldLabel ? 'ThaiBold' : 'Thai').fontSize(fontSize).text(label, x, y, { lineBreak: false });
  const lblW = doc.widthOfString(label);
  const lineX1 = x + lblW + 4;
  drawDottedLine(doc, lineX1, endX, y + 15.5);
  const valStr = String(value ?? '').trim();
  if (valStr && endX > lineX1 + 8) {
    doc.font('Thai').fontSize(fontSize).text(valStr, lineX1 + (align === 'center' ? 2 : padLeft), y - 0.5, {
      width: endX - lineX1 - (align === 'center' ? 4 : padLeft + 2),
      align,
      lineBreak: false,
    });
  }
}

function drawWrappedField(doc, label, value, x, endX, y, maxLines = 2, lineStep = 22) {
  doc.font('Thai').fontSize(16).text(label, x, y, { lineBreak: false });
  const x1 = x + doc.widthOfString(label) + 6;
  const lines = splitThaiLines(doc, value || '', endX - x1 - 8, endX - x - 8, maxLines);
  drawDottedLine(doc, x1, endX, y + 15.5);
  if (lines[0]) {
    doc.text(lines[0], x1 + 4, y - 0.5, { width: endX - x1 - 8, lineBreak: false });
  }
  for (let i = 1; i < maxLines; i++) {
    y += lineStep;
    drawDottedLine(doc, x, endX, y + 15.5);
    if (lines[i]) {
      doc.text(lines[i], x + 4, y - 0.5, { width: endX - x - 8, lineBreak: false });
    }
  }
  return y + lineStep;
}

function sendPdf(doc, filename, res, isDownload) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  doc.pipe(res);
  doc.end();
}

function setupDoc(size = 'A4', layout = 'portrait') {
  const doc = new PDFDocument({
    size,
    layout,
    margins: { top: 28, bottom: 18, left: 48, right: 48 },
  });
  doc.registerFont('Thai', FONT_REG);
  doc.registerFont('ThaiBold', FONT_BOLD);
  return doc;
}

function getCompanions(item) {
  if (Array.isArray(item.companions) && item.companions.length) {
    return item.companions;
  }
  if (item.requester_name) {
    return [{ full_name: item.requester_name, position: item.requester_position || '' }];
  }
  return [];
}

function formatDocNoThai(rawOrder) {
  const raw = String(rawOrder || '').trim();
  if (!raw) return 'สน ๐๐๓๓.๓๐๑/';
  if (raw.includes('สน')) return raw;
  return `สน ๐๐๓๓.๓๐๑/${raw}`;
}

/**
 * Form 1: บันทึกข้อความ ขออนุมัติไปราชการ (ในเขตจังหวัด / ทั่วไป)
 */
function renderMemoInPage(doc, item) {
  const L = 62;
  const R = 538;
  const INDENT = L + 52;

  if (fs.existsSync(GARUDA_PATH)) {
    doc.image(GARUDA_PATH, L, 30, { width: 45 });
  }
  doc.font('ThaiBold').fontSize(24).text('บันทึกข้อความ', 48, 48, { align: 'center', width: 500, lineBreak: false });

  let y = 88;
  drawField(doc, 'ส่วนราชการ', 'โรงพยาบาลโคกศรีสุพรรณ  อำเภอโคกศรีสุพรรณ  จังหวัดสกลนคร', L, R, y, { boldLabel: true });

  y = 110;
  drawField(doc, 'ที่', formatDocNoThai(item.doc_no), L, 286, y, { boldLabel: true });
  const memoDateStr = fmtThaiDatePlain(item.memo_date || item.start_date);
  drawField(doc, 'วันที่', memoDateStr, 292, R, y, { boldLabel: true, align: 'center' });

  y = 132;
  drawField(doc, 'เรื่อง', 'ขออนุมัติไปราชการ', L, R, y, { boldLabel: true });

  y = 156;
  doc.font('ThaiBold').fontSize(16).text('เรียน', L, y, { lineBreak: false });
  doc.font('Thai').fontSize(16).text('ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ', L + doc.widthOfString('เรียน') + 10, y, { lineBreak: false });

  y = 182;
  const reqDept = String(item.request_dept || item.unit_name || '').trim();
  doc.font('Thai').fontSize(16);
  const openPrefix = 'ด้วย';
  const openSuffix = 'โรงพยาบาลโคกศรีสุพรรณ มีความประสงค์';
  const suffixW = doc.widthOfString(openSuffix);
  const suffixX = R - suffixW;
  doc.text(openPrefix, INDENT, y, { lineBreak: false });
  const deptLineX1 = INDENT + doc.widthOfString(openPrefix) + 6;
  const deptLineX2 = suffixX - 6;
  drawDottedLine(doc, deptLineX1, deptLineX2, y + 15.5);
  if (reqDept) {
    doc.text(reqDept, deptLineX1 + 2, y - 0.5, { width: deptLineX2 - deptLineX1 - 4, align: 'center', lineBreak: false });
  }
  doc.text(openSuffix, suffixX, y, { lineBreak: false });

  y += 22;
  y = drawWrappedField(doc, 'จะขออนุมัติไปราชการเกี่ยวกับ', item.subject || '', L, R, y, 2, 22);
  y = drawWrappedField(doc, 'ที่', item.destination || '', L, R, y, 2, 22);

  drawField(doc, 'ระหว่างวันที่', fmtThaiDatePlain(item.start_date), L, 296, y, { align: 'center' });
  drawField(doc, 'ถึงวันที่', fmtThaiDatePlain(item.end_date || item.start_date), 302, R, y, { align: 'center' });

  y += 22;
  const vehSuffix = 'และมีผู้ร่วมเดินทางไปราชการครั้งนี้ คือ';
  const vehSuffixW = doc.widthOfString(vehSuffix);
  const vehSuffixX = R - vehSuffixW;
  drawField(doc, 'โดยพาหนะ', item.transport_type || '', L, vehSuffixX - 6, y, { align: 'center' });
  doc.font('Thai').fontSize(16).text(vehSuffix, vehSuffixX, y, { lineBreak: false });

  y += 24;
  const comps = getCompanions(item);
  for (let i = 1; i <= 6; i++) {
    const c = comps[i - 1] || {};
    doc.font('Thai').fontSize(16).text(`${i}.`, L + 34, y, { lineBreak: false });
    drawDottedLine(doc, L + 52, 298, y + 15.5);
    if (c.full_name) {
      doc.text(c.full_name, L + 56, y - 0.5, { width: 298 - (L + 56) - 4, lineBreak: false });
    }
    doc.text('ตำแหน่ง', 304, y, { lineBreak: false });
    const posLineX1 = 304 + doc.widthOfString('ตำแหน่ง') + 6;
    drawDottedLine(doc, posLineX1, R, y + 15.5);
    if (c.position) {
      doc.text(c.position, posLineX1 + 4, y - 0.5, { width: R - posLineX1 - 8, lineBreak: false });
    }
    y += 20;
  }

  y += 4;
  drawField(doc, 'ในการไปราชการครั้งนี้ ขออนุมัติใช้งบประมาณจาก (หน่วยงานผู้จัด)', item.org_budget_text || item.organizer || '', L, R, y);

  y += 22;
  const hospTotal = Number(item.estimated_cost || 0);
  doc.font('Thai').fontSize(16).text('เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ    เป็นเงิน', L, y, { lineBreak: false });
  const amtX1 = L + doc.widthOfString('เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ    เป็นเงิน') + 6;
  const amtX2 = amtX1 + 110;
  drawDottedLine(doc, amtX1, amtX2, y + 15.5);
  if (hospTotal > 0) {
    doc.text(fmtMoney(hospTotal), amtX1 + 2, y - 0.5, { width: amtX2 - amtX1 - 4, align: 'center', lineBreak: false });
  }
  doc.text('บาท', amtX2 + 8, y, { lineBreak: false });

  y += 26;
  doc.font('Thai').fontSize(16).text('จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ', INDENT, y, { lineBreak: false });

  const reqName = String(item.requester_name || comps[0]?.full_name || '').trim();
  const reqPos = String(item.requester_position || comps[0]?.position || '').trim();

  y += 26;
  const sigX1 = 294;
  const sigX2 = 448;
  doc.font('Thai').fontSize(16).text('(ลงชื่อ)', sigX1, y, { lineBreak: false });
  drawDottedLine(doc, sigX1 + doc.widthOfString('(ลงชื่อ)') + 4, sigX2, y + 15.5);
  doc.text('ผู้ขออนุมัติ', sigX2 + 6, y, { lineBreak: false });

  y += 20;
  doc.text('(', sigX1 + 32, y, { lineBreak: false });
  drawDottedLine(doc, sigX1 + 38, sigX2 - 4, y + 15.5);
  if (reqName) {
    doc.text(reqName, sigX1 + 40, y - 0.5, { width: sigX2 - sigX1 - 46, align: 'center', lineBreak: false });
  }
  doc.text(')', sigX2, y, { lineBreak: false });

  y += 20;
  drawField(doc, 'ตำแหน่ง', reqPos, sigX1 - 8, sigX2 + 54, y, { align: 'center' });

  y += 28;
  doc.font('Thai').fontSize(16).text('ความเห็นของหัวหน้ากลุ่มงาน', L, y, { lineBreak: false });
  y += 20;
  doc.text('-   เห็นควรอนุมัติ', L + 22, y, { lineBreak: false });

  y += 38;
  doc.font('Thai').fontSize(16).text('(   )  อนุมัติ       (   )  ไม่อนุมัติ', 48, y, { align: 'center', width: 500, lineBreak: false });

  const dirName = String(item.director_name || 'นางณัฐปภัสร์ นวัตชัยศิริกุล').trim();
  const dirPos1 = String(item.director_pos1 || 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง').trim();
  const dirPos2 = String(item.director_pos2 || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ').trim();

  y += 48;
  doc.font('Thai').fontSize(16);
  doc.text(`(  ${dirName}  )`, 230, y, { width: 290, align: 'center', lineBreak: false });
  y += 20;
  doc.text(dirPos1, 230, y, { width: 290, align: 'center', lineBreak: false });
  y += 20;
  doc.text(dirPos2, 230, y, { width: 290, align: 'center', lineBreak: false });
}

/**
 * Form 2: บันทึกข้อความ ขออนุมัติไปราชการนอกเขตจังหวัด
 */
function renderMemoOutPage(doc, item) {
  const L = 62;
  const R = 538;
  const INDENT = L + 52;

  if (fs.existsSync(GARUDA_PATH)) {
    doc.image(GARUDA_PATH, L, 30, { width: 45 });
  }
  doc.font('ThaiBold').fontSize(24).text('บันทึกข้อความ', 48, 48, { align: 'center', width: 500, lineBreak: false });

  let y = 88;
  drawField(doc, 'ส่วนราชการ', 'โรงพยาบาลโคกศรีสุพรรณ  อำเภอโคกศรีสุพรรณ  จังหวัดสกลนคร', L, R, y, { boldLabel: true });

  y = 110;
  drawField(doc, 'ที่', formatDocNoThai(item.doc_no), L, 286, y, { boldLabel: true });
  const memoDateStr = fmtThaiDatePlain(item.memo_date || item.start_date);
  drawField(doc, 'วันที่', memoDateStr, 292, R, y, { boldLabel: true, align: 'center' });

  y = 132;
  drawField(doc, 'เรื่อง', 'ขออนุมัติไปราชการนอกเขตจังหวัด', L, R, y, { boldLabel: true });

  y = 156;
  doc.font('ThaiBold').fontSize(16).text('เรียน', L, y, { lineBreak: false });
  doc.font('Thai').fontSize(16).text('นายแพทย์สาธารณสุขจังหวัดสกลนคร', L + doc.widthOfString('เรียน') + 10, y, { lineBreak: false });

  y = 180;
  drawField(doc, 'ด้วย ได้รับแจ้งจาก', item.organizer || '', INDENT, R, y);

  y += 22;
  y = drawWrappedField(doc, 'จะจัดให้มีการประชุม/สัมมนา/อบรม เรื่อง', item.subject || '', L, R, y, 2, 22);

  drawField(doc, 'ระหว่างวันที่', fmtThaiDatePlain(item.start_date), L, 296, y, { align: 'center' });
  drawField(doc, 'ถึงวันที่', fmtThaiDatePlain(item.end_date || item.start_date), 302, R, y, { align: 'center' });

  y += 22;
  drawField(doc, 'ณ', `${item.destination || ''}${item.province ? ` จ.${item.province}` : ''}`, L, R, y);

  y += 22;
  const comps = getCompanions(item);
  doc.font('Thai').fontSize(16).text('จึงขออนุมัติให้ผู้มีรายชื่อดังต่อไปนี้ไปราชการ  ตั้งแต่วันที่', INDENT, y, { lineBreak: false });
  const dtX1 = INDENT + doc.widthOfString('จึงขออนุมัติให้ผู้มีรายชื่อดังต่อไปนี้ไปราชการ  ตั้งแต่วันที่') + 6;
  drawDottedLine(doc, dtX1, R, y + 15.5);
  const startLabel = fmtThaiDatePlain(item.start_date);
  if (startLabel) {
    doc.text(startLabel, dtX1 + 2, y - 0.5, { width: R - dtX1 - 4, align: 'center', lineBreak: false });
  }

  y += 22;
  for (let i = 1; i <= 6; i++) {
    const c = comps[i - 1] || {};
    doc.font('Thai').fontSize(16).text(`${toThaiDigits(i)}.`, L + 34, y, { lineBreak: false });
    drawDottedLine(doc, L + 52, 298, y + 15.5);
    if (c.full_name) {
      doc.text(c.full_name, L + 56, y - 0.5, { width: 298 - (L + 56) - 4, lineBreak: false });
    }
    doc.text('ตำแหน่ง', 304, y, { lineBreak: false });
    const posLineX1 = 304 + doc.widthOfString('ตำแหน่ง') + 6;
    drawDottedLine(doc, posLineX1, R, y + 15.5);
    if (c.position) {
      doc.text(c.position, posLineX1 + 4, y - 0.5, { width: R - posLineX1 - 8, lineBreak: false });
    }
    y += 20;
  }

  y += 4;
  doc.font('Thai').fontSize(16).text('ในการประชุม/สัมมนา/อบรม  ครั้งนี้ได้เบิกเงินค่าเบี้ยเลี้ยง ที่พัก พาหนะ และค่าลงทะเบียน เบิกจาก', INDENT, y, { lineBreak: false });

  y += 22;
  const hospTotal = Number(item.estimated_cost || 0);
  const orgBud = String(item.org_budget_text || '').trim();
  const lblBudget = 'เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ/';
  doc.text(lblBudget, L, y, { lineBreak: false });
  const bx1 = L + doc.widthOfString(lblBudget) + 4;
  const bx2 = 368;
  drawDottedLine(doc, bx1, bx2, y + 15.5);
  if (orgBud) doc.text(orgBud, bx1 + 4, y - 0.5, { width: bx2 - bx1 - 8, lineBreak: false });
  doc.text('เป็นเงิน', bx2 + 6, y, { lineBreak: false });
  const ax1 = bx2 + 6 + doc.widthOfString('เป็นเงิน') + 4;
  const ax2 = R - 28;
  drawDottedLine(doc, ax1, ax2, y + 15.5);
  if (hospTotal > 0) doc.text(fmtMoney(hospTotal), ax1 + 2, y - 0.5, { width: ax2 - ax1 - 4, align: 'center', lineBreak: false });
  doc.text('บาท', R - 22, y, { lineBreak: false });

  y += 22;
  drawField(doc, 'และในการไปราชการครั้งนี้เดินทางโดย', item.transport_type || '', L, R, y);

  y += 24;
  doc.font('Thai').fontSize(16).text('จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ', INDENT, y, { lineBreak: false });

  const reqName = String(item.requester_name || comps[0]?.full_name || '').trim();
  const reqPos = String(item.requester_position || comps[0]?.position || '').trim();

  y += 24;
  const sigX1 = 294;
  const sigX2 = 448;
  doc.font('Thai').fontSize(16).text('(ลงชื่อ)', sigX1, y, { lineBreak: false });
  drawDottedLine(doc, sigX1 + doc.widthOfString('(ลงชื่อ)') + 4, sigX2, y + 15.5);
  doc.text('ผู้ขออนุมัติ', sigX2 + 6, y, { lineBreak: false });

  y += 20;
  doc.text('(', sigX1 + 32, y, { lineBreak: false });
  drawDottedLine(doc, sigX1 + 38, sigX2 - 4, y + 15.5);
  if (reqName) doc.text(reqName, sigX1 + 40, y - 0.5, { width: sigX2 - sigX1 - 46, align: 'center', lineBreak: false });
  doc.text(')', sigX2, y, { lineBreak: false });

  y += 20;
  drawField(doc, 'ตำแหน่ง', reqPos, sigX1 - 8, sigX2 + 54, y, { align: 'center' });

  y += 16;
  doc.font('Thai').fontSize(16).text('ความเห็นของหัวหน้ากลุ่มงาน', L, y, { lineBreak: false });
  y += 20;
  doc.text('-   เห็นควรอนุมัติ', L + 22, y, { lineBreak: false });

  y += 32;
  doc.text('(', L + 16, y, { lineBreak: false });
  drawDottedLine(doc, L + 22, L + 178, y + 15.5);
  if (item.head_name) doc.text(item.head_name, L + 24, y - 0.5, { width: 152, align: 'center', lineBreak: false });
  doc.text(')', L + 182, y, { lineBreak: false });
  y += 20;
  drawField(doc, 'ตำแหน่ง', item.head_position || '', L + 10, L + 200, y, { align: 'center' });

  y += 26;
  doc.font('ThaiBold').fontSize(16).text('คำสั่ง', 200, y, { lineBreak: false });
  doc.font('Thai').fontSize(16).text('(   )  อนุญาต     (   )  ไม่อนุญาต', 246, y, { lineBreak: false });

  const dirName = String(item.director_name || 'นางณัฐปภัสร์ นวัตชัยศิริกุล').trim();
  const dirPos1 = String(item.director_pos1 || 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง').trim();

  y += 44;
  doc.font('Thai').fontSize(16);
  doc.text(`(  ${dirName}  )`, 210, y, { width: 328, align: 'center', lineBreak: false });
  y += 20;
  doc.text(dirPos1, 210, y, { width: 328, align: 'center', lineBreak: false });
  y += 20;
  doc.text('ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ  ปฏิบัติราชการแทน  ผู้ว่าราชการจังหวัดสกลนคร', 210, y, { width: 328, align: 'center', lineBreak: false });
  y += 20;
  doc.text('ตามคำสั่งจังหวัดสกลนคร ที่ ๔๐๐๘/๒๕๖๘ ลงวันที่ ๒๒ ธันวาคม พ.ศ. ๒๕๖๘', 210, y, { width: 328, align: 'center', lineBreak: false });
}

/**
 * Form 3: ใบแนบการขออนุมัติไปราชการ ประชุม/อบรม
 */
function renderAttachmentPage(doc, item) {
  const L = 62;
  const R = 538;
  const att = item.attachment || {};
  const comps = getCompanions(item);
  const reqName = String(item.requester_name || comps[0]?.full_name || '').trim();
  const reqPos = String(item.requester_position || comps[0]?.position || '').trim();

  let y = 42;
  doc.font('ThaiBold').fontSize(18).text('ใบแนบการขออนุมัติไปราชการ  ประชุม/อบรม', 48, y, { align: 'center', width: 500, lineBreak: false });
  y += 22;
  doc.font('ThaiBold').fontSize(18).text('โรงพยาบาลโคกศรีสุพรรณ', 48, y, { align: 'center', width: 500, lineBreak: false });

  y += 32;
  drawField(doc, 'ข้าพเจ้า', reqName, L + 52, 330, y, { align: 'center' });
  drawField(doc, 'ตำแหน่ง', reqPos, 336, R, y, { align: 'center' });

  y += 24;
  const dateRange = `${fmtThaiDatePlain(item.start_date)} - ${fmtThaiDatePlain(item.end_date || item.start_date)}`;
  const summaryLine = `${item.subject || ''} (${dateRange} ณ ${item.destination || ''})`;
  y = drawWrappedField(doc, 'ขอไปราชการ ( เรื่อง/วัน/เวลา/สถานที่ )', summaryLine, L, R, y, 2, 22);

  y += 14;
  doc.font('ThaiBold').fontSize(16).text('ประวัติการไปประชุม ( แนบรายละเอียด )', L, y, { lineBreak: false });
  y += 22;
  const hs = att.history_status || 'never';
  doc.font('Thai').fontSize(16);
  doc.text(
    `เรื่องที่ไป  ( ${hs === 'ever' ? '/' : ' '} )  เคยไปแล้ว      ( ${hs === 'never' ? '/' : ' '} )  ไม่เคยไป      ( ${hs === 'others_ever' ? '/' : ' '} )  ผู้อื่นเคยไปแล้ว`,
    L,
    y,
    { lineBreak: false }
  );

  y += 28;
  y = drawWrappedField(doc, 'ความเหมาะสม/ ความจำเป็นที่ต้องไป', att.necessity_reason || '', L, R, y, 3, 22);

  y += 10;
  drawField(doc, 'ระหว่างที่ไป งานที่รับผิดชอบ ผู้ที่ปฏิบัติงานแทน คือ', att.delegate_name || '', L, R, y);

  y += 26;
  y = drawWrappedField(doc, 'ประโยชน์ที่คาดว่าจะได้รับ', att.expected_benefit || '', L, R, y, 3, 22);

  y += 10;
  y = drawWrappedField(doc, 'ผู้ที่จะมาถ่ายทอดความรู้ + ประสบการณ์ที่ได้ประชุม/ อบรม มา', att.knowledge_sharer || '', L, R, y, 2, 22);

  y += 10;
  doc.font('Thai').fontSize(16).text('แผนงานโครงการที่ท่านน่าจะนำมาปฏิบัติหลังการประชุม', L, y, { lineBreak: false });
  y += 22;
  drawField(doc, '1.', att.post_action_1 || '', L + 34, R, y);
  y += 22;
  drawField(doc, '2.', att.post_action_2 || '', L + 34, R, y);
  y += 22;
  drawField(doc, '3.', att.post_action_3 || '', L + 34, R, y);

  y += 48;
  drawDottedLine(doc, 290, 460, y + 15.5);
  y += 20;
  doc.font('Thai').fontSize(16).text('(', 282, y, { lineBreak: false });
  drawDottedLine(doc, 288, 462, y + 15.5);
  if (reqName) {
    doc.text(reqName, 290, y - 0.5, { width: 170, align: 'center', lineBreak: false });
  }
  doc.text(')', 466, y, { lineBreak: false });

  y += 22;
  doc.text('.........../......................./...........', 286, y, { width: 180, align: 'center', lineBreak: false });
}

/**
 * Form 4: ประมาณการค่าใช้จ่ายในการเดินทางไปราชการ
 */
function renderEstimatePage(doc, item) {
  const L = 44;
  const R = 552;
  const comps = getCompanions(item);
  const reqName = String(item.requester_name || comps[0]?.full_name || '').trim();
  const reqPos = String(item.requester_position || comps[0]?.position || '').trim();

  let y = 32;
  doc.font('ThaiBold').fontSize(18).text('ประมาณการค่าใช้จ่ายในการเดินทางไปราชการ', 48, y, { align: 'center', width: 500, lineBreak: false });
  y += 22;
  doc.font('Thai').fontSize(16).text('โรงพยาบาลโคกศรีสุพรรณ', L, y, { lineBreak: false });

  y += 22;
  drawField(doc, 'ของ', reqName, L, 340, y);
  drawField(doc, 'กับคณะรวม', `${comps.length || 1}`, 346, R - 24, y, { align: 'center' });
  doc.text('คน', R - 18, y, { lineBreak: false });

  y += 22;
  drawField(doc, 'ไปราชการที่', `${item.destination || ''}${item.province ? ` จ.${item.province}` : ''}`, L, R, y);

  y += 22;
  drawField(doc, 'ระหว่างวันที่', fmtThaiDatePlain(item.start_date), L, 240, y, { align: 'center' });
  drawField(doc, 'ถึงวันที่', fmtThaiDatePlain(item.end_date || item.start_date), 246, 446, y, { align: 'center' });
  drawField(doc, 'รวม', `${item.total_days || 1} วัน`, 452, R, y, { align: 'center' });

  y += 22;
  doc.font('Thai').fontSize(16).text('ค่าใช้จ่ายดังรายการต่อไปนี้', L, y, { lineBreak: false });

  y += 24;
  // Table columns total width = 508 (L=44 to R=552)
  const cols = [
    { key: 'seq', label: 'ที่', w: 24, align: 'center' },
    { key: 'name', label: 'รายชื่อผู้ไปราชการ', w: 142, align: 'left' },
    { key: 'level', label: 'ระดับ', w: 54, align: 'center' },
    { key: 'allow', label: 'เบี้ยเลี้ยง', w: 46, align: 'right' },
    { key: 'hotel', label: 'ที่พัก', w: 44, align: 'right' },
    { key: 'travel', label: 'พาหนะ', w: 44, align: 'right' },
    { key: 'reg', label: 'ลงทะเบียน', w: 48, align: 'right' },
    { key: 'other', label: 'อื่น ๆ', w: 38, align: 'right' },
    { key: 'total', label: 'รวม', w: 44, align: 'right' },
    { key: 'remark', label: 'หมายเหตุ', w: 24, align: 'left' },
  ];
  const headerH = 38;
  const rowH = 22;
  const rowCount = Math.max(12, comps.length);
  const tableH = headerH + (rowCount + 1) * rowH;

  doc.lineWidth(0.7).rect(L, y, R - L, tableH).stroke('#111827');

  // Vertical lines
  let cx = L;
  for (let i = 0; i < cols.length - 1; i++) {
    cx += cols[i].w;
    const isSubFee = i >= 3 && i <= 7;
    doc.moveTo(cx, isSubFee ? y + 18 : y).lineTo(cx, y + tableH).stroke('#111827');
  }
  // Subheader line under "รายการเบิกจ่าย"
  const feeX1 = L + cols[0].w + cols[1].w + cols[2].w;
  const feeX2 = feeX1 + cols[3].w + cols[4].w + cols[5].w + cols[6].w + cols[7].w + cols[8].w;
  doc.moveTo(feeX1, y + 18).lineTo(feeX2, y + 18).stroke('#111827');
  doc.moveTo(L, y + headerH).lineTo(R, y + headerH).stroke('#111827');

  // Header labels
  doc.font('ThaiBold').fontSize(13.5);
  doc.text('ที่', L, y + 10, { width: cols[0].w, align: 'center', lineBreak: false });
  doc.text('รายชื่อผู้ไปราชการ', L + cols[0].w, y + 10, { width: cols[1].w, align: 'center', lineBreak: false });
  doc.text('ระดับ', L + cols[0].w + cols[1].w, y + 10, { width: cols[2].w, align: 'center', lineBreak: false });
  doc.text('รายการเบิกจ่าย', feeX1, y + 1, { width: feeX2 - feeX1, align: 'center', lineBreak: false });
  doc.text('หมายเหตุ', feeX2, y + 10, { width: cols[9].w, align: 'center', lineBreak: false });

  doc.font('ThaiBold').fontSize(12.5);
  let sx = feeX1;
  for (let i = 3; i <= 8; i++) {
    doc.text(cols[i].label, sx, y + 20, { width: cols[i].w, align: 'center', lineBreak: false });
    sx += cols[i].w;
  }

  let sumAllow = 0;
  let sumHotel = 0;
  let sumTravel = 0;
  let sumReg = 0;
  let sumOther = 0;
  let sumAll = 0;

  doc.font('Thai').fontSize(13);
  for (let r = 0; r < rowCount; r++) {
    const ry = y + headerH + r * rowH;
    doc.moveTo(L, ry + rowH).lineTo(R, ry + rowH).stroke('#111827');
    const c = comps[r];
    if (c) {
      const a = Number(c.allowance_fee || 0);
      const h = Number(c.hotel_fee || 0);
      const t = Number(c.travel_fee || 0);
      const rg = Number(c.register_fee || 0);
      const o = Number(c.other_fee || 0);
      const tot = Number(c.total_fee || (a + h + t + rg + o));
      sumAllow += a;
      sumHotel += h;
      sumTravel += t;
      sumReg += rg;
      sumOther += o;
      sumAll += tot;

      const vals = [
        String(r + 1),
        c.full_name || '',
        c.level_name || '',
        fmtMoney(a),
        fmtMoney(h),
        fmtMoney(t),
        fmtMoney(rg),
        fmtMoney(o),
        fmtMoney(tot),
        c.remark || '',
      ];
      let vx = L;
      cols.forEach((col, ci) => {
        if (vals[ci]) {
          doc.text(vals[ci], vx + 3, ry + 3, {
            width: col.w - 6,
            align: col.align,
            lineBreak: false,
          });
        }
        vx += col.w;
      });
    }
  }

  // Fallback if fees are only on item header
  if (sumAll === 0 && Number(item.estimated_cost || 0) > 0) {
    sumAllow = Number(item.allowance_cost || 0);
    sumHotel = Number(item.hotel_cost || 0);
    sumTravel = Number(item.travel_cost || 0);
    sumReg = Number(item.reg_cost || 0);
    sumOther = Number(item.other_cost || 0);
    sumAll = Number(item.estimated_cost || 0);
  }

  // Summary row
  const sumY = y + headerH + rowCount * rowH;
  doc.font('ThaiBold').fontSize(13.5);
  doc.text('รวมเป็นเงินทั้งสิ้น', L + cols[0].w, sumY + 3, { width: cols[1].w, align: 'center', lineBreak: false });
  const sumVals = [fmtMoney(sumAllow), fmtMoney(sumHotel), fmtMoney(sumTravel), fmtMoney(sumReg), fmtMoney(sumOther), fmtMoney(sumAll)];
  let svx = feeX1;
  for (let i = 0; i < sumVals.length; i++) {
    const col = cols[3 + i];
    if (sumVals[i]) {
      doc.text(sumVals[i], svx + 3, sumY + 3, { width: col.w - 6, align: 'right', lineBreak: false });
    }
    svx += col.w;
  }

  // Signature bottom right
  let sy = y + tableH + 26;
  doc.font('Thai').fontSize(16);
  doc.text('ลงชื่อ', 282, sy, { lineBreak: false });
  drawDottedLine(doc, 314, 466, sy + 15.5);
  doc.text('ผู้ขอไปราชการ', 470, sy, { lineBreak: false });
  sy += 22;
  doc.text('(', 296, sy, { lineBreak: false });
  drawDottedLine(doc, 302, 462, sy + 15.5);
  if (reqName) doc.text(reqName, 304, sy - 0.5, { width: 156, align: 'center', lineBreak: false });
  doc.text(')', 466, sy, { lineBreak: false });
  sy += 22;
  drawField(doc, 'ตำแหน่ง', reqPos, 282, 480, sy, { align: 'center' });
}

function generateTravelRequestPdf(item, res, isDownload = false, form = 'memo_in') {
  const doc = setupDoc('A4', 'portrait');
  if (form === 'all') {
    renderMemoInPage(doc, item);
    doc.addPage();
    renderMemoOutPage(doc, item);
    doc.addPage();
    renderAttachmentPage(doc, item);
    doc.addPage();
    renderEstimatePage(doc, item);
  } else if (form === 'memo_out') {
    renderMemoOutPage(doc, item);
  } else if (form === 'attachment') {
    renderAttachmentPage(doc, item);
  } else if (form === 'estimate') {
    renderEstimatePage(doc, item);
  } else {
    renderMemoInPage(doc, item);
  }
  sendPdf(doc, `travel-${form}-${item.row_id || 'doc'}.pdf`, res, isDownload);
}

function generateTravelBoardPdf(items, subtitle, res, isDownload = false) {
  const doc = setupDoc('A4', 'landscape');
  doc.font('ThaiBold').fontSize(20).text('รายงานทะเบียนคำขออนุมัติไปราชการออนไลน์', 40, 28, { align: 'center', width: 760 });
  doc.font('Thai').fontSize(14).text(`โรงพยาบาลโคกศรีสุพรรณ • ${subtitle || ''}`, 40, 52, { align: 'center', width: 760 });
  let y = 84;
  const cols = [
    { label: 'ที่', w: 35, align: 'center' },
    { label: 'เลขที่หนังสือ', w: 90 },
    { label: 'เรื่อง / หลักสูตร', w: 230 },
    { label: 'สถานที่ / จังหวัด', w: 150 },
    { label: 'วันที่เดินทาง', w: 105, align: 'center' },
    { label: 'ผู้ขออนุมัติ', w: 95 },
    { label: 'งบประมาณ', w: 55, align: 'right' },
  ];
  doc.font('ThaiBold').fontSize(13);
  let x = 40;
  cols.forEach((c) => {
    doc.rect(x, y, c.w, 22).stroke('#334155');
    doc.text(c.label, x + 3, y + 3, { width: c.w - 6, align: c.align || 'left', lineBreak: false });
    x += c.w;
  });
  y += 22;
  doc.font('Thai').fontSize(12);
  items.forEach((it, idx) => {
    if (y > 540) {
      doc.addPage();
      y = 40;
    }
    x = 40;
    const vals = [
      String(idx + 1),
      it.doc_no || `#${it.row_id}`,
      it.subject || '',
      `${it.destination || ''} ${it.province || ''}`.trim(),
      `${fmtThaiDatePlain(it.start_date)}`,
      it.requester_name || '',
      fmtMoney(it.estimated_cost) || '0',
    ];
    cols.forEach((c, ci) => {
      doc.rect(x, y, c.w, 20).stroke('#cbd5e1');
      doc.text(vals[ci], x + 3, y + 3, { width: c.w - 6, align: c.align || 'left', lineBreak: false });
      x += c.w;
    });
    y += 20;
  });
  sendPdf(doc, 'travel-board-report.pdf', res, isDownload);
}

function generateReportSectionPdf(title, subtitle, cols, rows, res, isDownload = false) {
  const doc = setupDoc('A4', 'portrait');
  doc.font('ThaiBold').fontSize(19).text(title, 40, 32, { align: 'center', width: 515 });
  doc.font('Thai').fontSize(14).text(`โรงพยาบาลโคกศรีสุพรรณ • ${subtitle || ''}`, 40, 56, { align: 'center', width: 515 });
  let y = 88;
  let x = 40;
  doc.font('ThaiBold').fontSize(13.5);
  cols.forEach((c) => {
    doc.rect(x, y, c.w, 22).stroke('#334155');
    doc.text(c.label, x + 4, y + 3, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
    x += c.w;
  });
  y += 22;
  doc.font('Thai').fontSize(13);
  rows.forEach((r) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    x = 40;
    cols.forEach((c, i) => {
      doc.rect(x, y, c.w, 20).stroke('#cbd5e1');
      doc.text(String(r[i] ?? ''), x + 4, y + 3, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
      x += c.w;
    });
    y += 20;
  });
  sendPdf(doc, 'travel-summary-report.pdf', res, isDownload);
}

module.exports = {
  generateTravelRequestPdf,
  generateTravelBoardPdf,
  generateReportSectionPdf,
};
