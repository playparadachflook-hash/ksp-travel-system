require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { travelPool, hrdPool, md5, ensureDatabaseAndSchema } = require('./src/db');
const { generateTravelRequestPdf, generateTravelBoardPdf, generateReportSectionPdf } = require('./src/pdf');
const { registerMophProviderRoutes } = require('./src/mophAuth');

const app = express();
const PORT = Number(process.env.PORT || 3534);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ksp-travel-system-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

function calcDays(startDate, endDate) {
  if (!startDate || !endDate) return 1;
  const s = new Date(String(startDate).slice(0, 10));
  const e = new Date(String(endDate).slice(0, 10));
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  const diff = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 1;
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

function buildSessionUser(u) {
  const fullName = `${u.prename_name || ''}${String(u.fname || '').trim()} ${String(u.lname || '').trim()}`.trim();
  const grpId = Number(u.user_groups_id || 3);
  return {
    person_id: Number(u.person_id),
    row_id: Number(u.person_id),
    username: u.username,
    fullName,
    position: u.position_name || '',
    telephone: u.phone_number || '',
    unit_id: Number(u.department_id || 0),
    department_id: Number(u.department_id || 0),
    department_name: u.department_name || '',
    user_groups_id: grpId,
    userGroupLabel: u.user_groups_th || (grpId === 1 ? 'ผู้ดูแลระบบ' : (grpId === 2 ? 'ธุรการ (Admin)' : 'ผู้ใช้งานทั่วไป')),
    role: [1, 2].includes(grpId) ? 'admin' : 'user',
    isAdmin: [1, 2].includes(grpId),
  };
}

// ==================== AUTH ====================
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    const u = String(username).trim();
    const pHash = md5(String(password).trim());
    const [rows] = await hrdPool.query(
      `SELECT p.person_id, p.fname, p.lname, p.phone_number, p.username, p.user_groups_id,
              p.department_id, p.position_id, pn.prename_name, pos.position_name, d.department_name,
              ug.user_groups_th
       FROM hrd_person p
       LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
       LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
       LEFT JOIN hrd_department d ON d.department_id = p.department_id
       LEFT JOIN hrd_user_groups ug ON ug.user_groups_id = p.user_groups_id
       WHERE p.username = ? AND (p.password = ? OR p.password = ?)
       LIMIT 1`,
      [u, pHash, String(password).trim()]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    req.session.user = buildSessionUser(rows[0]);
    res.json({ user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'ไม่สามารถเชื่อมต่อฐานข้อมูลบุคลากรได้' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

registerMophProviderRoutes(app, {
  resolveSessionUser: async (profile, opdUser) => {
    const hashCid = String(profile.hash_cid || '').trim().toLowerCase();
    const firstTh = String(profile.firstname_th || '').trim();
    const lastTh = String(profile.lastname_th || '').trim();
    const baseSql = `SELECT p.person_id, p.fname, p.lname, p.phone_number, p.username, p.user_groups_id,
              p.department_id, p.position_id, pn.prename_name, pos.position_name, d.department_name,
              ug.user_groups_th
       FROM hrd_person p
       LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
       LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
       LEFT JOIN hrd_department d ON d.department_id = p.department_id
       LEFT JOIN hrd_user_groups ug ON ug.user_groups_id = p.user_groups_id`;
    let rows = [];
    if (hashCid) {
      [rows] = await hrdPool.query(`${baseSql} WHERE LOWER(SHA2(REPLACE(REPLACE(TRIM(p.cid), '-', ''), ' ', ''), 256)) = ? LIMIT 1`, [hashCid]);
    }
    if (!rows.length && opdUser?.cid) {
      [rows] = await hrdPool.query(`${baseSql} WHERE REPLACE(REPLACE(TRIM(p.cid), '-', ''), ' ', '') = ? LIMIT 1`, [String(opdUser.cid).replace(/[-\s]/g, '')]);
    }
    if (!rows.length && opdUser?.loginname) {
      [rows] = await hrdPool.query(`${baseSql} WHERE LOWER(p.username) = LOWER(?) LIMIT 1`, [opdUser.loginname]);
    }
    if (!rows.length && firstTh && lastTh) {
      [rows] = await hrdPool.query(`${baseSql} WHERE TRIM(p.fname) LIKE ? AND TRIM(p.lname) LIKE ? LIMIT 1`, [`%${firstTh}%`, `%${lastTh}%`]);
    }
    if (!rows.length) return null;
    return buildSessionUser(rows[0]);
  },
});

// ==================== MASTER FROM db_hrd ====================
app.get('/api/master', async (req, res) => {
  try {
    const [[departments], [persons], [travelRates]] = await Promise.all([
      hrdPool.query('SELECT department_id AS row_id, department_id, department_name AS unit_name, department_name FROM hrd_department WHERE department_status = "Y" ORDER BY department_id'),
      hrdPool.query(
        `SELECT p.person_id,
                CONCAT(COALESCE(pn.prename_name,''), TRIM(p.fname), ' ', TRIM(p.lname)) AS full_name,
                p.department_id, p.position_id,
                COALESCE(pos.position_name, '') AS position_name,
                COALESCE(d.department_name, '') AS department_name
         FROM hrd_person p
         LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
         LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
         LEFT JOIN hrd_department d ON d.department_id = p.department_id
         WHERE p.fname IS NOT NULL AND TRIM(p.fname) != ''
         ORDER BY p.fname, p.lname`
      ),
      hrdPool.query('SELECT id, province_id, province_name_th, distance_roundtrip_km, private_car_rate, bus_fare, flight_fare, train_fare FROM hrd_travel_rates ORDER BY province_name_th').catch(() => [[]]),
    ]);
    res.json({ departments, persons, travelRates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/units', async (req, res) => {
  try {
    const [rows] = await hrdPool.query('SELECT department_id AS row_id, department_name AS unit_name FROM hrd_department WHERE department_status = "Y" ORDER BY department_id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATS ====================
app.get('/api/stats', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({
        total: 0, myCount: 0, pending: 0, approved: 0, completed: 0, rejected: 0,
        budgetEstimated: 0, budgetActual: 0, eco: { paper: 0, baht: 0, ghg: 0 },
      });
    }
    const uid = Number(req.session.user.person_id);
    const isAdmin = Boolean(req.session.user.isAdmin);
    const scopeWhere = isAdmin
      ? ''
      : 'WHERE (t.requester_person_id = ? OR EXISTS (SELECT 1 FROM travel_companions tc WHERE tc.travel_id = t.row_id AND tc.person_id = ?))';
    const scopeParams = isAdmin ? [] : [uid, uid];

    const [[agg]] = await travelPool.query(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN t.status = 0 THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN t.status IN (1, 2) THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN t.status = 6 THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN t.status = 9 THEN 1 ELSE 0 END) AS rejected,
             COALESCE(SUM(CASE WHEN t.status != 9 THEN t.estimated_cost ELSE 0 END), 0) AS est,
             COALESCE(SUM(CASE WHEN t.status != 9 THEN t.actual_cost ELSE 0 END), 0) AS act
      FROM travel_requests t
      ${scopeWhere}
    `, scopeParams);
    const [[mine]] = await travelPool.query(
      `SELECT COUNT(DISTINCT t.row_id) AS cnt
       FROM travel_requests t
       LEFT JOIN travel_companions tc ON tc.travel_id = t.row_id
       WHERE t.requester_person_id = ? OR tc.person_id = ?`,
      [uid, uid]
    );
    const [[globalPend]] = await travelPool.query('SELECT COUNT(*) AS cnt FROM travel_requests WHERE status = 0');
    const myCount = Number(mine?.cnt || 0);
    const total = Number(agg?.total || 0);
    res.json({
      total,
      myCount,
      globalPending: Number(globalPend?.cnt || 0),
      pending: Number(agg?.pending || 0),
      approved: Number(agg?.approved || 0),
      completed: Number(agg?.completed || 0),
      rejected: Number(agg?.rejected || 0),
      budgetEstimated: Number(agg?.est || 0),
      budgetActual: Number(agg?.act || 0),
      eco: {
        paper: total * 4,
        baht: Number((total * 1.8).toFixed(2)),
        ghg: Number(((total * 0.8049) / 180).toFixed(3)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== LIST & DETAIL ====================
function buildWhere(query, user) {
  const { month, year, status, travel_type, unit_id, date, q, mine } = query;
  const where = [];
  const params = [];

  if (date) {
    where.push('t.start_date <= ? AND t.end_date >= ?');
    params.push(date, date);
  } else {
    if (year) {
      where.push('YEAR(t.start_date) = ?');
      params.push(Number(year));
    }
    if (month && Number(month) > 0) {
      where.push('MONTH(t.start_date) = ?');
      params.push(Number(month));
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
  if (!user?.isAdmin || mine === '1') {
    where.push('(t.requester_person_id = ? OR EXISTS (SELECT 1 FROM travel_companions tc WHERE tc.travel_id = t.row_id AND tc.person_id = ?))');
    params.push(user.person_id, user.person_id);
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push(`(t.subject LIKE ? OR t.destination LIKE ? OR t.province LIKE ? OR t.requester_name LIKE ? OR t.doc_no LIKE ? OR t.organizer LIKE ?
      OR EXISTS (SELECT 1 FROM travel_companions tc WHERE tc.travel_id = t.row_id AND tc.full_name LIKE ?))`);
    params.push(like, like, like, like, like, like, like);
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

app.get('/api/travels', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({ items: [], total: 0, page: 1, limit: 25, totalPages: 1 });
    }
    const { whereSql, params } = buildWhere(req.query, req.session.user);
    const [[cntRow]] = await travelPool.query(`SELECT COUNT(*) AS cnt FROM travel_requests t ${whereSql}`, params);
    const total = Number(cntRow?.cnt || 0);
    const pageNum = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.limit) || 25));
    const offset = (pageNum - 1) * pageSize;
    const uid = req.session.user ? Number(req.session.user.person_id) : 0;

    const [items] = await travelPool.query(
      `SELECT t.*,
              COALESCE(NULLIF(t.request_dept, ''), '-') AS unit_name,
              (SELECT COUNT(*) FROM travel_companions tc WHERE tc.travel_id = t.row_id) AS traveler_count,
              (SELECT GROUP_CONCAT(tc.full_name ORDER BY tc.seq_no SEPARATOR ', ') FROM travel_companions tc WHERE tc.travel_id = t.row_id) AS travelers,
              CASE WHEN ? > 0 AND EXISTS (SELECT 1 FROM travel_companions tc2 WHERE tc2.travel_id = t.row_id AND tc2.person_id = ?) THEN 1 ELSE 0 END AS is_companion,
              CASE WHEN ti.id IS NOT NULL THEN 1 ELSE 0 END AS has_image
       FROM travel_requests t
       LEFT JOIN travel_images ti ON ti.travel_id = t.row_id
       ${whereSql}
       ORDER BY t.start_date DESC, t.row_id DESC
       LIMIT ? OFFSET ?`,
      [uid, uid, ...params, pageSize, offset]
    );

    res.json({
      items,
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getFullTravel(id) {
  const [rows] = await travelPool.query('SELECT * FROM travel_requests WHERE row_id = ? LIMIT 1', [Number(id)]);
  if (!rows.length) return null;
  const item = rows[0];
  const [companions] = await travelPool.query('SELECT * FROM travel_companions WHERE travel_id = ? ORDER BY seq_no ASC', [item.row_id]);
  const [atts] = await travelPool.query('SELECT * FROM travel_attachments WHERE travel_id = ? LIMIT 1', [item.row_id]);
  const [imgs] = await travelPool.query('SELECT mime_type, file_name, image_data FROM travel_images WHERE travel_id = ? LIMIT 1', [item.row_id]);
  item.companions = companions;
  item.attachment = atts[0] || {};
  item.image_data = imgs[0]?.image_data || '';
  item.image_name = imgs[0]?.file_name || '';
  return item;
}

app.get('/api/travels/board/pdf', requireAdmin, async (req, res) => {
  try {
    const { whereSql, params } = buildWhere(req.query, req.session.user);
    const [items] = await travelPool.query(
      `SELECT t.* FROM travel_requests t ${whereSql} ORDER BY t.start_date DESC, t.row_id DESC LIMIT 200`,
      params
    );
    const parts = [];
    if (req.query.year) parts.push(`ปี พ.ศ. ${Number(req.query.year) + 543}`);
    if (req.query.month && Number(req.query.month) > 0) parts.push(`เดือน ${req.query.month}`);
    parts.push(`จำนวน ${items.length} รายการ`);
    generateTravelBoardPdf(items, parts.join(' | '), res, req.query.download === '1');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/travels/:id/pdf', requireAuth, async (req, res) => {
  try {
    const item = await getFullTravel(req.params.id);
    if (!item) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });
    const uid = Number(req.session.user.person_id);
    const isOwner = Number(item.requester_person_id) === uid;
    const isComp = (item.companions || []).some((c) => Number(c.person_id) === uid);
    if (!req.session.user.isAdmin && !isOwner && !isComp) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงเอกสารของผู้อื่น' });
    }
    const form = String(req.query.form || 'memo_in');
    generateTravelRequestPdf(item, res, req.query.download === '1', form);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/travels/:id/image', requireAuth, async (req, res) => {
  try {
    const item = await getFullTravel(req.params.id);
    if (!item) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });
    const uid = Number(req.session.user.person_id);
    const isOwner = Number(item.requester_person_id) === uid;
    const isComp = (item.companions || []).some((c) => Number(c.person_id) === uid);
    if (!req.session.user.isAdmin && !isOwner && !isComp) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูรูปภาพของผู้อื่น' });
    }
    const [rows] = await travelPool.query(
      `SELECT ti.travel_id, ti.mime_type, ti.file_name, ti.image_data, t.subject
       FROM travel_images ti
       JOIN travel_requests t ON t.row_id = ti.travel_id
       WHERE ti.travel_id = ? LIMIT 1`,
      [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรูปภาพประกอบ' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/travels/:id', requireAuth, async (req, res) => {
  try {
    const item = await getFullTravel(req.params.id);
    if (!item) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });
    const uid = Number(req.session.user.person_id);
    const isOwner = Number(item.requester_person_id) === uid;
    const isComp = (item.companions || []).some((c) => Number(c.person_id) === uid);
    if (!req.session.user.isAdmin && !isOwner && !isComp) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูข้อมูลของผู้อื่น' });
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SYNC TO db_hrd ====================
async function syncTravelToHrd(travelId, b, user) {
  try {
    const item = await getFullTravel(travelId);
    if (!item) return;
    const allowId = item.status === 1 || item.status === 2 || item.status === 6 ? 2 : (item.status === 9 ? 3 : 1);
    const comps = (item.companions || []).map((c) => ({
      person_id: c.person_id || null,
      name: c.full_name,
      position: c.position || '',
    }));

    let hrdId = item.hrd_train_data_id;
    if (hrdId) {
      await hrdPool.query(
        `UPDATE hrd_train_data SET
          train_topic = ?, train_org = ?, train_place = ?, province_id = ?,
          train_startdate = ?, train_enddate = ?, train_sum_day = ?,
          train_order = ?, train_travel = ?, train_distance_km = ?,
          train_pay_register = ?, train_pay_apartment = ?, train_pay_allowance = ?,
          train_pay_travel = ?, train_pay_other = ?, allow_id = ?
         WHERE train_data_id = ?`,
        [
          item.subject, item.organizer || '', item.destination || '', item.province_id || null,
          item.start_date, item.end_date, item.total_days || 1,
          item.doc_no || '', item.transport_type || '', Number(item.distance_km || 0),
          Number(item.reg_cost || 0), Number(item.hotel_cost || 0), Number(item.allowance_cost || 0),
          Number(item.travel_cost || 0), Number(item.other_cost || 0), allowId,
          hrdId,
        ]
      );
    } else {
      const [ins] = await hrdPool.query(
        `INSERT INTO hrd_train_data (
          train_topic, train_org, train_place, province_id, train_startdate, train_enddate, train_sum_day,
          train_order, train_travel, train_distance_km,
          train_pay_register, train_pay_apartment, train_pay_allowance, train_pay_travel, train_pay_other,
          allow_id, person_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.subject, item.organizer || '', item.destination || '', item.province_id || null,
          item.start_date, item.end_date, item.total_days || 1,
          item.doc_no || '', item.transport_type || '', Number(item.distance_km || 0),
          Number(item.reg_cost || 0), Number(item.hotel_cost || 0), Number(item.allowance_cost || 0),
          Number(item.travel_cost || 0), Number(item.other_cost || 0), allowId,
          Number(item.requester_person_id || user?.person_id || 0),
        ]
      );
      hrdId = ins.insertId;
      await travelPool.query('UPDATE travel_requests SET hrd_train_data_id = ? WHERE row_id = ?', [hrdId, travelId]);
    }

    await hrdPool.query(
      `INSERT INTO hrd_train_memo (
        train_data_id, memo_date, request_dept, companions_json, org_budget_text, hospital_budget,
        director_name, director_pos1, director_pos2
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        memo_date = VALUES(memo_date), request_dept = VALUES(request_dept),
        companions_json = VALUES(companions_json), org_budget_text = VALUES(org_budget_text),
        hospital_budget = VALUES(hospital_budget), director_name = VALUES(director_name),
        director_pos1 = VALUES(director_pos1), director_pos2 = VALUES(director_pos2)`,
      [
        hrdId, item.memo_date || item.start_date, item.request_dept || '',
        JSON.stringify(comps), item.org_budget_text || '', Number(item.estimated_cost || 0),
        item.director_name || '', item.director_pos1 || '', item.director_pos2 || '',
      ]
    );

    await hrdPool.query('DELETE FROM hrd_train_companions WHERE train_data_id = ?', [hrdId]);
    for (let i = 0; i < comps.length; i++) {
      if (comps[i].person_id) {
        await hrdPool.query(
          `INSERT IGNORE INTO hrd_train_companions (train_data_id, person_id, seq_no, companion_name, companion_position)
           VALUES (?, ?, ?, ?, ?)`,
          [hrdId, Number(comps[i].person_id), i + 1, comps[i].name, comps[i].position]
        );
      }
    }
  } catch (err) {
    console.warn('syncTravelToHrd skipped:', err.message);
  }
}

async function saveTravelDetails(travelId, b) {
  const comps = Array.isArray(b.companions) ? b.companions : [];
  await travelPool.query('DELETE FROM travel_companions WHERE travel_id = ?', [travelId]);
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i] || {};
    const name = String(c.full_name || c.name || '').trim();
    if (!name) continue;
    const allow = Number(c.allowance_fee || 0);
    const hotel = Number(c.hotel_fee || 0);
    const trv = Number(c.travel_fee || 0);
    const reg = Number(c.register_fee || 0);
    const oth = Number(c.other_fee || 0);
    const tot = allow + hotel + trv + reg + oth;
    await travelPool.query(
      `INSERT INTO travel_companions (
        travel_id, seq_no, person_id, full_name, position, level_name,
        allowance_fee, hotel_fee, travel_fee, register_fee, other_fee, total_fee, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        travelId, i + 1, c.person_id ? Number(c.person_id) : null, name,
        String(c.position || '').trim(), String(c.level_name || '').trim(),
        allow, hotel, trv, reg, oth, tot, String(c.remark || '').trim(),
      ]
    );
  }

  const att = b.attachment || {};
  await travelPool.query(
    `INSERT INTO travel_attachments (
      travel_id, history_status, necessity_reason, delegate_person_id, delegate_name,
      expected_benefit, knowledge_sharer, post_action_1, post_action_2, post_action_3
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      history_status = VALUES(history_status),
      necessity_reason = VALUES(necessity_reason),
      delegate_person_id = VALUES(delegate_person_id),
      delegate_name = VALUES(delegate_name),
      expected_benefit = VALUES(expected_benefit),
      knowledge_sharer = VALUES(knowledge_sharer),
      post_action_1 = VALUES(post_action_1),
      post_action_2 = VALUES(post_action_2),
      post_action_3 = VALUES(post_action_3)`,
    [
      travelId,
      ['ever', 'never', 'others_ever'].includes(att.history_status) ? att.history_status : 'never',
      String(att.necessity_reason || '').trim(),
      att.delegate_person_id ? Number(att.delegate_person_id) : null,
      String(att.delegate_name || '').trim(),
      String(att.expected_benefit || '').trim(),
      String(att.knowledge_sharer || '').trim(),
      String(att.post_action_1 || '').trim(),
      String(att.post_action_2 || '').trim(),
      String(att.post_action_3 || '').trim(),
    ]
  );

  if (b.image_data === '__REMOVE__') {
    await travelPool.query('DELETE FROM travel_images WHERE travel_id = ?', [travelId]);
  } else if (typeof b.image_data === 'string' && b.image_data.startsWith('data:image/')) {
    const m = b.image_data.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
    if (m) {
      await travelPool.query(
        `INSERT INTO travel_images (travel_id, mime_type, file_name, image_data)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), file_name = VALUES(file_name), image_data = VALUES(image_data)`,
        [travelId, m[1], String(b.image_name || ''), b.image_data]
      );
    }
  }
}

app.post('/api/travels', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.subject || !b.destination || !b.start_date) {
      return res.status(400).json({ error: 'กรุณากรอกเรื่อง สถานที่ และวันที่ไปราชการ' });
    }
    const startDate = String(b.start_date).slice(0, 10);
    const endDate = String(b.end_date || startDate).slice(0, 10);
    const totalDays = Number(b.total_days || calcDays(startDate, endDate));
    const reg = Number(b.reg_cost || 0);
    const hotel = Number(b.hotel_cost || 0);
    const allow = Number(b.allowance_cost || 0);
    const trv = Number(b.travel_cost || 0);
    const oth = Number(b.other_cost || 0);
    const est = Number(b.estimated_cost || (reg + hotel + allow + trv + oth));

    const [ins] = await travelPool.query(
      `INSERT INTO travel_requests (
        doc_no, memo_scope, memo_date, subject, travel_type, organizer,
        destination, province_id, province, distance_km, start_date, end_date, total_days,
        transport_type, budget_source, org_budget_text,
        reg_cost, hotel_cost, allowance_cost, travel_cost, other_cost, estimated_cost,
        unit_id, request_dept, requester_person_id, requester_name, requester_position, requester_tel,
        head_name, head_position, director_name, director_pos1, director_pos2, status, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(b.doc_no || '').trim(),
        b.memo_scope === 'out_province' ? 'out_province' : 'in_province',
        b.memo_date ? String(b.memo_date).slice(0, 10) : startDate,
        b.subject.trim(),
        b.travel_type || 'อบรม/ประชุมวิชาการ',
        String(b.organizer || '').trim(),
        b.destination.trim(),
        b.province_id ? Number(b.province_id) : null,
        String(b.province || 'สกลนคร').trim(),
        Number(b.distance_km || 0),
        startDate,
        endDate,
        totalDays,
        b.transport_type || 'รถโรงพยาบาล',
        b.budget_source || 'เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ',
        String(b.org_budget_text || '').trim(),
        reg, hotel, allow, trv, oth, est,
        Number(b.unit_id || req.session.user.department_id || 0),
        String(b.request_dept || req.session.user.department_name || '').trim(),
        req.session.user.person_id,
        String(b.requester_name || req.session.user.fullName).trim(),
        String(b.requester_position || req.session.user.position || '').trim(),
        String(b.requester_tel || req.session.user.telephone || '').trim(),
        String(b.head_name || '').trim(),
        String(b.head_position || '').trim(),
        String(b.director_name || 'นางณัฐปภัสร์ นวัตชัยศิริกุล').trim(),
        String(b.director_pos1 || 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง').trim(),
        String(b.director_pos2 || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ').trim(),
        req.session.user.isAdmin && b.status !== undefined ? Number(b.status) : 0,
        String(b.memo || '').trim(),
      ]
    );

    const travelId = ins.insertId;
    await saveTravelDetails(travelId, b);
    await syncTravelToHrd(travelId, b, req.session.user);
    res.status(201).json({ row_id: travelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/travels/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getFullTravel(id);
    if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอไปราชการ' });

    const uid = Number(req.session.user.person_id);
    const isOwner = Number(existing.requester_person_id) === uid;
    const isComp = (existing.companions || []).some((c) => Number(c.person_id) === uid);
    if (!req.session.user.isAdmin && !isOwner && !isComp) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขคำขอนี้' });
    }

    const b = req.body;
    const startDate = String(b.start_date || existing.start_date).slice(0, 10);
    const endDate = String(b.end_date || existing.end_date).slice(0, 10);
    const totalDays = Number(b.total_days || calcDays(startDate, endDate));
    const reg = Number(b.reg_cost ?? existing.reg_cost);
    const hotel = Number(b.hotel_cost ?? existing.hotel_cost);
    const allow = Number(b.allowance_cost ?? existing.allowance_cost);
    const trv = Number(b.travel_cost ?? existing.travel_cost);
    const oth = Number(b.other_cost ?? existing.other_cost);
    const est = Number(b.estimated_cost ?? (reg + hotel + allow + trv + oth));

    await travelPool.query(
      `UPDATE travel_requests SET
        doc_no = ?, memo_scope = ?, memo_date = ?, subject = ?, travel_type = ?, organizer = ?,
        destination = ?, province_id = ?, province = ?, distance_km = ?, start_date = ?, end_date = ?, total_days = ?,
        transport_type = ?, budget_source = ?, org_budget_text = ?,
        reg_cost = ?, hotel_cost = ?, allowance_cost = ?, travel_cost = ?, other_cost = ?, estimated_cost = ?,
        request_dept = ?, requester_name = ?, requester_position = ?, requester_tel = ?,
        head_name = ?, head_position = ?, director_name = ?, director_pos1 = ?, director_pos2 = ?, memo = ?
       WHERE row_id = ?`,
      [
        b.doc_no ?? existing.doc_no,
        b.memo_scope === 'out_province' ? 'out_province' : (b.memo_scope === 'in_province' ? 'in_province' : existing.memo_scope),
        b.memo_date ? String(b.memo_date).slice(0, 10) : existing.memo_date,
        b.subject ?? existing.subject,
        b.travel_type ?? existing.travel_type,
        b.organizer ?? existing.organizer,
        b.destination ?? existing.destination,
        b.province_id ? Number(b.province_id) : existing.province_id,
        b.province ?? existing.province,
        Number(b.distance_km ?? existing.distance_km),
        startDate,
        endDate,
        totalDays,
        b.transport_type ?? existing.transport_type,
        b.budget_source ?? existing.budget_source,
        b.org_budget_text ?? existing.org_budget_text,
        reg, hotel, allow, trv, oth, est,
        b.request_dept ?? existing.request_dept,
        b.requester_name ?? existing.requester_name,
        b.requester_position ?? existing.requester_position,
        b.requester_tel ?? existing.requester_tel,
        b.head_name ?? existing.head_name,
        b.head_position ?? existing.head_position,
        b.director_name ?? existing.director_name,
        b.director_pos1 ?? existing.director_pos1,
        b.director_pos2 ?? existing.director_pos2,
        b.memo ?? existing.memo,
        id,
      ]
    );

    await saveTravelDetails(id, b);
    await syncTravelToHrd(id, b, req.session.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/travels/:id/approve', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, assigned_to, approval_note, actual_cost } = req.body;
    await travelPool.query(
      `UPDATE travel_requests SET
        status = ?, assigned_to = ?, approval_note = ?, actual_cost = ?,
        approver_name = ?, approved_at = NOW()
       WHERE row_id = ?`,
      [
        Number(status ?? 1),
        String(assigned_to || '').trim(),
        String(approval_note || '').trim(),
        Number(actual_cost || 0),
        req.session.user.fullName,
        id,
      ]
    );
    await syncTravelToHrd(id, {}, req.session.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/travels/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await travelPool.query('SELECT hrd_train_data_id FROM travel_requests WHERE row_id = ? LIMIT 1', [id]);
    const hrdId = rows[0]?.hrd_train_data_id;
    await travelPool.query('DELETE FROM travel_requests WHERE row_id = ?', [id]);
    if (hrdId) {
      await hrdPool.query('DELETE FROM hrd_train_companions WHERE train_data_id = ?', [hrdId]).catch(() => {});
      await hrdPool.query('DELETE FROM hrd_train_memo WHERE train_data_id = ?', [hrdId]).catch(() => {});
      await hrdPool.query('DELETE FROM hrd_train_data WHERE train_data_id = ?', [hrdId]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== REPORTS ====================
async function getReportData(query) {
  const { fiscalYear, month, year } = query;
  const where = [];
  const params = [];
  let desc = 'ข้อมูลทั้งหมด';
  if (fiscalYear) {
    const fy = Number(fiscalYear);
    const ce = fy > 2400 ? fy - 543 : fy;
    where.push('t.start_date BETWEEN ? AND ?');
    params.push(`${ce - 1}-10-01`, `${ce}-09-30`);
    desc = `ปีงบประมาณ พ.ศ. ${ce + 543}`;
  } else if (year) {
    where.push('YEAR(t.start_date) = ?');
    params.push(Number(year));
    if (month && Number(month) > 0) {
      where.push('MONTH(t.start_date) = ?');
      params.push(Number(month));
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [byDepartment] = await travelPool.query(
    `SELECT COALESCE(NULLIF(t.request_dept, ''), 'ไม่ระบุหน่วยงาน') AS name,
            COUNT(*) AS total, COALESCE(SUM(t.estimated_cost), 0) AS est_cost, COALESCE(SUM(t.actual_cost), 0) AS act_cost
     FROM travel_requests t ${whereSql} GROUP BY name ORDER BY total DESC`,
    params
  );
  const [byType] = await travelPool.query(
    `SELECT COALESCE(NULLIF(t.travel_type, ''), 'ไม่ระบุ') AS name,
            COUNT(*) AS total, COALESCE(SUM(t.estimated_cost), 0) AS est_cost
     FROM travel_requests t ${whereSql} GROUP BY name ORDER BY total DESC`,
    params
  );
  const [byTransport] = await travelPool.query(
    `SELECT COALESCE(NULLIF(t.transport_type, ''), 'ไม่ระบุ') AS name, COUNT(*) AS total
     FROM travel_requests t ${whereSql} GROUP BY name ORDER BY total DESC`,
    params
  );
  const [byStatus] = await travelPool.query(
    `SELECT t.status, COUNT(*) AS total FROM travel_requests t ${whereSql} GROUP BY t.status`,
    params
  );
  return { filterDesc: desc, byDepartment, byType, byTransport, byStatus };
}

app.get('/api/reports/summary', async (req, res) => {
  try {
    res.json(await getReportData(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/pdf', requireAdmin, async (req, res) => {
  try {
    const data = await getReportData(req.query);
    const cols = [
      { label: 'ลำดับ', w: 45, align: 'center' },
      { label: 'หน่วยงาน', w: 260 },
      { label: 'จำนวน (ครั้ง)', w: 90, align: 'center' },
      { label: 'งบประมาณการ (บ.)', w: 120, align: 'right' },
    ];
    const rows = data.byDepartment.map((d, i) => [i + 1, d.name, d.total, Number(d.est_cost).toLocaleString()]);
    generateReportSectionPdf('รายงานสรุปการไปราชการตามหน่วยงาน', data.filterDesc, cols, rows, res, req.query.download === '1');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN: PERSONS & TRAVEL RATES (db_hrd) ====================
app.get('/api/persons', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const deptId = req.query.department_id ? Number(req.query.department_id) : 0;
    const grpId = req.query.user_groups_id ? Number(req.query.user_groups_id) : 0;
    const where = ["COALESCE(TRIM(p.fname), '') != ''"];
    const params = [];
    if (q) {
      where.push('(p.fname LIKE ? OR p.lname LIKE ? OR p.username LIKE ? OR CAST(p.person_id AS CHAR) = ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
    }
    if (deptId) {
      where.push('p.department_id = ?');
      params.push(deptId);
    }
    if (grpId) {
      where.push('p.user_groups_id = ?');
      params.push(grpId);
    }
    const [rows] = await hrdPool.query(
      `SELECT p.person_id, p.username, p.user_groups_id, p.phone_number,
              CONCAT(COALESCE(pn.prename_name,''), TRIM(p.fname), ' ', TRIM(p.lname)) AS full_name,
              pos.position_name, d.department_name, ug.user_groups_th
       FROM hrd_person p
       LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
       LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
       LEFT JOIN hrd_department d ON d.department_id = p.department_id
       LEFT JOIN hrd_user_groups ug ON ug.user_groups_id = p.user_groups_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.fname, p.lname
       LIMIT 500`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/persons/:id', requireAdmin, async (req, res) => {
  try {
    const grpId = Number(req.body.user_groups_id || 3);
    await hrdPool.query('UPDATE hrd_person SET user_groups_id = ? WHERE person_id = ?', [
      [1, 2, 3].includes(grpId) ? grpId : 3,
      Number(req.params.id),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/travel-rates', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE province_name_th LIKE ?' : '';
    const params = q ? [`%${q}%`] : [];
    const [rows] = await hrdPool.query(
      `SELECT id, province_id, province_name_th, distance_roundtrip_km, private_car_rate, bus_fare, flight_fare, train_fare
       FROM hrd_travel_rates ${where} ORDER BY province_name_th`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/travel-rates/:id', requireAdmin, async (req, res) => {
  try {
    const { distance_roundtrip_km, private_car_rate, bus_fare, flight_fare, train_fare } = req.body;
    await hrdPool.query(
      `UPDATE hrd_travel_rates
       SET distance_roundtrip_km = ?, private_car_rate = ?, bus_fare = ?, flight_fare = ?, train_fare = ?
       WHERE id = ?`,
      [
        Number(distance_roundtrip_km || 0),
        Number(private_car_rate ?? 4),
        Number(bus_fare || 0),
        Number(flight_fare || 0),
        Number(train_fare || 0),
        Number(req.params.id),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDatabaseAndSchema()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`KSP Travel System running at http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Startup DB error:', err);
    process.exit(1);
  });
