const crypto = require('crypto');
const mysql = require('mysql2/promise');

function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

const travelPool = mysql.createPool({
  host: process.env.TRAVEL_DB_HOST || '192.168.2.254',
  port: Number(process.env.TRAVEL_DB_PORT || 3306),
  user: process.env.TRAVEL_DB_USER || 'opd',
  password: process.env.TRAVEL_DB_PASSWORD || 'opd',
  database: process.env.TRAVEL_DB_NAME || 'ksp_travel',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,
});

travelPool.pool.on('connection', (conn) => {
  conn.query('SET NAMES utf8mb4');
});

const hrdPool = mysql.createPool({
  host: process.env.HRD_DB_HOST || '192.168.2.30',
  port: Number(process.env.HRD_DB_PORT || 3306),
  user: process.env.HRD_DB_USER || 'opd',
  password: process.env.HRD_DB_PASSWORD || 'opd',
  database: process.env.HRD_DB_NAME || 'db_hrd',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,
});

hrdPool.pool.on('connection', (conn) => {
  conn.query('SET NAMES utf8mb4');
});

async function ensureDatabaseAndSchema() {
  const adminConn = await mysql.createConnection({
    host: process.env.TRAVEL_DB_HOST || '192.168.2.254',
    port: Number(process.env.TRAVEL_DB_PORT || 3306),
    user: process.env.TRAVEL_DB_USER || 'opd',
    password: process.env.TRAVEL_DB_PASSWORD || 'opd',
    charset: 'utf8mb4',
  });
  await adminConn.query('SET NAMES utf8mb4');
  const dbName = process.env.TRAVEL_DB_NAME || 'ksp_travel';
  await adminConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConn.end();

  await travelPool.query(`
    CREATE TABLE IF NOT EXISTS travel_requests (
      row_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      hrd_train_data_id INT NULL UNIQUE,
      doc_no VARCHAR(80) DEFAULT '',
      memo_scope ENUM('in_province','out_province') NOT NULL DEFAULT 'in_province',
      memo_date DATE NULL,
      subject VARCHAR(500) NOT NULL,
      travel_type VARCHAR(100) DEFAULT 'ประชุม/สัมมนา',
      organizer VARCHAR(255) DEFAULT '',
      destination VARCHAR(255) NOT NULL,
      province_id INT NULL,
      province VARCHAR(100) DEFAULT 'สกลนคร',
      distance_km DECIMAL(10,2) DEFAULT 0,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      total_days DECIMAL(6,1) DEFAULT 1,
      start_time VARCHAR(10) DEFAULT '08:30',
      end_time VARCHAR(10) DEFAULT '16:30',
      transport_type VARCHAR(100) DEFAULT 'รถโรงพยาบาล',
      budget_source VARCHAR(255) DEFAULT 'เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ',
      org_budget_text VARCHAR(255) DEFAULT '',
      reg_cost DECIMAL(10,2) DEFAULT 0,
      hotel_cost DECIMAL(10,2) DEFAULT 0,
      allowance_cost DECIMAL(10,2) DEFAULT 0,
      travel_cost DECIMAL(10,2) DEFAULT 0,
      other_cost DECIMAL(10,2) DEFAULT 0,
      estimated_cost DECIMAL(10,2) DEFAULT 0,
      actual_cost DECIMAL(10,2) DEFAULT 0,
      unit_id INT DEFAULT 0,
      request_dept VARCHAR(255) DEFAULT '',
      requester_person_id INT DEFAULT 0,
      requester_name VARCHAR(200) NOT NULL,
      requester_position VARCHAR(200) DEFAULT '',
      requester_tel VARCHAR(50) DEFAULT '',
      head_name VARCHAR(200) DEFAULT '',
      head_position VARCHAR(200) DEFAULT '',
      director_name VARCHAR(200) DEFAULT 'นางณัฐปภัสร์ นวัตชัยศิริกุล',
      director_pos1 VARCHAR(255) DEFAULT 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง',
      director_pos2 VARCHAR(255) DEFAULT 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ',
      director_order_ref VARCHAR(255) DEFAULT 'ปฏิบัติราชการแทน ผู้ว่าราชการจังหวัดสกลนคร ตามคำสั่งจังหวัดสกลนคร ที่ ๔๐๐๘/๒๕๖๘ ลงวันที่ ๒๒ ธันวาคม พ.ศ. ๒๕๖๘',
      status INT NOT NULL DEFAULT 0,
      approver_name VARCHAR(200) DEFAULT '',
      assigned_to VARCHAR(200) DEFAULT '',
      approval_note TEXT NULL,
      memo TEXT NULL,
      approved_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_trv_start (start_date),
      INDEX idx_trv_status (status),
      INDEX idx_trv_person (requester_person_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await travelPool.query(`
    CREATE TABLE IF NOT EXISTS travel_companions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      travel_id BIGINT NOT NULL,
      seq_no INT NOT NULL DEFAULT 1,
      person_id INT NULL,
      full_name VARCHAR(200) NOT NULL,
      position VARCHAR(200) DEFAULT '',
      level_name VARCHAR(100) DEFAULT '',
      allowance_fee DECIMAL(10,2) DEFAULT 0,
      hotel_fee DECIMAL(10,2) DEFAULT 0,
      travel_fee DECIMAL(10,2) DEFAULT 0,
      register_fee DECIMAL(10,2) DEFAULT 0,
      other_fee DECIMAL(10,2) DEFAULT 0,
      total_fee DECIMAL(10,2) DEFAULT 0,
      remark VARCHAR(255) DEFAULT '',
      INDEX idx_tc_travel (travel_id),
      INDEX idx_tc_person (person_id),
      CONSTRAINT fk_tc_travel FOREIGN KEY (travel_id) REFERENCES travel_requests (row_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await travelPool.query(`
    CREATE TABLE IF NOT EXISTS travel_attachments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      travel_id BIGINT NOT NULL UNIQUE,
      history_status ENUM('ever','never','others_ever') NOT NULL DEFAULT 'never',
      necessity_reason TEXT NULL,
      delegate_person_id INT NULL,
      delegate_name VARCHAR(255) DEFAULT '',
      expected_benefit TEXT NULL,
      knowledge_sharer VARCHAR(255) DEFAULT '',
      post_action_1 VARCHAR(255) DEFAULT '',
      post_action_2 VARCHAR(255) DEFAULT '',
      post_action_3 VARCHAR(255) DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_ta_travel FOREIGN KEY (travel_id) REFERENCES travel_requests (row_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await travelPool.query(`
    CREATE TABLE IF NOT EXISTS travel_images (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      travel_id BIGINT NOT NULL UNIQUE,
      mime_type VARCHAR(50) DEFAULT 'image/jpeg',
      file_name VARCHAR(255) DEFAULT '',
      image_data MEDIUMTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_ti_travel FOREIGN KEY (travel_id) REFERENCES travel_requests (row_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await syncFromHrd();
}

async function syncFromHrd() {
  try {
    const [hrdRows] = await hrdPool.query(`
      SELECT t.train_data_id, t.train_topic, t.train_org, t.train_place, t.province_id,
             t.train_startdate, t.train_enddate, t.train_sum_day, t.train_order,
             t.train_travel, t.train_distance_km,
             t.train_pay_register, t.train_pay_apartment, t.train_pay_allowance, t.train_pay_travel, t.train_pay_other,
             t.person_id, t.allow_id,
             tt.train_type_name, tb.train_budget_name,
             tr.province_name_th,
             m.memo_date, m.request_dept, m.companions_json, m.org_budget_text, m.hospital_budget,
             m.director_name, m.director_pos1, m.director_pos2,
             CONCAT(COALESCE(pn.prename_name,''), TRIM(p.fname), ' ', TRIM(p.lname)) AS requester_name,
             COALESCE(pos.position_name, '') AS requester_position,
             COALESCE(p.phone_number, '') AS requester_tel,
             COALESCE(p.department_id, 0) AS department_id,
             COALESCE(d.department_name, '') AS department_name
      FROM hrd_train_data t
      LEFT JOIN hrd_train_type tt ON tt.train_type_id = t.train_type_id
      LEFT JOIN hrd_train_budget tb ON tb.train_budget_id = t.train_budget_id
      LEFT JOIN hrd_travel_rates tr ON tr.province_id = t.province_id
      LEFT JOIN hrd_train_memo m ON m.train_data_id = t.train_data_id
      LEFT JOIN hrd_person p ON p.person_id = t.person_id
      LEFT JOIN hrd_prename pn ON pn.prename_id = p.prename_id
      LEFT JOIN hrd_position pos ON pos.position_id = p.position_id
      LEFT JOIN hrd_department d ON d.department_id = p.department_id
      WHERE t.train_startdate IS NOT NULL
      ORDER BY t.train_data_id DESC
      LIMIT 500
    `);

    if (!hrdRows.length) return;
    const [existing] = await travelPool.query('SELECT hrd_train_data_id FROM travel_requests WHERE hrd_train_data_id IS NOT NULL');
    const existingSet = new Set(existing.map((r) => Number(r.hrd_train_data_id)));

    for (const r of hrdRows) {
      if (existingSet.has(Number(r.train_data_id))) continue;
      const startIso = String(r.train_startdate).slice(0, 10);
      const endIso = String(r.train_enddate || r.train_startdate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || startIso.startsWith('0000')) continue;
      const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(endIso) && !endIso.startsWith('0000') ? endIso : startIso;
      const memoDate = r.memo_date && !String(r.memo_date).startsWith('0000') ? String(r.memo_date).slice(0, 10) : startIso;

      const reg = Number(r.train_pay_register || 0);
      const hotel = Number(r.train_pay_apartment || 0);
      const allow = Number(r.train_pay_allowance || 0);
      const trv = Number(r.train_pay_travel || 0);
      const oth = Number(r.train_pay_other || 0);
      const total = reg + hotel + allow + trv + oth;
      const prov = (r.province_name_th || 'สกลนคร').trim();
      const scope = prov && prov !== 'สกลนคร' ? 'out_province' : 'in_province';
      const status = Number(r.allow_id) === 2 ? 1 : (Number(r.allow_id) === 3 ? 9 : 0);

      const [ins] = await travelPool.query(
        `INSERT INTO travel_requests (
          hrd_train_data_id, doc_no, memo_scope, memo_date, subject, travel_type, organizer,
          destination, province_id, province, distance_km, start_date, end_date, total_days,
          transport_type, budget_source, org_budget_text, reg_cost, hotel_cost, allowance_cost,
          travel_cost, other_cost, estimated_cost, unit_id, request_dept,
          requester_person_id, requester_name, requester_position, requester_tel,
          director_name, director_pos1, director_pos2, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.train_data_id,
          r.train_order || '',
          scope,
          memoDate,
          r.train_topic || 'ไปราชการ/อบรม',
          r.train_type_name || 'อบรม/ประชุมวิชาการ',
          r.train_org || '',
          r.train_place || '-',
          r.province_id || null,
          prov,
          Number(r.train_distance_km || 0),
          startIso,
          validEnd,
          Number(r.train_sum_day || 1),
          r.train_travel || 'รถโรงพยาบาล',
          r.train_budget_name || 'เงินบำรุงโรงพยาบาลโคกศรีสุพรรณ',
          r.org_budget_text || '',
          reg,
          hotel,
          allow,
          trv,
          oth,
          total,
          Number(r.department_id || 0),
          r.request_dept || r.department_name || '',
          Number(r.person_id || 0),
          (r.requester_name || '').trim() || 'บุคลากร',
          r.requester_position || '',
          r.requester_tel || '',
          r.director_name || 'นางณัฐปภัสร์ นวัตชัยศิริกุล',
          r.director_pos1 || 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง',
          r.director_pos2 || 'ผู้อำนวยการโรงพยาบาลโคกศรีสุพรรณ',
          status,
        ]
      );

      const travelId = ins.insertId;
      let comps = [];
      if (r.companions_json) {
        try {
          const parsed = JSON.parse(r.companions_json);
          if (Array.isArray(parsed)) comps = parsed;
        } catch {}
      }
      if (!comps.length && r.requester_name) {
        comps = [{ person_id: r.person_id || null, name: r.requester_name.trim(), position: r.requester_position || '' }];
      }
      for (let i = 0; i < comps.length; i++) {
        const c = comps[i] || {};
        if (!c.name) continue;
        await travelPool.query(
          `INSERT INTO travel_companions (
            travel_id, seq_no, person_id, full_name, position,
            allowance_fee, hotel_fee, travel_fee, register_fee, other_fee, total_fee
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            travelId,
            i + 1,
            c.person_id ? Number(c.person_id) : null,
            String(c.name).trim(),
            String(c.position || '').trim(),
            i === 0 ? allow : 0,
            i === 0 ? hotel : 0,
            i === 0 ? trv : 0,
            i === 0 ? reg : 0,
            i === 0 ? oth : 0,
            i === 0 ? total : 0,
          ]
        );
      }
    }

    // Sync any images from db_hrd.hrd_train_images
    const [hrdImgs] = await hrdPool.query(
      'SELECT train_data_id, mime_type, file_name, image_data FROM hrd_train_images'
    ).catch(() => [[]]);
    if (hrdImgs.length) {
      const [trRows] = await travelPool.query('SELECT row_id, hrd_train_data_id FROM travel_requests WHERE hrd_train_data_id IS NOT NULL');
      const mapHrdToTr = new Map(trRows.map((x) => [Number(x.hrd_train_data_id), Number(x.row_id)]));
      for (const img of hrdImgs) {
        const tid = mapHrdToTr.get(Number(img.train_data_id));
        if (tid) {
          await travelPool.query(
            `INSERT IGNORE INTO travel_images (travel_id, mime_type, file_name, image_data) VALUES (?, ?, ?, ?)`,
            [tid, img.mime_type || 'image/jpeg', img.file_name || '', img.image_data]
          );
        }
      }
    }
  } catch (err) {
    console.warn('syncFromHrd skipped:', err.message);
  }
}

module.exports = {
  travelPool,
  hrdPool,
  md5,
  ensureDatabaseAndSchema,
  syncFromHrd,
};
