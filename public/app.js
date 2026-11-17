const state = {
  user: null,
  units: [],
  currentTab: 'list',
  mineOnly: false,
  viewMode: 'calendar',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  page: 1,
  masterType: null,
  masterEditId: null,
};

const STATUS_MAP = {
  0: { label: 'รออนุมัติ', cls: 'badge-0', calCls: 'st-0' },
  1: { label: 'อนุมัติแล้ว', cls: 'badge-1', calCls: 'st-1' },
  2: { label: 'อยู่ระหว่างเดินทาง', cls: 'badge-2', calCls: 'st-2' },
  6: { label: 'เสร็จสิ้นภารกิจ', cls: 'badge-6', calCls: 'st-6' },
  9: { label: 'ไม่อนุมัติ / ยกเลิก', cls: 'badge-9', calCls: 'st-9' },
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_FULL_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtThaiDate(iso) {
  if (!iso || iso.startsWith('0000')) return '-';
  const p = iso.slice(0, 10).split('-');
  if (p.length !== 3) return iso;
  const y = Number(p[0]) + 543;
  const m = THAI_MONTHS[Number(p[1]) - 1] || p[1];
  return `${Number(p[2])} ${m} ${String(y).slice(-2)}`;
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
  return data;
}

async function init() {
  await Promise.all([loadAuth(), loadStats(), loadUnits()]);
  populateYearDropdowns();
  setViewMode('calendar');
  if (!state.user) openLoginModal();
}

async function loadAuth() {
  const { user } = await api('/api/auth/me');
  state.user = user;
  renderAuth();
}

function renderAuth() {
  const area = document.getElementById('authArea');
  const adminBtns = document.querySelectorAll('.admin-only');
  const tabMine = document.getElementById('tabMine');
  const createNotice = document.getElementById('createAuthNotice');

  if (state.user) {
    area.innerHTML = `
      <div class="side-user-card">
        <div><strong>👤 ${esc(state.user.fullName)}</strong></div>
        <div style="font-size:11.5px;color:#94a3b8;">${state.user.isAdmin ? 'ผู้อนุมัติ / ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'}</div>
      </div>
      <button class="btn btn-outline btn-sm full-btn" onclick="logout()" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.2);">ออกจากระบบ</button>
    `;
    tabMine.classList.remove('hidden');
    createNotice.classList.add('hidden');
    adminBtns.forEach((b) => b.classList.toggle('hidden', !state.user.isAdmin));
    if (!document.getElementById('fRowId').value) {
      document.getElementById('fRequesterName').value = state.user.fullName;
      document.getElementById('fRequesterPos').value = state.user.position || '';
      document.getElementById('fRequesterTel').value = state.user.telephone || '';
      if (state.user.unit_id) document.getElementById('fUnitId').value = state.user.unit_id;
    }
  } else {
    area.innerHTML = `<button class="btn btn-primary btn-sm full-btn" onclick="openLoginModal()">🔐 เข้าสู่ระบบ</button>`;
    tabMine.classList.add('hidden');
    adminBtns.forEach((b) => b.classList.add('hidden'));
    createNotice.classList.remove('hidden');
  }
}

async function loadStats() {
  const s = await api('/api/stats');
  document.getElementById('statTotal').textContent = s.total.toLocaleString();
  document.getElementById('statPending').textContent = s.pending.toLocaleString();
  document.getElementById('statApproved').textContent = s.approved.toLocaleString();
  document.getElementById('statCompleted').textContent = s.completed.toLocaleString();
  document.getElementById('statBudget').textContent = Number(s.budgetEstimated || 0).toLocaleString();
  document.getElementById('ecoPaper').textContent = s.eco.paper.toLocaleString();
  document.getElementById('ecoBaht').textContent = s.eco.baht.toLocaleString();
  document.getElementById('ecoGhg').textContent = s.eco.ghg;
}

async function loadUnits() {
  state.units = await api('/api/units');
  const unitOptions = state.units.map((u) => `<option value="${u.row_id}">${esc(u.unit_name)}</option>`).join('');
  document.getElementById('fUnitId').innerHTML = `<option value="0">-- เลือกหน่วยงาน --</option>${unitOptions}`;
}

function populateYearDropdowns() {
  const curYear = new Date().getFullYear();
  let html = '<option value="">-- ทุกปี --</option>';
  let fyHtml = '';
  for (let y = curYear + 1; y >= 2020; y--) {
    html += `<option value="${y}">${y + 543}</option>`;
    fyHtml += `<option value="${y + 543}">ปีงบประมาณ ${y + 543}</option>`;
  }
  document.getElementById('filterYear').innerHTML = html;
  document.getElementById('repYear').innerHTML = html;
  const fyEl = document.getElementById('repFiscalYear');
  if (fyEl) fyEl.innerHTML = fyHtml;
  const rdEl = document.getElementById('repDate');
  if (rdEl) rdEl.value = new Date().toISOString().slice(0, 10);
}

// ==================== TABS ====================
document.getElementById('navTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.side-btn');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.side-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.add('hidden'));

  if (tab === 'list' || tab === 'mine') {
    state.mineOnly = tab === 'mine';
    document.getElementById('listTitle').textContent = state.mineOnly
      ? 'คำขอไปราชการของฉัน'
      : state.viewMode === 'calendar'
      ? 'ปฏิทินการเดินทางไปราชการ'
      : 'รายการคำขอไปราชการ';
    document.getElementById('view-list').classList.remove('hidden');
    if (state.viewMode === 'calendar') loadCalendar();
    else loadTravels(1);
  } else {
    document.getElementById(`view-${tab}`).classList.remove('hidden');
    if (tab === 'create' && !document.getElementById('fStartDate').value) {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('fStartDate').value = today;
      document.getElementById('fEndDate').value = today;
    }
    if (tab === 'admin') loadAdminList(1);
    if (tab === 'reports') loadReports();
    if (tab === 'units') renderUnits();
    if (tab === 'users') loadUsers();
  }
}

// ==================== CALENDAR & LIST ====================
function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btnViewCal').classList.toggle('active', mode === 'calendar');
  document.getElementById('btnViewTable').classList.toggle('active', mode === 'table');
  document.getElementById('calendarContainer').classList.toggle('hidden', mode !== 'calendar');
  document.getElementById('tableContainer').classList.toggle('hidden', mode !== 'table');
  if (mode === 'calendar') loadCalendar();
  else loadTravels(1);
}

function applyFilters() {
  const fy = document.getElementById('filterYear').value;
  const fm = Number(document.getElementById('filterMonth').value || 0);
  if (state.viewMode === 'calendar') {
    if (fy) state.calYear = Number(fy);
    if (fm > 0) state.calMonth = fm;
    loadCalendar();
  } else {
    loadTravels(1);
  }
}

function shiftCalMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth > 12) {
    state.calMonth = 1;
    state.calYear += 1;
  } else if (state.calMonth < 1) {
    state.calMonth = 12;
    state.calYear -= 1;
  }
  loadCalendar();
}

function goCalToday() {
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth() + 1;
  loadCalendar();
}

async function loadCalendar() {
  const y = state.calYear;
  const m = state.calMonth;
  document.getElementById('calMonthLabel').textContent = `${THAI_FULL_MONTHS[m - 1]} พ.ศ. ${y + 543}`;
  document.getElementById('filterYear').value = String(y);
  document.getElementById('filterMonth').value = String(m);

  const params = new URLSearchParams({
    page: 1,
    limit: 500,
    year: y,
    month: m,
    q: document.getElementById('filterQ').value,
    status: document.getElementById('filterStatus').value,
    travel_type: document.getElementById('filterType').value,
    mine: state.mineOnly ? '1' : '0',
  });
  const data = await api(`/api/travels?${params.toString()}`);

  const byDate = {};
  for (const r of data.items) {
    const s = new Date(r.start_date);
    const e = new Date(r.end_date || r.start_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!byDate[iso]) byDate[iso] = [];
      byDate[iso].push(r);
    }
  }

  const firstDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevMonthDays = new Date(y, m - 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  let html = THAI_DAYS.map((d, idx) => {
    const cls = idx === 0 ? 'sun' : idx === 6 ? 'sat' : '';
    return `<div class="cal-day-head ${cls}">${d}</div>`;
  }).join('');

  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - firstDay + 1;
    let cellClass = 'cal-cell';
    let displayNum = dayNum;
    let isoDate = '';

    if (dayNum <= 0) {
      cellClass += ' other-month';
      displayNum = prevMonthDays + dayNum;
    } else if (dayNum > daysInMonth) {
      cellClass += ' other-month';
      displayNum = dayNum - daysInMonth;
    } else {
      isoDate = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      if (isoDate === todayIso) cellClass += ' today';
    }

    const dayItems = isoDate ? byDate[isoDate] || [] : [];
    const visibleItems = dayItems.slice(0, 4);
    const hiddenCount = dayItems.length - visibleItems.length;

    const itemsHtml = visibleItems
      .map((r) => {
        const st = STATUS_MAP[r.status] || { calCls: 'st-0' };
        return `<div class="cal-item ${st.calCls}" title="${esc(r.subject)} (${esc(r.destination)})" onclick="viewTravel(${r.row_id})">
          <strong>${esc(r.doc_no || '#' + r.row_id)}</strong> ${esc(r.subject)}
        </div>`;
      })
      .join('');

    const moreHtml = hiddenCount > 0 ? `<div class="cal-more" onclick="openDayInTable('${isoDate}')">+ อีก ${hiddenCount} รายการ</div>` : '';

    html += `
      <div class="${cellClass}">
        <div class="cal-cell-top">
          <span class="cal-day-num">${displayNum}</span>
          ${dayItems.length ? `<span class="cal-count">${dayItems.length} เรื่อง</span>` : ''}
        </div>
        ${itemsHtml}
        ${moreHtml}
      </div>
    `;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function openDayInTable(isoDate) {
  setViewMode('table');
  loadTravels(1, isoDate);
}

async function loadTravels(page = 1, exactDate = '') {
  state.page = page;
  const params = new URLSearchParams({
    page,
    limit: 30,
    date: exactDate,
    q: document.getElementById('filterQ').value,
    year: exactDate ? '' : document.getElementById('filterYear').value,
    month: exactDate ? '0' : document.getElementById('filterMonth').value,
    status: document.getElementById('filterStatus').value,
    travel_type: document.getElementById('filterType').value,
    mine: state.mineOnly ? '1' : '0',
  });

  const data = await api(`/api/travels?${params.toString()}`);
  const tbody = document.getElementById('travelsTbody');

  if (!data.items.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:24px;">ไม่พบรายการขออนุมัติไปราชการ</td></tr>';
  } else {
    tbody.innerHTML = data.items
      .map((r) => {
        const st = STATUS_MAP[r.status] || { label: r.status, cls: 'badge-0' };
        const canEdit = state.user && (state.user.isAdmin || r.user_id === state.user.row_id);
        const dateTxt = r.start_date === r.end_date ? fmtThaiDate(r.start_date) : `${fmtThaiDate(r.start_date)} - ${fmtThaiDate(r.end_date)}`;
        return `
          <tr>
            <td><strong>${esc(r.doc_no || '#' + r.row_id)}</strong></td>
            <td style="white-space:nowrap">${dateTxt}<br><small style="color:#64748b">${esc(r.start_time)}-${esc(r.end_time)}</small></td>
            <td><strong>${esc(r.subject)}</strong><br><small style="color:#64748b">${esc(r.travel_type)}</small></td>
            <td>${esc(r.destination)}<br><small style="color:#64748b">จ.${esc(r.province)}</small></td>
            <td>${esc(r.requester_name)}<br><small style="color:#64748b">${esc(r.unit_name || r.unit_custom || '-')}</small></td>
            <td style="white-space:nowrap">${esc(r.transport_type)}<br><small style="color:#059669">${Number(r.estimated_cost || 0).toLocaleString()} บ.</small></td>
            <td>${esc(r.assigned_to || '-')}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
            <td class="no-print" style="white-space:nowrap">
              <button class="btn btn-outline btn-sm" onclick="viewTravel(${r.row_id})">ดู PDF</button>
              ${canEdit ? `<button class="btn btn-primary btn-sm" onclick="editTravel(${r.row_id})">แก้ไข</button>` : ''}
              ${state.user?.isAdmin ? `<button class="btn btn-danger btn-sm" onclick="deleteTravel(${r.row_id})">ลบ</button>` : ''}
            </td>
          </tr>
        `;
      })
      .join('');
  }

  document.getElementById('pagination').innerHTML = `
    <div>ทั้งหมด <strong>${data.total.toLocaleString()}</strong> รายการ (หน้า ${data.page} / ${data.totalPages})</div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-outline btn-sm" ${data.page <= 1 ? 'disabled' : ''} onclick="loadTravels(${data.page - 1})">◀ ก่อนหน้า</button>
      <button class="btn btn-outline btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="loadTravels(${data.page + 1})">ถัดไป ▶</button>
    </div>
  `;
}

function resetFilters() {
  document.getElementById('filterQ').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterType').value = '';
  if (state.viewMode === 'calendar') goCalToday();
  else {
    document.getElementById('filterYear').value = '';
    document.getElementById('filterMonth').value = '0';
    loadTravels(1);
  }
}

document.getElementById('filterQ').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyFilters();
});

// ==================== PDF MODAL ====================
function openPdfModal(title, pdfUrl) {
  const modal = document.getElementById('detailModal');
  const frame = document.getElementById('pdfFrame');
  const loading = document.getElementById('pdfLoading');
  const dlBtn = document.getElementById('pdfDownloadBtn');
  const newTabBtn = document.getElementById('pdfNewTabBtn');

  document.getElementById('pdfModalTitle').textContent = title;
  const sep = pdfUrl.includes('?') ? '&' : '?';
  dlBtn.href = `${pdfUrl}${sep}download=1`;
  newTabBtn.href = pdfUrl;

  loading.classList.remove('hidden');
  frame.onload = () => loading.classList.add('hidden');
  frame.src = pdfUrl;
  modal.classList.remove('hidden');
}

function closePdfModal() {
  document.getElementById('pdfFrame').src = 'about:blank';
  closeModal('detailModal');
}

function printPdfFrame() {
  const frame = document.getElementById('pdfFrame');
  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch {
    window.open(document.getElementById('pdfNewTabBtn').href, '_blank');
  }
}

function viewTravel(id) {
  openPdfModal(`ใบขออนุมัติเดินทางไปราชการ #${id} (ขนาด A4)`, `/api/travels/${id}/pdf`);
}

function printBoard() {
  const params = new URLSearchParams({
    q: document.getElementById('filterQ').value,
    year: document.getElementById('filterYear').value,
    month: document.getElementById('filterMonth').value,
    status: document.getElementById('filterStatus').value,
    travel_type: document.getElementById('filterType').value,
  });
  openPdfModal('รายงานสรุปการเดินทางไปราชการ (ขนาด A4 แนวนอน)', `/api/travels/board/pdf?${params.toString()}`);
}

// ==================== CREATE / EDIT ====================
function resetTravelForm() {
  document.getElementById('travelForm').reset();
  document.getElementById('fRowId').value = '';
  document.getElementById('travelFormTitle').textContent = 'แบบฟอร์มขออนุมัติเดินทางไปราชการ';
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('fStartDate').value = today;
  document.getElementById('fEndDate').value = today;
  if (state.user) {
    document.getElementById('fRequesterName').value = state.user.fullName;
    document.getElementById('fRequesterPos').value = state.user.position || '';
    document.getElementById('fRequesterTel').value = state.user.telephone || '';
    if (state.user.unit_id) document.getElementById('fUnitId').value = state.user.unit_id;
  }
}

async function editTravel(id) {
  const r = await api(`/api/travels/${id}`);
  switchTab('create');
  document.getElementById('travelFormTitle').textContent = `แก้ไขคำขอไปราชการ ${r.doc_no || '#' + r.row_id}`;
  document.getElementById('fRowId').value = r.row_id;
  document.getElementById('fSubject').value = r.subject || '';
  document.getElementById('fTravelType').value = r.travel_type || 'ประชุม/สัมมนา';
  document.getElementById('fUnitId').value = r.unit_id || 0;
  document.getElementById('fDestination').value = r.destination || '';
  document.getElementById('fProvince').value = r.province || 'สกลนคร';
  document.getElementById('fStartDate').value = (r.start_date || '').slice(0, 10);
  document.getElementById('fEndDate').value = (r.end_date || '').slice(0, 10);
  document.getElementById('fStartTime').value = r.start_time || '08:30';
  document.getElementById('fEndTime').value = r.end_time || '16:30';
  document.getElementById('fTravelers').value = r.travelers || '';
  document.getElementById('fTravelerCount').value = r.traveler_count || 1;
  document.getElementById('fTransportType').value = r.transport_type || 'รถโรงพยาบาล';
  document.getElementById('fBudgetSource').value = r.budget_source || 'งบโรงพยาบาล';
  document.getElementById('fEstimatedCost').value = r.estimated_cost || 0;
  document.getElementById('fRequesterName').value = r.requester_name || '';
  document.getElementById('fRequesterPos').value = r.requester_position || '';
  document.getElementById('fRequesterTel').value = r.requester_tel || '';
  document.getElementById('fMemo').value = r.memo || '';
}

async function submitTravel(e) {
  e.preventDefault();
  if (!state.user) return openLoginModal();

  const id = document.getElementById('fRowId').value;
  const payload = {
    subject: document.getElementById('fSubject').value,
    travel_type: document.getElementById('fTravelType').value,
    unit_id: Number(document.getElementById('fUnitId').value || 0),
    destination: document.getElementById('fDestination').value,
    province: document.getElementById('fProvince').value,
    start_date: document.getElementById('fStartDate').value,
    end_date: document.getElementById('fEndDate').value,
    start_time: document.getElementById('fStartTime').value,
    end_time: document.getElementById('fEndTime').value,
    travelers: document.getElementById('fTravelers').value,
    traveler_count: Number(document.getElementById('fTravelerCount').value || 1),
    transport_type: document.getElementById('fTransportType').value,
    budget_source: document.getElementById('fBudgetSource').value,
    estimated_cost: Number(document.getElementById('fEstimatedCost').value || 0),
    requester_name: document.getElementById('fRequesterName').value,
    requester_position: document.getElementById('fRequesterPos').value,
    requester_tel: document.getElementById('fRequesterTel').value,
    memo: document.getElementById('fMemo').value,
  };

  try {
    if (id) {
      await api(`/api/travels/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      alert('บันทึกการแก้ไขเรียบร้อยแล้ว');
    } else {
      const res = await api('/api/travels', { method: 'POST', body: JSON.stringify(payload) });
      alert(`ยื่นคำขอไปราชการเรียบร้อยแล้ว (${res.doc_no})`);
    }
    resetTravelForm();
    await loadStats();
    switchTab('list');
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTravel(id) {
  if (!confirm(`ยืนยันการลบคำขอไปราชการ #${id} ?`)) return;
  await api(`/api/travels/${id}`, { method: 'DELETE' });
  await loadStats();
  loadTravels(state.page);
}

// ==================== ADMIN APPROVAL ====================
async function loadAdminList(page = 1) {
  const params = new URLSearchParams({
    page,
    limit: 30,
    status: document.getElementById('adminFilterStatus').value,
    q: document.getElementById('adminFilterQ').value,
  });
  const data = await api(`/api/travels?${params.toString()}`);
  const tbody = document.getElementById('adminTbody');

  if (!data.items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">ไม่พบรายการในสถานะที่เลือก</td></tr>';
  } else {
    tbody.innerHTML = data.items
      .map((r) => {
        const st = STATUS_MAP[r.status] || { label: r.status, cls: 'badge-0' };
        return `
          <tr>
            <td><strong>${esc(r.doc_no || '#' + r.row_id)}</strong></td>
            <td style="white-space:nowrap">${fmtThaiDate(r.start_date)}</td>
            <td><strong>${esc(r.subject)}</strong><br><small style="color:#64748b">${esc(r.destination)} (จ.${esc(r.province)})</small></td>
            <td>${esc(r.requester_name)}<br><small style="color:#64748b">${esc(r.unit_name || '-')}</small></td>
            <td>${Number(r.estimated_cost || 0).toLocaleString()}</td>
            <td>${esc(r.assigned_to || '-')}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
            <td style="white-space:nowrap">
              <button class="btn btn-outline btn-sm" onclick="viewTravel(${r.row_id})">👁️ ดู PDF</button>
              <button class="btn btn-primary btn-sm" onclick="openAdminActionModal(${r.row_id})">✅ อนุมัติ / มอบหมาย</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  document.getElementById('adminPagination').innerHTML = `
    <div>ทั้งหมด <strong>${data.total.toLocaleString()}</strong> รายการ</div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-outline btn-sm" ${data.page <= 1 ? 'disabled' : ''} onclick="loadAdminList(${data.page - 1})">◀ ก่อนหน้า</button>
      <button class="btn btn-outline btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="loadAdminList(${data.page + 1})">ถัดไป ▶</button>
    </div>
  `;
}

async function openAdminActionModal(id) {
  const r = await api(`/api/travels/${id}`);
  document.getElementById('aaRowId').textContent = r.doc_no || r.row_id;
  document.getElementById('aaId').value = r.row_id;
  document.getElementById('aaSummary').innerHTML = `
    <strong>เรื่อง:</strong> ${esc(r.subject)}<br>
    <strong>สถานที่:</strong> ${esc(r.destination)} (จ.${esc(r.province)}) | <strong>ผู้ขอ:</strong> ${esc(r.requester_name)} | <strong>งบประมาณการ:</strong> ${Number(r.estimated_cost || 0).toLocaleString()} บ.
  `;
  document.getElementById('aaStatus').value = String(r.status ?? 0);
  document.getElementById('aaActualCost').value = r.actual_cost || r.estimated_cost || 0;
  document.getElementById('aaAssignedTo').value = r.assigned_to || '';
  document.getElementById('aaNote').value = r.approval_note || '';
  document.getElementById('adminActionModal').classList.remove('hidden');
}

async function submitAdminAction(e) {
  e.preventDefault();
  const id = document.getElementById('aaId').value;
  await api(`/api/travels/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: Number(document.getElementById('aaStatus').value),
      actual_cost: Number(document.getElementById('aaActualCost').value || 0),
      assigned_to: document.getElementById('aaAssignedTo').value,
      approval_note: document.getElementById('aaNote').value,
    }),
  });
  closeModal('adminActionModal');
  await loadStats();
  loadAdminList(1);
}

// ==================== REPORTS ====================
function toggleReportMode() {
  const mode = document.getElementById('repMode').value;
  document.getElementById('repDate').classList.toggle('hidden', mode !== 'date');
  document.getElementById('repMonth').classList.toggle('hidden', mode !== 'month');
  document.getElementById('repYear').classList.toggle('hidden', mode !== 'month');
  document.getElementById('repFiscalYear').classList.toggle('hidden', mode !== 'fiscal');
}

function getReportQueryString() {
  const mode = document.getElementById('repMode').value;
  const params = new URLSearchParams();
  if (mode === 'date') {
    const d = document.getElementById('repDate').value;
    if (d) params.set('date', d);
  } else if (mode === 'month') {
    const y = document.getElementById('repYear').value;
    const m = document.getElementById('repMonth').value;
    if (y) params.set('year', y);
    if (m && m !== '0') params.set('month', m);
  } else if (mode === 'fiscal') {
    const fy = document.getElementById('repFiscalYear').value;
    if (fy) params.set('fiscalYear', fy);
  }
  return params.toString();
}

function printReportSection(section, title) {
  const qs = getReportQueryString();
  const url = `/api/reports/pdf?section=${section}${qs ? '&' + qs : ''}`;
  openPdfModal(`${title} (ขนาด A4)`, url);
}

async function loadReports() {
  const qs = getReportQueryString();
  const data = await api(`/api/reports/summary${qs ? '?' + qs : ''}`);

  const box = (title, section, headers, rowsHtml) => `
    <div class="report-box">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h4 style="margin:0;">${title}</h4>
        <button class="btn btn-outline btn-sm" onclick="printReportSection('${section}', '${title}')">🖨️ พิมพ์ / PDF</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('reportsContent').innerHTML =
    box('รายงานสรุปตามหน่วยงาน', 'department', ['หน่วยงาน', 'ครั้ง', 'ประมาณการ (บ.)', 'ใช้จริง (บ.)'], data.byDepartment.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${Number(r.est_cost).toLocaleString()}</td><td>${Number(r.act_cost).toLocaleString()}</td></tr>`).join('')) +
    box('รายงานสรุปตามประเภทการไปราชการ', 'type', ['ประเภท', 'ครั้ง', 'งบประมาณการ (บ.)'], data.byType.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${Number(r.est_cost).toLocaleString()}</td></tr>`).join('')) +
    box('รายงานสรุปตามพาหนะเดินทาง', 'transport', ['พาหนะ', 'จำนวน (ครั้ง)'], data.byTransport.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.total}</td></tr>`).join('')) +
    box('รายงานสรุปตามสถานะ', 'status', ['สถานะ', 'จำนวน'], data.byStatus.map((r) => `<tr><td>${(STATUS_MAP[r.status] || {}).label || r.status}</td><td>${r.total}</td></tr>`).join(''));
}

// ==================== MASTER CRUD ====================
function renderUnits() {
  document.getElementById('unitsTbody').innerHTML = state.units
    .map(
      (u) => `
      <tr>
        <td>${u.row_id}</td>
        <td>${esc(u.unit_code || '-')}</td>
        <td><strong>${esc(u.unit_name)}</strong></td>
        <td>${esc(u.unit_head || '-')}</td>
        <td>${esc(u.tel || '-')}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openMasterModal('unit', ${u.row_id})">แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMaster('units', ${u.row_id}, renderUnits)">ลบ</button>
        </td>
      </tr>`
    )
    .join('');
}

let cachedUsers = [];
async function loadUsers() {
  cachedUsers = await api('/api/users');
  document.getElementById('usersTbody').innerHTML = cachedUsers
    .map(
      (u) => `
      <tr>
        <td>${u.row_id}</td>
        <td><strong>${esc(u.full_name)}</strong></td>
        <td>${esc(u.position || '-')}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.unit_name || '-')}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-2' : 'badge-1'}">${u.role === 'admin' ? 'ผู้อนุมัติ/Admin' : 'ผู้ใช้ทั่วไป'}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openMasterModal('user', ${u.row_id})">แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMaster('users', ${u.row_id}, loadUsers)">ลบ</button>
        </td>
      </tr>`
    )
    .join('');
}

function openMasterModal(type, id = null) {
  state.masterType = type;
  state.masterEditId = id;
  const form = document.getElementById('masterForm');
  const title = document.getElementById('masterModalTitle');

  if (type === 'unit') {
    const item = id ? state.units.find((x) => x.row_id === id) : {};
    title.textContent = id ? 'แก้ไขหน่วยงาน' : 'เพิ่มหน่วยงาน';
    form.innerHTML = `
      <div class="form-group"><label>รหัสหน่วยงาน</label><input name="unit_code" value="${esc(item.unit_code || '')}" /></div>
      <div class="form-group"><label>ชื่อหน่วยงาน *</label><input name="unit_name" required value="${esc(item.unit_name || '')}" /></div>
      <div class="form-group"><label>หัวหน้าหน่วยงาน</label><input name="unit_head" value="${esc(item.unit_head || '')}" /></div>
      <div class="form-group"><label>เบอร์โทร</label><input name="tel" value="${esc(item.tel || '')}" /></div>
      <div class="form-actions"><button class="btn btn-primary full-btn" type="submit">บันทึก</button></div>
    `;
  } else if (type === 'user') {
    const item = id ? cachedUsers.find((x) => x.row_id === id) : {};
    title.textContent = id ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งาน';
    const unitOpts = state.units.map((u) => `<option value="${u.row_id}" ${u.row_id === item.unit_id ? 'selected' : ''}>${esc(u.unit_name)}</option>`).join('');
    form.innerHTML = `
      <div class="form-group"><label>ชื่อ-นามสกุล *</label><input name="full_name" required value="${esc(item.full_name || '')}" /></div>
      <div class="form-group"><label>ตำแหน่ง</label><input name="position" value="${esc(item.position || '')}" /></div>
      <div class="form-group"><label>หน่วยงาน</label><select name="unit_id"><option value="0">-- เลือก --</option>${unitOpts}</select></div>
      <div class="form-group"><label>เบอร์โทร</label><input name="telephone" value="${esc(item.telephone || '')}" /></div>
      <div class="form-group"><label>Username *</label><input name="username" required value="${esc(item.username || '')}" /></div>
      <div class="form-group"><label>Password ${id ? '(เว้นว่างหากไม่เปลี่ยน)' : '*'}</label><input name="password" type="password" ${id ? '' : 'required'} /></div>
      <div class="form-group"><label>สิทธิ์การใช้งาน</label>
        <select name="role">
          <option value="user" ${item.role !== 'admin' ? 'selected' : ''}>ผู้ใช้ทั่วไป</option>
          <option value="admin" ${item.role === 'admin' ? 'selected' : ''}>ผู้อนุมัติ / ผู้ดูแลระบบ</option>
        </select>
      </div>
      <div class="form-actions"><button class="btn btn-primary full-btn" type="submit">บันทึก</button></div>
    `;
  }
  document.getElementById('masterModal').classList.remove('hidden');
}

async function submitMaster(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target).entries());
  const ep = state.masterType === 'unit' ? 'units' : 'users';
  try {
    if (state.masterEditId) await api(`/api/${ep}/${state.masterEditId}`, { method: 'PUT', body: JSON.stringify(fd) });
    else await api(`/api/${ep}`, { method: 'POST', body: JSON.stringify(fd) });
    closeModal('masterModal');
    await loadUnits();
    if (state.masterType === 'unit') renderUnits();
    if (state.masterType === 'user') loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteMaster(ep, id, refreshFn) {
  if (!confirm('ยืนยันการลบข้อมูลนี้ ?')) return;
  await api(`/api/${ep}/${id}`, { method: 'DELETE' });
  await loadUnits();
  refreshFn();
}

// ==================== LOGIN / MODALS ====================
function openLoginModal() {
  document.getElementById('loginError').classList.add('hidden');
  const closeBtn = document.querySelector('#loginModal .close-btn');
  if (closeBtn) closeBtn.classList.toggle('hidden', !state.user);
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginUser').focus();
}

function closeModal(id) {
  if (id === 'loginModal' && !state.user) return;
  document.getElementById(id).classList.add('hidden');
}

async function submitLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value,
      }),
    });
    await loadAuth();
    closeModal('loginModal');
    if (state.viewMode === 'calendar') loadCalendar();
    else loadTravels(state.page);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  renderAuth();
  switchTab('list');
  openLoginModal();
}

init();
