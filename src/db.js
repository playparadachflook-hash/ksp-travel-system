const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'travel.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_code TEXT DEFAULT '',
      unit_name TEXT NOT NULL,
      unit_head TEXT DEFAULT '',
      tel TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      position TEXT DEFAULT '',
      telephone TEXT DEFAULT '',
      unit_id INTEGER DEFAULT 0,
      role TEXT DEFAULT 'user',
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS travel_requests (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_no TEXT DEFAULT '',
      subject TEXT NOT NULL,
      travel_type TEXT DEFAULT 'ประชุม/สัมมนา',
      destination TEXT NOT NULL,
      province TEXT DEFAULT 'สกลนคร',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT DEFAULT '08:30',
      end_time TEXT DEFAULT '16:30',
      travelers TEXT DEFAULT '',
      traveler_count INTEGER DEFAULT 1,
      transport_type TEXT DEFAULT 'รถโรงพยาบาล',
      budget_source TEXT DEFAULT 'งบโรงพยาบาล',
      estimated_cost REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      unit_id INTEGER DEFAULT 0,
      unit_custom TEXT DEFAULT '',
      requester_name TEXT NOT NULL,
      requester_position TEXT DEFAULT '',
      requester_tel TEXT DEFAULT '',
      user_id INTEGER DEFAULT 0,
      status INTEGER DEFAULT 0,
      approver_name TEXT DEFAULT '',
      assigned_to TEXT DEFAULT '',
      approval_note TEXT DEFAULT '',
      memo TEXT DEFAULT '',
      approved_at TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_travel_start_date ON travel_requests(start_date);
    CREATE INDEX IF NOT EXISTS idx_travel_status ON travel_requests(status);
    CREATE INDEX IF NOT EXISTS idx_travel_unit ON travel_requests(unit_id);
  `);
}

function seedDefaultsIfEmpty() {
  const unitCount = db.prepare('SELECT COUNT(*) AS cnt FROM units').get().cnt;
  if (unitCount === 0) {
    const insUnit = db.prepare('INSERT INTO units (unit_code, unit_name, unit_head, tel) VALUES (?, ?, ?, ?)');
    const defaultUnits = [
      ['01', 'ฝ่ายบริหารทั่วไป', 'หัวหน้าฝ่ายบริหารทั่วไป', '201'],
      ['02', 'กลุ่มงานการพยาบาล', 'หัวหน้าพยาบาล', '202'],
      ['03', 'กลุ่มงานเวชปฏิบัติครอบครัวและชุมชน', 'หัวหน้ากลุ่มงาน', '203'],
      ['04', 'กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค', 'หัวหน้ากลุ่มงานเภสัชกรรม', '241'],
      ['05', 'กลุ่มงานเทคนิคการแพทย์', 'หัวหน้าห้องปฏิบัติการ', '205'],
      ['06', 'งานเทคโนโลยีสารสนเทศ (IT)', 'หัวหน้างานไอที', '211'],
      ['07', 'งานอุบัติเหตุและฉุกเฉิน (ER)', 'หัวหน้างาน ER', '207'],
      ['08', 'งานผู้ป่วยนอก (OPD)', 'หัวหน้างาน OPD', '208'],
      ['09', 'งานผู้ป่วยใน (IPD)', 'หัวหน้างาน IPD', '209'],
      ['10', 'กลุ่มงานทันตกรรม', 'หัวหน้ากลุ่มงานทันตกรรม', '210'],
    ];
    for (const u of defaultUnits) insUnit.run(...u);
  }

  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  if (userCount === 0) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const insUser = db.prepare(
      'INSERT INTO users (full_name, position, telephone, unit_id, role, username, password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insUser.run('ผู้อำนวยการ / ผู้ดูแลระบบ', 'ผู้อำนวยการโรงพยาบาล', '201', 1, 'admin', 'admin', 'admin', now);
    insUser.run('เจ้าหน้าที่ทดสอบ ระบบไปราชการ', 'นักวิชาการคอมพิวเตอร์', '211', 6, 'user', 'user', 'user', now);
  }

  const reqCount = db.prepare('SELECT COUNT(*) AS cnt FROM travel_requests').get().cnt;
  if (reqCount === 0) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const today = new Date().toISOString().slice(0, 10);
    const insReq = db.prepare(`
      INSERT INTO travel_requests (
        doc_no, subject, travel_type, destination, province, start_date, end_date,
        start_time, end_time, travelers, traveler_count, transport_type, budget_source,
        estimated_cost, unit_id, requester_name, requester_position, requester_tel,
        user_id, status, approver_name, assigned_to, approval_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insReq.run(
      'TRV-2569-001',
      'ประชุมเชิงปฏิบัติการพัฒนาระบบบริการสุขภาพดิจิทัล เขตสุขภาพที่ 8',
      'ประชุม/สัมมนา',
      'สำนักงานสาธารณสุขจังหวัดสกลนคร',
      'สกลนคร',
      today,
      today,
      '08:30',
      '16:30',
      '1. นายสมชาย ใจดี\n2. นางสาววิภา สุขสันต์',
      2,
      'รถโรงพยาบาล',
      'งบโรงพยาบาล',
      1200,
      6,
      'เจ้าหน้าที่ทดสอบ ระบบไปราชการ',
      'นักวิชาการคอมพิวเตอร์',
      '211',
      2,
      1,
      'ผู้อำนวยการ / ผู้ดูแลระบบ',
      'พขร. วันชัย วงศ์เครือศร',
      'อนุมัติให้ใช้รถตู้โรงพยาบาล',
      now,
      now
    );
    insReq.run(
      'TRV-2569-002',
      'อบรมเชิงปฏิบัติการมาตรฐานความปลอดภัยสารสนเทศโรงพยาบาล (HA-IT)',
      'อบรม/ศึกษาดูงาน',
      'โรงแรมพูลแมน ขอนแก่น ราชา ออคิด',
      'ขอนแก่น',
      today,
      today,
      '07:30',
      '17:00',
      '1. นางสาวสุภาพร รักดี',
      1,
      'รถยนต์ส่วนตัว',
      'งบโรงพยาบาล',
      3500,
      1,
      'เจ้าหน้าที่ทดสอบ ระบบไปราชการ',
      'นักจัดการงานทั่วไป',
      '201',
      2,
      0,
      '',
      '',
      '',
      now,
      now
    );
  }
}

initSchema();
seedDefaultsIfEmpty();

module.exports = db;
