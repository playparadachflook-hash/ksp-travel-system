require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./src/db');
const { generateTravelRequestPdf, generateTravelBoardPdf, generateReportSectionPdf } = require('./src/pdf');

const app = express();
const PORT = Number(process.env.PORT || 3534);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ksp-travel-system-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

function nowSql() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function generateDocNo(rowId) {
  const thaiYear = new Date().getFullYear() + 543;
  return `TRV-${thaiYear}-${String(rowId).padStart(4, '0')}`;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ error: 'เฉพาะผู้อนุมัติ / ผู้ดูแลระบบเท่านั้น' });
  }
  next();
}

// ==================== AUTH ====================
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
  }
  const user = db
    .prepare('SELECT row_id, full_name, position, telephone, unit_id, role, username FROM users WHERE username = ? AND password = ?')
    .get(String(username).trim(), String(password).trim());

  if (!user) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }

  req.session.user = {
    row_id: user.row_id,
    username: user.username,
    fullName: user.full_name,
    position: user.position || '',
    telephone: user.telephone || '',
    unit_id: user.unit_id || 0,
    role: user.role || 'user',
    isAdmin: user.role === 'admin',
  };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ==================== STATS ====================
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM travel_requests').get().cnt;
  const rows = db.prepare('SELECT status, COUNT(*) AS cnt FROM travel_requests GROUP BY status').all();
  const counts = { 0: 0, 1: 0, 2: 0, 6: 0, 9: 0 };
  for (const r of rows) counts[r.status] = r.cnt;

  const budgetRow = db.prepare('SELECT COALESCE(SUM(estimated_cost), 0) AS est, COALESCE(SUM(actual_cost), 0) AS act FROM travel_requests WHERE status != 9').get();

  res.json({
    total,
    pending: counts[0] || 0,
    approved: (counts[1] || 0) + (counts[2] || 0),
    completed: counts[6] || 0,
    rejected: counts[9] || 0,
    budgetEstimated: budgetRow.est,
    budgetActual: budgetRow.act,
    eco: {
      paper: total,
      baht: Number((total * 0.45).toFixed(2)),
      ghg: Number(((total * 0.8049) / 180).toFixed(3)),
    },
  });
});

// ==================== TRAVEL REQUESTS ====================
function buildWhere(query, user) {
  const { month, year, status, travel_type, unit_id, date, q, mine } = query;
  const where = [];
  const params = [];

  if (date) {
    where.push('t.start_date <= ? AND t.end_date >= ?');
    params.push(date, date);
  } else {
    if (year) {
      where.push("strftime('%Y', t.start_date) = ?");
      params.push(String(year));
    }
    if (month && Number(month) > 0) {
      where.push("strftime('%m', t.start_date) = ?");
      params.push(String(month).padStart(2, '0'));
    }
  }
  if (status !== undefined && status !== '') {
    where.push('t.status = ?');
    params.push(Number(status));
  }
  if (travel_type) {
    where.push('t.travel_type = ?');
    params.push(travel_type);
  }
  if (unit_id) {
    where.push('t.unit_id = ?');
    params.push(Number(unit_id));
  }
  if (mine === '1' && user) {
    where.push('(t.user_id = ? OR t.requester_name = ?)');
    params.push(user.row_id, user.fullName);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(t.subject LIKE ? OR t.destination LIKE ? OR t.province LIKE ? OR t.requester_name LIKE ? OR t.doc_no LIKE ? OR t.travelers LIKE ?)');
    params.push(like, like, like, like, like, like);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

app.get('/api/travels', (req, res) => {
  const { whereSql, params } = buildWhere(req.query, req.session.user);
  const totalRow = db.prepare(`SELECT COUNT(*) AS cnt FROM travel_requests t ${whereSql}`).get(...params);

  const pageNum = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const items = db
    .prepare(
      `SELECT t.*, u.unit_name
       FROM travel_requests t
       LEFT JOIN units u ON u.row_id = t.unit_id
       ${whereSql}
       ORDER BY t.start_date DESC, t.row_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  res.json({
    items,
    total: totalRow.cnt,
    page: pageNum,
    limit: pageSize,
    totalPages: Math.ceil(totalRow.cnt / pageSize) || 1,
  });
});

app.get('/api/travels/board/pdf', requireAdmin, (req, res) => {
  const { whereSql, params } = buildWhere(req.query, req.session.user);
  const items = db
    .prepare(
      `SELECT t.*, u.unit_name
       FROM travel_requests t
       LEFT JOIN units u ON u.row_id = t.unit_id
       ${whereSql}
       ORDER BY t.start_date DESC, t.row_id DESC
       LIMIT 200`
    )
    .all(...params);

  const parts = [];
  if (req.query.year) parts.push(`ปี พ.ศ. ${Number(req.query.year) + 543}`);
  if (req.query.month && Number(req.query.month) > 0) parts.push(`เดือน ${req.query.month}`);
  parts.push(`จำนวน ${items.length} รายการ`);
  generateTravelBoardPdf(items, parts.join(' | '), res, req.query.download === '1');
});

app.get('/api/travels/:id/pdf', requireAdmin, (req, res) => {
  const item = db
    .prepare(
      `SELECT t.*, u.unit_name
       FROM travel_requests t
       LEFT JOIN units u ON u.row_id = t.unit_id
       WHERE t.row_id = ?`
    )
    .get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });
  generateTravelRequestPdf(item, res, req.query.download === '1');
});

app.get('/api/travels/:id', (req, res) => {
  const item = db
    .prepare(
      `SELECT t.*, u.unit_name
       FROM travel_requests t
       LEFT JOIN units u ON u.row_id = t.unit_id
       WHERE t.row_id = ?`
    )
    .get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });
  res.json(item);
});

app.post('/api/travels', requireAuth, (req, res) => {
  const b = req.body;
  if (!b.subject || !b.destination || !b.start_date) {
    return res.status(400).json({ error: 'กรุณากรอกเรื่อง สถานที่ และวันที่ไปราชการ' });
  }
  const now = nowSql();
  const unitId = b.unit_custom ? 0 : Number(b.unit_id || 0);

  const info = db
    .prepare(
      `INSERT INTO travel_requests (
        subject, travel_type, destination, province, start_date, end_date,
        start_time, end_time, travelers, traveler_count, transport_type,
        budget_source, estimated_cost, unit_id, unit_custom,
        requester_name, requester_position, requester_tel, user_id,
        status, memo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.subject.trim(),
      b.travel_type || 'ประชุม/สัมมนา',
      b.destination.trim(),
      (b.province || 'สกลนคร').trim(),
      b.start_date,
      b.end_date || b.start_date,
      b.start_time || '08:30',
      b.end_time || '16:30',
      (b.travelers || '').trim(),
      Number(b.traveler_count || 1),
      b.transport_type || 'รถโรงพยาบาล',
      b.budget_source || 'งบโรงพยาบาล',
      Number(b.estimated_cost || 0),
      unitId,
      (b.unit_custom || '').trim(),
      (b.requester_name || req.session.user.fullName).trim(),
      (b.requester_position || req.session.user.position || '').trim(),
      (b.requester_tel || req.session.user.telephone || '').trim(),
      req.session.user.row_id,
      req.session.user.isAdmin && b.status !== undefined ? Number(b.status) : 0,
      (b.memo || '').trim(),
      now,
      now
    );

  const docNo = generateDocNo(info.lastInsertRowid);
  db.prepare('UPDATE travel_requests SET doc_no = ? WHERE row_id = ?').run(docNo, info.lastInsertRowid);
  res.status(201).json({ row_id: info.lastInsertRowid, doc_no: docNo });
});

app.put('/api/travels/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM travel_requests WHERE row_id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });

  const isOwner = existing.user_id === req.session.user.row_id || existing.requester_name === req.session.user.fullName;
  if (!req.session.user.isAdmin && !isOwner) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขคำขอนี้' });
  }

  const b = req.body;
  const now = nowSql();
  const unitId = b.unit_custom ? 0 : Number(b.unit_id ?? existing.unit_id);

  db.prepare(
    `UPDATE travel_requests SET
      subject = ?, travel_type = ?, destination = ?, province = ?,
      start_date = ?, end_date = ?, start_time = ?, end_time = ?,
      travelers = ?, traveler_count = ?, transport_type = ?,
      budget_source = ?, estimated_cost = ?, actual_cost = ?,
      unit_id = ?, unit_custom = ?, requester_name = ?, requester_position = ?, requester_tel = ?,
      memo = ?, status = ?, updated_at = ?
    WHERE row_id = ?`
  ).run(
    b.subject ?? existing.subject,
    b.travel_type ?? existing.travel_type,
    b.destination ?? existing.destination,
    b.province ?? existing.province,
    b.start_date ?? existing.start_date,
    b.end_date ?? existing.end_date,
    b.start_time ?? existing.start_time,
    b.end_time ?? existing.end_time,
    b.travelers ?? existing.travelers,
    Number(b.traveler_count ?? existing.traveler_count),
    b.transport_type ?? existing.transport_type,
    b.budget_source ?? existing.budget_source,
    Number(b.estimated_cost ?? existing.estimated_cost),
    req.session.user.isAdmin ? Number(b.actual_cost ?? existing.actual_cost) : existing.actual_cost,
    unitId,
    b.unit_custom !== undefined ? b.unit_custom : existing.unit_custom,
    b.requester_name ?? existing.requester_name,
    b.requester_position ?? existing.requester_position,
    b.requester_tel ?? existing.requester_tel,
    b.memo ?? existing.memo,
    req.session.user.isAdmin ? Number(b.status ?? existing.status) : existing.status,
    now,
    id
  );
  res.json({ ok: true });
});

app.patch('/api/travels/:id/approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM travel_requests WHERE row_id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });

  const now = nowSql();
  const { status, assigned_to, approval_note, actual_cost } = req.body;

  db.prepare(
    `UPDATE travel_requests SET
      status = ?, assigned_to = ?, approval_note = ?, actual_cost = ?,
      approver_name = ?, approved_at = ?, updated_at = ?
    WHERE row_id = ?`
  ).run(
    Number(status ?? existing.status),
    (assigned_to ?? existing.assigned_to ?? '').trim(),
    approval_note !== undefined ? approval_note : existing.approval_note,
    actual_cost !== undefined ? Number(actual_cost) : existing.actual_cost,
    req.session.user.fullName,
    now,
    now,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/travels/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM travel_requests WHERE row_id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ==================== REPORTS ====================
function buildReportFilter(query, col = 't.start_date') {
  const { date, year, month, fiscalYear } = query;
  const where = [];
  const params = [];
  const desc = [];

  if (date) {
    where.push(`(t.start_date <= ? AND t.end_date >= ?)`);
    params.push(date, date);
    desc.push(`วันที่ ${date}`);
  } else if (fiscalYear) {
    const fy = Number(fiscalYear);
    const ce = fy > 2400 ? fy - 543 : fy;
    const start = `${ce - 1}-10-01`;
    const end = `${ce}-09-30`;
    where.push(`${col} >= ? AND ${col} <= ?`);
    params.push(start, end);
    desc.push(`ปีงบประมาณ ${ce + 543} (${start} ถึง ${end})`);
  } else {
    if (year) {
      where.push(`strftime('%Y', ${col}) = ?`);
      params.push(String(year));
      desc.push(`ปี พ.ศ. ${Number(year) + 543}`);
    }
    if (month && Number(month) > 0) {
      where.push(`strftime('%m', ${col}) = ?`);
      params.push(String(month).padStart(2, '0'));
      desc.push(`เดือน ${month}`);
    }
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    filterDesc: desc.join(' | ') || 'ข้อมูลทั้งหมด',
  };
}

function getTravelReportData(query) {
  const { whereSql, params, filterDesc } = buildReportFilter(query);

  const byDepartment = db
    .prepare(
      `SELECT COALESCE(NULLIF(u.unit_name, ''), NULLIF(t.unit_custom, ''), 'ไม่ระบุหน่วยงาน') AS name,
              COUNT(*) AS total,
              COALESCE(SUM(t.estimated_cost), 0) AS est_cost,
              COALESCE(SUM(t.actual_cost), 0) AS act_cost
       FROM travel_requests t
       LEFT JOIN units u ON u.row_id = t.unit_id
       ${whereSql}
       GROUP BY name
       ORDER BY total DESC`
    )
    .all(...params);

  const byType = db
    .prepare(
      `SELECT travel_type AS name, COUNT(*) AS total, COALESCE(SUM(estimated_cost), 0) AS est_cost
       FROM travel_requests t
       ${whereSql}
       GROUP BY travel_type
       ORDER BY total DESC`
    )
    .all(...params);

  const byTransport = db
    .prepare(
      `SELECT transport_type AS name, COUNT(*) AS total
       FROM travel_requests t
       ${whereSql}
       GROUP BY transport_type
       ORDER BY total DESC`
    )
    .all(...params);

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS total FROM travel_requests t ${whereSql} GROUP BY status`)
    .all(...params);

  return { filterDesc, byDepartment, byType, byTransport, byStatus };
}

app.get('/api/reports/summary', (req, res) => {
  res.json(getTravelReportData(req.query));
});

app.get('/api/reports/pdf', requireAdmin, (req, res) => {
  const { section = 'department', download } = req.query;
  const data = getTravelReportData(req.query);
  const isDl = download === '1';

  if (section === 'department') {
    const cols = [
      { label: 'ลำดับ', w: 40, align: 'center' },
      { label: 'หน่วยงาน', w: 220 },
      { label: 'จำนวน (ครั้ง)', w: 75, align: 'center' },
      { label: 'งบประมาณการ (บ.)', w: 94, align: 'right' },
      { label: 'งบใช้จริง (บ.)', w: 94, align: 'right' },
    ];
    const rows = data.byDepartment.map((d, i) => [i + 1, d.name, d.total, Number(d.est_cost).toLocaleString(), Number(d.act_cost).toLocaleString()]);
    return generateReportSectionPdf('รายงานสรุปการไปราชการตามหน่วยงาน', data.filterDesc, cols, rows, res, isDl);
  }
  if (section === 'type') {
    const cols = [
      { label: 'ลำดับ', w: 42, align: 'center' },
      { label: 'ประเภทการไปราชการ', w: 270 },
      { label: 'จำนวน (ครั้ง)', w: 95, align: 'center' },
      { label: 'งบประมาณการ (บ.)', w: 116, align: 'right' },
    ];
    const rows = data.byType.map((t, i) => [i + 1, t.name, t.total, Number(t.est_cost).toLocaleString()]);
    return generateReportSectionPdf('รายงานสรุปตามประเภทการไปราชการ', data.filterDesc, cols, rows, res, isDl);
  }
  if (section === 'transport') {
    const cols = [
      { label: 'ลำดับ', w: 45, align: 'center' },
      { label: 'พาหนะเดินทาง', w: 350 },
      { label: 'จำนวน (ครั้ง)', w: 128, align: 'center' },
    ];
    const rows = data.byTransport.map((t, i) => [i + 1, t.name, t.total]);
    return generateReportSectionPdf('รายงานสรุปตามพาหนะเดินทาง', data.filterDesc, cols, rows, res, isDl);
  }
  const STATUS_NAMES = { 0: 'รออนุมัติ', 1: 'อนุมัติแล้ว', 2: 'อยู่ระหว่างเดินทาง', 6: 'เสร็จสิ้นภารกิจ', 9: 'ไม่อนุมัติ / ยกเลิก' };
  const cols = [
    { label: 'สถานะ', w: 350 },
    { label: 'จำนวน (ครั้ง)', w: 173, align: 'center' },
  ];
  const rows = data.byStatus.map((s) => [STATUS_NAMES[s.status] || s.status, s.total]);
  return generateReportSectionPdf('รายงานสรุปตามสถานะการไปราชการ', data.filterDesc, cols, rows, res, isDl);
});

// ==================== UNITS & USERS ====================
app.get('/api/units', (req, res) => {
  res.json(db.prepare('SELECT * FROM units ORDER BY unit_name ASC').all());
});

app.post('/api/units', requireAdmin, (req, res) => {
  const { unit_code, unit_name, unit_head, tel } = req.body;
  if (!unit_name || !unit_name.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อหน่วยงาน' });
  const info = db.prepare('INSERT INTO units (unit_code, unit_name, unit_head, tel) VALUES (?, ?, ?, ?)').run(unit_code || '', unit_name.trim(), unit_head || '', tel || '');
  res.status(201).json({ row_id: info.lastInsertRowid });
});

app.put('/api/units/:id', requireAdmin, (req, res) => {
  const { unit_code, unit_name, unit_head, tel } = req.body;
  if (!unit_name || !unit_name.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อหน่วยงาน' });
  db.prepare('UPDATE units SET unit_code = ?, unit_name = ?, unit_head = ?, tel = ? WHERE row_id = ?').run(unit_code || '', unit_name.trim(), unit_head || '', tel || '', Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/units/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM units WHERE row_id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/users', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.row_id, p.full_name, p.position, p.telephone, p.unit_id, p.role, p.username, u.unit_name
       FROM users p
       LEFT JOIN units u ON u.row_id = p.unit_id
       ORDER BY p.row_id DESC`
    )
    .all();
  res.json(rows);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { full_name, position, telephone, unit_id, role, username, password } = req.body;
  if (!full_name || !username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อ Username และ Password' });
  try {
    const info = db
      .prepare('INSERT INTO users (full_name, position, telephone, unit_id, role, username, password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(full_name.trim(), position || '', telephone || '', Number(unit_id || 0), role === 'admin' ? 'admin' : 'user', username.trim(), password.trim(), nowSql());
    res.status(201).json({ row_id: info.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Username นี้มีอยู่ในระบบแล้ว' });
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE row_id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });
  const { full_name, position, telephone, unit_id, role, username, password } = req.body;
  db.prepare('UPDATE users SET full_name = ?, position = ?, telephone = ?, unit_id = ?, role = ?, username = ?, password = ? WHERE row_id = ?').run(
    full_name ?? existing.full_name,
    position ?? existing.position,
    telephone ?? existing.telephone,
    Number(unit_id ?? existing.unit_id),
    role === 'admin' ? 'admin' : 'user',
    username ?? existing.username,
    password ? password : existing.password,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE row_id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KSP Travel System running at http://0.0.0.0:${PORT}`);
});
