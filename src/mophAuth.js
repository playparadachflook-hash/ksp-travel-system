const mysql = require('mysql2/promise');

const HOSPCODE = process.env.MOPH_HOSPCODE || '11101';
const HEALTH_ID_CLIENT_ID = process.env.HEALTH_ID_CLIENT_ID || '01a0faf5-2888-758a-a1c3-d885143cf2e4';
const HEALTH_ID_CLIENT_SECRET = process.env.HEALTH_ID_CLIENT_SECRET || 'a92c05aeec078f4cd9da04d34dd3e5ebe1ea0942';
const PROVIDER_CLIENT_ID = process.env.PROVIDER_CLIENT_ID || '68fdef16-2121-451b-952c-07a9aaf4d1f0';
const PROVIDER_SECRET = process.env.PROVIDER_SECRET || '6bFJzxrV1SnBwEwphUK9vcAPXiWFlzX8';

let hosxpPool = null;
function getHosxpPool() {
  if (!hosxpPool) {
    hosxpPool = mysql.createPool({
      host: process.env.HOSXP_HOST || '192.168.2.254',
      port: Number(process.env.HOSXP_PORT || 3306),
      user: process.env.HOSXP_USER || 'opd',
      password: process.env.HOSXP_PASSWORD || 'opd',
      database: process.env.HOSXP_DB || 'hos',
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
    });
  }
  return hosxpPool;
}

function getCallbackUrl(req) {
  if (process.env.PROVIDER_CALLBACK_URL) return process.env.PROVIDER_CALLBACK_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host')).split(',')[0].trim();
  return `${proto}://${host}/api/auth/provider/callback`;
}

function renderHtmlMessage(title, message, isError = false) {
  const accent = isError ? '#dc2626' : '#0d9488';
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>
    body { font-family: 'Sarabun', 'Segoe UI', sans-serif; background: #f1f5f9; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 16px; max-width: 460px; width: 100%; padding: 32px 28px; box-shadow: 0 18px 45px rgba(15,23,42,0.12); text-align: center; }
    h2 { margin: 0 0 10px; color: ${accent}; font-size: 20px; }
    p { margin: 0 0 22px; color: #475569; font-size: 14.5px; line-height: 1.6; }
    a.btn { display: inline-block; padding: 11px 24px; border-radius: 10px; background: #0f766e; color: #fff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${esc(title)}</h2>
    <p>${esc(message)}</p>
    <a class="btn" href="/">กลับหน้าหลัก</a>
  </div>
</body>
</html>`;
}

async function matchHosxpOpdUser(profile) {
  const hashCid = String(profile.hash_cid || '').trim().toLowerCase();
  const firstNameTh = String(profile.firstname_th || '').trim();
  const lastNameTh = String(profile.lastname_th || '').trim();
  const nameTh = String(profile.name_th || `${firstNameTh} ${lastNameTh}`).trim();
  const orgList = Array.isArray(profile.organization) ? profile.organization : [];
  const primaryOrg = orgList.find((o) => String(o.hcode) === HOSPCODE) || orgList[0] || {};
  const licenseId = String(profile.license_id || primaryOrg.license_id || '').trim();

  const pool = getHosxpPool();

  // 1. Primary: Match hash_cid against opduser (and doctor fallback)
  if (hashCid) {
    const [rows] = await pool.query(
      `SELECT * FROM opduser
       WHERE LOWER(SHA2(REPLACE(REPLACE(TRIM(cid), '-', ''), ' ', ''), 256)) = ?
         AND (account_disable IS NULL OR account_disable != 'Y')
       LIMIT 1`,
      [hashCid]
    );
    if (rows.length) return rows[0];

    const [docCidRows] = await pool.query(
      `SELECT u.*
       FROM opduser u
       JOIN doctor d ON u.doctorcode = d.code
       WHERE LOWER(SHA2(REPLACE(REPLACE(TRIM(d.cid), '-', ''), ' ', ''), 256)) = ?
         AND (u.account_disable IS NULL OR u.account_disable != 'Y')
       LIMIT 1`,
      [hashCid]
    );
    if (docCidRows.length) return docCidRows[0];
  }

  // 2. Fallback: Match by license_id
  if (licenseId) {
    const cleanLic = licenseId.replace(/^ว\.?\s*/, '');
    const [licRows] = await pool.query(
      `SELECT u.*
       FROM opduser u
       JOIN doctor d ON u.doctorcode = d.code
       WHERE (d.licenseno = ? OR REPLACE(d.licenseno, 'ว.', '') = ?)
         AND (u.account_disable IS NULL OR u.account_disable != 'Y')
       LIMIT 1`,
      [licenseId, cleanLic]
    );
    if (licRows.length) return licRows[0];
  }

  // 3. Fallback: Match by name_th / firstname_th + lastname_th
  if (firstNameTh && lastNameTh) {
    const [nameRows] = await pool.query(
      `SELECT * FROM opduser
       WHERE name LIKE ? AND name LIKE ?
         AND (account_disable IS NULL OR account_disable != 'Y')
       LIMIT 1`,
      [`%${firstNameTh}%`, `%${lastNameTh}%`]
    );
    if (nameRows.length) return nameRows[0];
  } else if (nameTh) {
    const [nameRows] = await pool.query(
      `SELECT * FROM opduser
       WHERE name LIKE ?
         AND (account_disable IS NULL OR account_disable != 'Y')
       LIMIT 1`,
      [`%${nameTh}%`]
    );
    if (nameRows.length) return nameRows[0];
  }

  return null;
}

function registerMophProviderRoutes(app, { resolveSessionUser }) {
  // Step 1: Redirect to Health ID OAuth
  app.get('/api/auth/provider', (req, res) => {
    const callbackUrl = getCallbackUrl(req);
    const params = new URLSearchParams({
      client_id: HEALTH_ID_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: 'code',
    });
    res.redirect(`https://moph.id.th/oauth/redirect?${params.toString()}`);
  });

  // Step 2-4: Callback -> Exchange Health ID Token -> Exchange Provider Token -> Profile -> Match opduser -> Session
  app.get('/api/auth/provider/callback', async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      const code = req.query.code;
      if (!code) {
        return res.status(400).send(renderHtmlMessage('เข้าสู่ระบบไม่สำเร็จ', 'ไม่พบรหัสยืนยันตัวตน (code) จาก MOPH Health ID', true));
      }

      const browserUA = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      const callbackUrl = getCallbackUrl(req);

      // Step 2: Exchange Health ID Token
      const tokenBody = new URLSearchParams({
        client_id: HEALTH_ID_CLIENT_ID,
        client_secret: HEALTH_ID_CLIENT_SECRET,
        code: String(code),
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      });
      const healthRes = await fetch('https://moph.id.th/api/v1/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': browserUA,
        },
        body: tokenBody.toString(),
      });
      const healthData = await healthRes.json();
      const healthAccessToken = healthData?.data?.access_token || healthData?.access_token;
      if (!healthAccessToken) {
        return res.status(401).send(
          renderHtmlMessage('เข้าสู่ระบบ Health ID ไม่สำเร็จ', healthData?.message || healthData?.error_description || 'ไม่สามารถรับ Access Token จาก Health ID ได้', true)
        );
      }

      // Step 3: Exchange Provider ID Token
      const providerRes = await fetch('https://provider.id.th/api/v1/services/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': browserUA,
        },
        body: JSON.stringify({
          client_id: PROVIDER_CLIENT_ID,
          secret_key: PROVIDER_SECRET,
          token_by: 'Health ID',
          token: healthAccessToken,
        }),
      });
      const providerData = await providerRes.json();
      const providerAccessToken = providerData?.data?.access_token || providerData?.access_token;
      if (!providerAccessToken) {
        return res.status(401).send(
          renderHtmlMessage('เข้าสู่ระบบ Provider ID ไม่สำเร็จ', providerData?.message || 'ไม่สามารถรับ Access Token จาก Provider ID ได้', true)
        );
      }

      // Step 4: Get Provider Profile
      const profileRes = await fetch('https://provider.id.th/api/v1/services/profile', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${providerAccessToken}`,
          'client-id': PROVIDER_CLIENT_ID,
          'secret-key': PROVIDER_SECRET,
          'User-Agent': browserUA,
        },
      });
      const profileJson = await profileRes.json();
      const profile = profileJson?.data || profileJson;
      if (!profile || (!profile.hash_cid && !profile.name_th && !profile.firstname_th)) {
        return res.status(401).send(renderHtmlMessage('ไม่พบข้อมูลบุคลากร', 'ไม่สามารถอ่านข้อมูลโปรไฟล์จาก Provider ID ได้', true));
      }

      // Step 5: Match HOSxP opduser
      const opdUser = await matchHosxpOpdUser(profile);
      if (!opdUser) {
        const displayName = profile.name_th || `${profile.firstname_th || ''} ${profile.lastname_th || ''}`.trim() || 'ผู้ใช้';
        return res.status(403).send(
          renderHtmlMessage(
            'ไม่พบบัญชีผู้ใช้ใน HOSxP',
            `ไม่พบข้อมูลของ "${displayName}" ในตาราง opduser (กรุณาตรวจสอบเลขบัตรประชาชน 13 หลักใน HOSxP)`,
            true
          )
        );
      }

      // Step 6: Map to local application session
      const sessionUser = await resolveSessionUser(profile, opdUser);
      if (!sessionUser) {
        return res.status(403).send(
          renderHtmlMessage('ไม่พบบัญชีในระบบ', `พบบัญชี HOSxP (${opdUser.loginname}) แต่ยังไม่สามารถเชื่อมโยงกับบัญชีในระบบนี้ได้`, true)
        );
      }

      req.session.user = sessionUser;
      req.session.save((err) => {
        if (err) {
          return res.status(500).send(renderHtmlMessage('เกิดข้อผิดพลาดในการบันทึก Session', err.message, true));
        }
        res.redirect('/');
      });
    } catch (err) {
      console.error('[MOPH Provider Auth Error]:', err);
      res.status(500).send(renderHtmlMessage('เกิดข้อผิดพลาดในการเข้าสู่ระบบ', err.message, true));
    }
  });
}

module.exports = {
  registerMophProviderRoutes,
  matchHosxpOpdUser,
  HEALTH_ID_CLIENT_ID,
  PROVIDER_CLIENT_ID,
};
