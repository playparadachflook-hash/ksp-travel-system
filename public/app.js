const state = {
  user: null,
  master: null,
  currentTab: 'list',
  viewMode: 'calendar',
  mineOnly: false,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  page: 1,
  companions: [],
  wizardStep: 1,
  pdfTravelId: null,
  pdfMode: 'single',
  pdfForm: 'memo_in',
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_FULL_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const STATUS_LABELS = { 0: 'รออนุมัติ', 1: 'อนุมัติแล้ว', 2: 'กำลังเดินทาง', 6: 'เสร็จสิ้น', 9: 'ไม่อนุมัติ' };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtThaiDate(iso) {
  if (!iso || String(iso).startsWith('0000')) return '-';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return iso;
  return `${Number(p[2])} ${THAI_MONTHS[Number(p[1]) - 1] || p[1]} ${String(Number(p[0]) + 543).slice(-2)}`;
}

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
  return data;
}

async function init() {
  populateYearFilter();
  await Promise.all([loadAuth(), loadMaster()]);
  await loadStats();
  if (!state.user) {
    openLoginModal();
    setViewMode('table');
    return;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const initTab = urlParams.get('tab');
  if (initTab === 'create') {
    openCreateTab();
  } else {
    switchTab('mine');
  }
}

function populateYearFilter() {
  const sel = document.getElementById('filterYear');
  const cur = new Date().getFullYear();
  let html = '<option value="" selected>-- ทุกปี --</option>';
  for (let y = cur + 1; y >= cur - 4; y--) {
    html += `<option value="${y}">พ.ศ. ${y + 543}</option>`;
  }
  sel.innerHTML = html;
}

async function loadAuth() {
  const data = await api('/api/auth/me');
  state.user = data.user;
  renderAuth();
}

function renderAuth() {
  const box = document.getElementById('authArea');
  const adminEls = document.querySelectorAll('.admin-only');
  if (state.user) {
    box.innerHTML = `
      <div style="font-weight:600;color:#fff;margin-bottom:2px;">${esc(state.user.fullName)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">${esc(state.user.position || state.user.department_name || '')}</div>
      <div style="font-size:10.5px;color:#5eead4;margin-bottom:8px;">สิทธิ์: ${esc(state.user.userGroupLabel || (state.user.isAdmin ? 'Admin' : 'ผู้ใช้งานทั่วไป'))}</div>
      <button class="btn-soft btn-sm full-w" onclick="logout()">ออกจากระบบ</button>
    `;
    adminEls.forEach((el) => el.classList.toggle('hidden', !state.user.isAdmin));
  } else {
    box.innerHTML = `
      <div style="color:#cbd5e1;margin-bottom:8px;">ยังไม่ได้เข้าสู่ระบบ</div>
      <button class="btn-aurora btn-sm full-w" onclick="openLoginModal()">🔐 เข้าสู่ระบบ</button>
    `;
    adminEls.forEach((el) => el.classList.add('hidden'));
  }
}

async function loadMaster() {
  state.master = await api('/api/master');
  const provSel = document.getElementById('fProvinceId');
  if (provSel && state.master?.travelRates) {
    provSel.innerHTML = '<option value="">-- เลือกจังหวัด --</option>' +
      state.master.travelRates.map((r) => `<option value="${r.province_id}">${esc(r.province_name_th)}</option>`).join('');
  }
  const dl = document.getElementById('personsDatalist');
  if (dl && state.master?.persons) {
    dl.innerHTML = state.master.persons.map((p) => `<option value="${esc(p.full_name)}">`).join('');
  }
  const deptSel = document.getElementById('personDeptFilter');
  if (deptSel && state.master?.departments) {
    deptSel.innerHTML = '<option value="">ทุกกลุ่มงาน</option>' +
      state.master.departments.map((d) => `<option value="${d.department_id}">${esc(d.department_name)}</option>`).join('');
  }
}

async function loadStats() {
  const s = await api('/api/stats');
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('statTotal', Number(s.total || 0).toLocaleString());
  setTxt('statMine', state.user ? `เคยอบรม ${Number(s.myCount || 0).toLocaleString()} ครั้ง` : '-');
  setTxt('statPending', Number(s.pending || 0).toLocaleString());
  setTxt('statApproved', Number(s.approved || 0).toLocaleString());
  setTxt('statBudget', Number(s.budgetEstimated || 0).toLocaleString());
  setTxt('adminStatTotal', Number(s.total || 0).toLocaleString());
  setTxt('adminStatPending', Number(s.pending || 0).toLocaleString());
  setTxt('adminStatApproved', Number(s.approved || 0).toLocaleString());
  setTxt('adminStatBudget', Number(s.budgetEstimated || 0).toLocaleString());

  // Render activity-type history cards next to "ประวัติอบรมของคุณ"
  const grid = document.getElementById('topStatsGrid');
  if (grid) {
    const baseCard = `
      <div class="kpi-tile kpi-cyan" onclick="filterByTravelType('')" style="cursor:pointer;" title="คลิกเพื่อดูประวัติทั้งหมด">
        <span class="kpi-cap"><span>ประวัติอบรมของคุณ</span><span>🎓</span></span>
        <strong id="statMine">${state.user ? `เคยอบรม ${Number(s.myCount || 0).toLocaleString()} ครั้ง` : '-'}</strong>
      </div>
    `;
    const typeCounts = new Map((s.myByType || []).map((x) => [x.travel_type, Number(x.cnt || 0)]));
    const defaultSlots = [
      { type: 'อบรม/ประชุมวิชาการ', icon: '📚', cls: 'kpi-indigo' },
      { type: 'ประชุม/สัมมนา', icon: '🗣️', cls: 'kpi-emerald' },
      { type: 'เข้ารับการอบรม', icon: '🏫', cls: 'kpi-amber' },
      { type: 'ศึกษาดูงาน', icon: '🚌', cls: 'kpi-rose' },
    ];
    // Include any user's actual types first, then fill up to 4 cards
    const chosen = [];
    for (const row of (s.myByType || [])) {
      if (chosen.length >= 4) break;
      const preset = defaultSlots.find((d) => d.type === row.travel_type);
      chosen.push({
        type: row.travel_type,
        cnt: Number(row.cnt || 0),
        icon: preset ? preset.icon : '📌',
        cls: preset ? preset.cls : ['kpi-indigo', 'kpi-emerald', 'kpi-amber', 'kpi-rose'][chosen.length % 4],
      });
    }
    for (const d of defaultSlots) {
      if (chosen.length >= 4) break;
      if (!chosen.some((c) => c.type === d.type)) {
        chosen.push({ type: d.type, cnt: typeCounts.get(d.type) || 0, icon: d.icon, cls: d.cls });
      }
    }
    grid.innerHTML = baseCard + chosen.map((c) => `
      <div class="kpi-tile ${c.cls}" onclick="filterByTravelType('${esc(c.type)}')" style="cursor:pointer;" title="คลิกเพื่อกรองดูรายการ${esc(c.type)}">
        <span class="kpi-cap"><span>${esc(c.type)}</span><span>${c.icon}</span></span>
        <strong>${state.user ? `${c.cnt.toLocaleString()} ครั้ง` : '-'}</strong>
      </div>
    `).join('');
  }
  const badge = document.getElementById('adminPendingBadge');
  if (badge) {
    const gp = Number(s.globalPending || 0);
    if (state.user?.isAdmin && gp > 0) {
      badge.textContent = gp > 99 ? '99+' : String(gp);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function switchTab(tab) {
  if (!state.user) return openLoginModal();
  if (!state.user.isAdmin && ['list', 'reports', 'admin'].includes(tab)) {
    tab = 'mine';
  }
  state.currentTab = tab;
  document.querySelectorAll('.nav-pill').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.add('hidden'));

  if (tab === 'mine') {
    state.mineOnly = true;
    document.getElementById('view-list').classList.remove('hidden');
    document.getElementById('listTitle').textContent = '🎓 ประวัติอบรม / ไปราชการของฉัน';
    setViewMode('table');
  } else if (tab === 'list') {
    state.mineOnly = false;
    document.getElementById('view-list').classList.remove('hidden');
    document.getElementById('listTitle').textContent = 'ปฏิทินการเดินทางไปราชการ / อบรม';
    applyFilters();
  } else {
    document.getElementById(`view-${tab}`).classList.remove('hidden');
    if (tab === 'reports') loadReports();
    if (tab === 'admin') loadAdminList();
  }
}

function openCreateTab() {
  if (!state.user) return openLoginModal();
  resetTravelForm();
  switchTab('create');
}

function filterByTravelType(t) {
  if (!state.user) return openLoginModal();
  const sel = document.getElementById('filterTravelType');
  if (sel) sel.value = t || '';
  switchTab('mine');
}

function filterByStatus(st) {
  if (!state.user) return openLoginModal();
  document.getElementById('filterStatus').value = String(st);
  if (state.user.isAdmin) {
    state.mineOnly = false;
    switchTab('list');
    setViewMode('table');
  } else {
    switchTab('mine');
  }
}

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
  if (state.viewMode === 'calendar') loadCalendar();
  else loadTravels(1);
}

function resetFilters() {
  document.getElementById('filterQ').value = '';
  document.getElementById('filterMonth').value = '0';
  document.getElementById('filterStatus').value = '';
  const ft = document.getElementById('filterTravelType');
  if (ft) ft.value = '';
  applyFilters();
}

function shiftCalMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
  if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
  loadCalendar();
}

function goCalToday() {
  const n = new Date();
  state.calYear = n.getFullYear();
  state.calMonth = n.getMonth() + 1;
  loadCalendar();
}

async function loadCalendar() {
  document.getElementById('calMonthLabel').textContent = `${THAI_FULL_MONTHS[state.calMonth - 1]} พ.ศ. ${state.calYear + 543}`;
  const params = new URLSearchParams({
    year: state.calYear,
    month: state.calMonth,
    limit: 300,
    q: document.getElementById('filterQ').value,
    status: document.getElementById('filterStatus').value,
    mine: state.mineOnly ? '1' : '0',
  });
  const data = await api(`/api/travels?${params.toString()}`);
  const items = data.items || [];
  const firstDay = new Date(state.calYear, state.calMonth - 1, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  let html = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((d) => `<div class="cal-head-cell">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startOffset + 1;
    const d = new Date(state.calYear, state.calMonth - 1, dayNum);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isOther = dayNum < 1 || dayNum > daysInMonth;
    const dayItems = items.filter((x) => iso >= String(x.start_date).slice(0, 10) && iso <= String(x.end_date).slice(0, 10));
    const chips = dayItems.slice(0, 3).map((r) => `
      <div class="cal-chip" title="${esc(r.subject)}" onclick="openTravelPdf(${r.row_id}, '${r.memo_scope || 'in_province'}', '${esc(r.subject)}')">
        ${esc(r.requester_name)} • ${esc(r.subject)}
      </div>
    `).join('');
    html += `
      <div class="cal-cell ${isOther ? 'other' : ''} ${iso === todayIso ? 'today' : ''}">
        <div class="cal-day-num">${d.getDate()}</div>
        ${chips}
      </div>
    `;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

async function loadTravels(page = 1) {
  state.page = page;
  const params = new URLSearchParams({
    page,
    limit: 20,
    q: document.getElementById('filterQ').value,
    year: document.getElementById('filterYear').value,
    month: document.getElementById('filterMonth').value,
    status: document.getElementById('filterStatus').value,
    travel_type: document.getElementById('filterTravelType')?.value || '',
    mine: state.mineOnly ? '1' : '0',
  });
  const data = await api(`/api/travels?${params.toString()}`);
  document.getElementById('travelTbody').innerHTML = (data.items || []).map((r) => {
    const isOwner = state.user && Number(r.requester_person_id) === Number(state.user.person_id);
    const canEdit = state.user && (state.user.isAdmin || isOwner || Boolean(r.is_companion));
    const defForm = r.memo_scope === 'out_province' ? 'memo_out' : 'memo_in';
    return `
      <tr>
        <td><code>${esc(r.doc_no || `#${r.row_id}`)}</code><br><small style="color:#64748b">${r.memo_scope === 'out_province' ? 'นอกเขต จ.' : 'ในเขต จ.'}</small></td>
        <td><strong>${esc(r.subject)}</strong><br><small style="color:#64748b">${esc(r.organizer || r.travel_type || '')}</small></td>
        <td>${esc(r.destination)}<br><small style="color:#64748b">${esc(r.province || '')}</small></td>
        <td style="white-space:nowrap">${fmtThaiDate(r.start_date)} - ${fmtThaiDate(r.end_date)}<br><small style="color:#64748b">${r.total_days || 1} วัน</small></td>
        <td>${esc(r.transport_type || '-')}<br><small style="color:#0f766e;font-weight:600">${Number(r.estimated_cost || 0).toLocaleString()} บ.</small></td>
        <td><strong>${esc(r.requester_name)}</strong>${r.travelers ? `<br><small style="color:#0f766e">👥 ${esc(r.travelers)}</small>` : ''}</td>
        <td><span class="badge badge-${r.status || 0}">${esc(STATUS_LABELS[r.status] || 'รออนุมัติ')}</span></td>
        <td style="white-space:nowrap">
          ${r.has_doc_pdf ? `<button class="btn-soft btn-sm" onclick="openPdfModal('หนังสือแนบ #${r.row_id}', '/api/travels/${r.row_id}/doc-pdf')">📎 หนังสือ PDF</button>` : ''}
          ${r.has_image ? `<button class="btn-soft btn-sm" onclick="openTravelImageModal(${r.row_id})">🖼️ รูปภาพ</button>` : ''}
          ${state.user ? `<button class="btn-aurora btn-sm" onclick="openTravelPdf(${r.row_id}, '${defForm}', '${esc(r.subject)}')">🖨️ พิมพ์/PDF</button>` : ''}
          ${canEdit ? `<button class="btn-soft btn-sm" onclick="editTravel(${r.row_id})">✏️ แก้ไข</button>` : ''}
          ${state.user?.isAdmin ? `<button class="btn-danger btn-sm" onclick="deleteTravel(${r.row_id})">ลบ</button>` : ''}
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#64748b;">ไม่พบรายการไปราชการ</td></tr>';

  document.getElementById('paginationBar').innerHTML = `
    <div>ทั้งหมด <strong>${Number(data.total || 0).toLocaleString()}</strong> รายการ (หน้า ${data.page} / ${data.totalPages})</div>
    <div style="display:flex;gap:6px;">
      <button class="btn-soft btn-sm" ${data.page <= 1 ? 'disabled' : ''} onclick="loadTravels(${data.page - 1})">◀ ก่อนหน้า</button>
      <button class="btn-soft btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="loadTravels(${data.page + 1})">ถัดไป ▶</button>
    </div>
  `;
}

// ==================== COMPANIONS & ESTIMATE TABLE ====================
function resetTravelForm() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('fRowId').value = '';
  document.getElementById('formTitle').textContent = '✈️ ยื่นขออนุมัติไปราชการออนไลน์ (สร้างเอกสารชุด 4 แบบอัตโนมัติ)';
  document.getElementById('fMemoScope').value = 'in_province';
  document.getElementById('fDocNo').value = '';
  document.getElementById('fMemoDate').value = today;
  document.getElementById('fSubject').value = '';
  document.getElementById('fOrganizer').value = '';
  document.getElementById('fRequestDept').value = state.user?.department_name || '';
  document.getElementById('fDestination').value = '';
  document.getElementById('fProvinceId').value = '';
  document.getElementById('fStartDate').value = today;
  document.getElementById('fEndDate').value = today;
  document.getElementById('fTotalDays').value = '1';
  document.getElementById('fTransport').value = 'รถโรงพยาบาล';
  document.getElementById('fDistanceKm').value = '0';
  document.getElementById('fOrgBudgetText').value = '';
  document.getElementById('fAttNecessity').value = '';
  document.getElementById('fAttDelegate').value = '';
  document.getElementById('fAttSharer').value = '';
  document.getElementById('fAttBenefit').value = '';
  document.getElementById('fAttPlan1').value = '';
  document.getElementById('fAttPlan2').value = '';
  document.getElementById('fAttPlan3').value = '';
  document.getElementById('fReqName').value = state.user?.fullName || '';
  document.getElementById('fReqPos').value = '';
  document.getElementById('fHeadName').value = '';
  document.getElementById('fHeadPos').value = '';
  document.getElementById('fImageData').value = '';
  document.getElementById('fImageName').value = '';
  document.getElementById('fImageFile').value = '';
  document.getElementById('fImagePreview').src = '';
  document.getElementById('fImagePreviewWrap').classList.add('hidden');
  document.getElementById('fDocPdfData').value = '';
  document.getElementById('fDocPdfName').value = '';
  document.getElementById('fDocPdfFile').value = '';
  document.getElementById('fDocPdfStatus').classList.add('hidden');
  document.getElementById('btnPreviewAttachedPdf').classList.add('hidden');
  document.querySelector('input[name="attHistory"][value="never"]').checked = true;
  state.companions = [{
    person_id: state.user?.person_id || null,
    full_name: state.user?.fullName || '',
    position: '',
    level_name: '',
    allowance_fee: 0, hotel_fee: 0, travel_fee: 0, register_fee: 0, other_fee: 0,
  }];
  renderCompanionsTable();
  goWizardStep(1);
}

function goWizardStep(step) {
  const s = Math.max(1, Math.min(4, Number(step || 1)));
  state.wizardStep = s;
  for (let i = 1; i <= 4; i++) {
    const pane = document.getElementById(`wizardStep-${i}`);
    if (pane) pane.classList.toggle('hidden', i !== s);
  }
  document.querySelectorAll('#travelStepWizard .step-item').forEach((el) => {
    const idx = Number(el.dataset.step);
    el.classList.toggle('active', idx === s);
    el.classList.toggle('done', idx < s);
  });
  const fill = document.getElementById('stepWizardFill');
  if (fill) fill.style.width = `${((s - 1) / 3) * 100}%`;

  const prevBtn = document.getElementById('btnWizPrev');
  const nextBtn = document.getElementById('btnWizNext');
  const subBtn = document.getElementById('btnWizSubmit');
  const pvBtn = document.getElementById('btnWizPreview');
  if (prevBtn) prevBtn.disabled = s <= 1;
  if (nextBtn) nextBtn.classList.toggle('hidden', s >= 4);
  if (subBtn) subBtn.classList.toggle('hidden', s < 4);
  if (pvBtn) pvBtn.classList.toggle('hidden', !document.getElementById('fRowId')?.value);
  if (s === 4 || s === 1) renderCompanionsTable();
}

function nextWizardStep() {
  if (state.wizardStep === 1) {
    const subj = document.getElementById('fSubject')?.value.trim();
    const dest = document.getElementById('fDestination')?.value.trim();
    if (!subj || !dest) {
      alert('กรุณากรอกเรื่อง และสถานที่ไปราชการก่อนดำเนินการต่อ');
      return;
    }
  }
  goWizardStep(state.wizardStep + 1);
}

function previewCurrentStepPdf() {
  const id = document.getElementById('fRowId')?.value;
  if (!id) return;
  const formMap = { 1: 'memo_in', 2: 'memo_out', 3: 'attachment', 4: 'estimate' };
  openTravelPdf(id, formMap[state.wizardStep] || 'memo_in', document.getElementById('fSubject')?.value || '');
}

function addCompanionRow() {
  state.companions.push({
    person_id: null, full_name: '', position: '', level_name: '',
    allowance_fee: 0, hotel_fee: 0, travel_fee: 0, register_fee: 0, other_fee: 0,
  });
  renderCompanionsTable();
}

function removeCompanionRow(idx) {
  state.companions.splice(idx, 1);
  if (!state.companions.length) addCompanionRow();
  else renderCompanionsTable();
}

function renderCompanionsTable() {
  const step1Box = document.getElementById('step1CompanionsBox');
  if (step1Box) {
    step1Box.innerHTML = state.companions.map((c, idx) => `
      <div style="display:grid;grid-template-columns:30px 1.2fr 1fr 34px;gap:8px;align-items:center;">
        <span style="text-align:center;font-weight:700;color:#475569;">${idx + 1}.</span>
        <div class="comp-ac-wrap">
          <input type="text" class="est-input" value="${esc(c.full_name || '')}" placeholder="🔍 พิมพ์ค้นหาชื่อ-นามสกุล คนที่ ${idx + 1}..."
                 oninput="onCompNameInput(${idx}, this.value, 's1')" onfocus="onCompNameInput(${idx}, this.value, 's1')" onblur="hideCompDrop(${idx}, 's1')" />
          <div id="compDrop_s1_${idx}" class="comp-ac-dropdown hidden"></div>
        </div>
        <input type="text" class="est-input" value="${esc(c.position || '')}" oninput="state.companions[${idx}].position=this.value" placeholder="ตำแหน่ง" />
        <button type="button" class="btn-danger btn-sm" onclick="removeCompanionRow(${idx})">✕</button>
      </div>
    `).join('');
  }

  const tbody = document.getElementById('companionsEstTbody');
  tbody.innerHTML = state.companions.map((c, idx) => {
    const rowSum = Number(c.allowance_fee || 0) + Number(c.hotel_fee || 0) + Number(c.travel_fee || 0) + Number(c.register_fee || 0) + Number(c.other_fee || 0);
    return `
      <tr>
        <td style="text-align:center;font-weight:700;">${idx + 1}</td>
        <td>
          <div class="comp-ac-wrap">
            <input type="text" value="${esc(c.full_name || '')}" placeholder="พิมพ์ค้นหาชื่อ-สกุล..."
                   oninput="onCompNameInput(${idx}, this.value)" onfocus="onCompNameInput(${idx}, this.value)" onblur="hideCompDrop(${idx})" />
            <div id="compDrop_${idx}" class="comp-ac-dropdown hidden"></div>
          </div>
        </td>
        <td><input type="text" value="${esc(c.position || '')}" oninput="state.companions[${idx}].position=this.value" placeholder="ตำแหน่ง" /></td>
        <td><input type="text" value="${esc(c.level_name || '')}" oninput="state.companions[${idx}].level_name=this.value" placeholder="เช่น ชำนาญการ" /></td>
        <td><input type="number" step="1" min="0" value="${Number(c.allowance_fee || 0)}" oninput="onCompFeeInput(${idx}, 'allowance_fee', this.value)" /></td>
        <td><input type="number" step="1" min="0" value="${Number(c.hotel_fee || 0)}" oninput="onCompFeeInput(${idx}, 'hotel_fee', this.value)" /></td>
        <td><input type="number" step="1" min="0" value="${Number(c.travel_fee || 0)}" oninput="onCompFeeInput(${idx}, 'travel_fee', this.value)" /></td>
        <td><input type="number" step="1" min="0" value="${Number(c.register_fee || 0)}" oninput="onCompFeeInput(${idx}, 'register_fee', this.value)" /></td>
        <td><input type="number" step="1" min="0" value="${Number(c.other_fee || 0)}" oninput="onCompFeeInput(${idx}, 'other_fee', this.value)" /></td>
        <td id="compRowSum_${idx}" style="text-align:right;font-weight:700;color:#0f766e;">${rowSum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        <td><button type="button" class="btn-danger btn-sm" onclick="removeCompanionRow(${idx})">✕</button></td>
      </tr>
    `;
  }).join('');
  recalcDaysAndTotals();
}

function onCompNameInput(idx, val, prefix = '') {
  state.companions[idx].full_name = val;
  const q = String(val || '').trim().toLowerCase();
  const dropId = prefix ? `compDrop_${prefix}_${idx}` : `compDrop_${idx}`;
  const drop = document.getElementById(dropId);
  if (!drop) return;
  const persons = state.master?.persons || [];
  const matches = (q ? persons.filter((p) => `${p.full_name} ${p.position_name}`.toLowerCase().includes(q)) : persons).slice(0, 20);
  if (!matches.length) { drop.classList.add('hidden'); return; }
  drop.innerHTML = matches.map((p) => `
    <div class="comp-ac-item" onmousedown="event.preventDefault();pickCompanion(${idx}, ${p.person_id})">
      <strong>${esc(p.full_name)}</strong><small style="color:#0f766e">${esc(p.position_name || '')}</small>
    </div>
  `).join('');
  drop.classList.remove('hidden');
}

function pickCompanion(idx, personId) {
  const p = (state.master?.persons || []).find((x) => Number(x.person_id) === Number(personId));
  if (!p) return;
  state.companions[idx].person_id = p.person_id;
  state.companions[idx].full_name = p.full_name;
  state.companions[idx].position = p.position_name || '';
  renderCompanionsTable();
}

function hideCompDrop(idx, prefix = '') {
  const dropId = prefix ? `compDrop_${prefix}_${idx}` : `compDrop_${idx}`;
  setTimeout(() => document.getElementById(dropId)?.classList.add('hidden'), 150);
}

function onCompFeeInput(idx, field, val) {
  state.companions[idx][field] = Number(val || 0);
  const c = state.companions[idx];
  const rowSum = Number(c.allowance_fee || 0) + Number(c.hotel_fee || 0) + Number(c.travel_fee || 0) + Number(c.register_fee || 0) + Number(c.other_fee || 0);
  const cell = document.getElementById(`compRowSum_${idx}`);
  if (cell) cell.textContent = rowSum.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  recalcDaysAndTotals();
}

function recalcDaysAndTotals() {
  const s = new Date(document.getElementById('fStartDate').value);
  const e = new Date(document.getElementById('fEndDate').value);
  if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
    const diff = Math.round((e - s) / 86400000) + 1;
    document.getElementById('fTotalDays').value = String(diff > 0 ? diff : 1);
  }
  let sA = 0, sH = 0, sT = 0, sR = 0, sO = 0;
  state.companions.forEach((c) => {
    sA += Number(c.allowance_fee || 0);
    sH += Number(c.hotel_fee || 0);
    sT += Number(c.travel_fee || 0);
    sR += Number(c.register_fee || 0);
    sO += Number(c.other_fee || 0);
  });
  const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  document.getElementById('sumAllow').textContent = fmt(sA);
  document.getElementById('sumHotel').textContent = fmt(sH);
  document.getElementById('sumTravel').textContent = fmt(sT);
  document.getElementById('sumReg').textContent = fmt(sR);
  document.getElementById('sumOther').textContent = fmt(sO);
  document.getElementById('sumTotal').textContent = fmt(sA + sH + sT + sR + sO);
}

function onTravelAutoCalc() {
  const provId = Number(document.getElementById('fProvinceId').value || 0);
  const mode = document.getElementById('fTransport').value;
  const rate = (state.master?.travelRates || []).find((r) => Number(r.province_id) === provId);
  if (rate) {
    document.getElementById('fDistanceKm').value = Number(rate.distance_roundtrip_km || 0);
    if (rate.province_name_th && rate.province_name_th !== 'สกลนคร') {
      document.getElementById('fMemoScope').value = 'out_province';
    }
  }
  const dist = Number(document.getElementById('fDistanceKm').value || 0);
  let fare = 0;
  if (mode === 'รถยนต์ส่วนตัว') fare = dist * (rate ? Number(rate.private_car_rate || 4) : 4);
  else if (mode === 'รถประจำทาง') fare = rate ? Number(rate.bus_fare || 0) : 0;
  else if (mode === 'เครื่องบิน') fare = rate ? Number(rate.flight_fare || 0) : 0;
  else if (mode === 'รถไฟ') fare = rate ? Number(rate.train_fare || 0) : 0;
  if (state.companions.length && fare >= 0) {
    state.companions[0].travel_fee = Math.round(fare * 100) / 100;
    renderCompanionsTable();
  }
}

function onDistanceInput() {
  if (document.getElementById('fTransport').value === 'รถยนต์ส่วนตัว') {
    onTravelAutoCalc();
  }
}

async function editTravel(id) {
  const item = await api(`/api/travels/${id}`);
  resetTravelForm();
  document.getElementById('fRowId').value = item.row_id;
  document.getElementById('formTitle').textContent = `✏️ แก้ไขคำขอไปราชการ #${item.row_id}`;
  document.getElementById('fMemoScope').value = item.memo_scope || 'in_province';
  document.getElementById('fTravelType').value = item.travel_type || 'ประชุม/สัมมนา';
  document.getElementById('fDocNo').value = item.doc_no || '';
  document.getElementById('fMemoDate').value = String(item.memo_date || item.start_date).slice(0, 10);
  document.getElementById('fSubject').value = item.subject || '';
  document.getElementById('fOrganizer').value = item.organizer || '';
  document.getElementById('fRequestDept').value = item.request_dept || '';
  document.getElementById('fDestination').value = item.destination || '';
  document.getElementById('fProvinceId').value = item.province_id || '';
  document.getElementById('fStartDate').value = String(item.start_date).slice(0, 10);
  document.getElementById('fEndDate').value = String(item.end_date || item.start_date).slice(0, 10);
  document.getElementById('fTotalDays').value = item.total_days || 1;
  document.getElementById('fTransport').value = item.transport_type || 'รถโรงพยาบาล';
  document.getElementById('fDistanceKm').value = item.distance_km || 0;
  document.getElementById('fOrgBudgetText').value = item.org_budget_text || '';
  document.getElementById('fReqName').value = item.requester_name || '';
  document.getElementById('fReqPos').value = item.requester_position || '';
  document.getElementById('fHeadName').value = item.head_name || '';
  document.getElementById('fHeadPos').value = item.head_position || '';
  document.getElementById('fDirName').value = item.director_name || 'นางณัฐปภัสร์ นวัตชัยศิริกุล';
  document.getElementById('fDirPos1').value = item.director_pos1 || 'นายแพทย์ชำนาญการพิเศษ รักษาการในตำแหน่ง';

  const att = item.attachment || {};
  const hs = att.history_status || 'never';
  const rad = document.querySelector(`input[name="attHistory"][value="${hs}"]`);
  if (rad) rad.checked = true;
  document.getElementById('fAttNecessity').value = att.necessity_reason || '';
  document.getElementById('fAttDelegate').value = att.delegate_name || '';
  document.getElementById('fAttSharer').value = att.knowledge_sharer || '';
  document.getElementById('fAttBenefit').value = att.expected_benefit || '';
  document.getElementById('fAttPlan1').value = att.post_action_1 || '';
  document.getElementById('fAttPlan2').value = att.post_action_2 || '';
  document.getElementById('fAttPlan3').value = att.post_action_3 || '';
  document.getElementById('fImageData').value = item.image_data || '';
  document.getElementById('fImageName').value = item.image_name || '';
  if (item.image_data) {
    document.getElementById('fImagePreview').src = item.image_data;
    document.getElementById('fImagePreviewWrap').classList.remove('hidden');
  }
  document.getElementById('fDocPdfData').value = '';
  document.getElementById('fDocPdfName').value = item.doc_pdf_name || '';
  document.getElementById('fDocPdfFile').value = '';
  if (item.has_doc_pdf) {
    document.getElementById('fDocPdfNameLabel').textContent = `📎 ${item.doc_pdf_name || 'หนังสือแนบ.pdf'}`;
    document.getElementById('fDocPdfStatus').classList.remove('hidden');
    document.getElementById('btnPreviewAttachedPdf').classList.remove('hidden');
  }

  state.companions = (item.companions || []).length
    ? item.companions.map((c) => ({ ...c }))
    : [{ person_id: item.requester_person_id || null, full_name: item.requester_name, position: item.requester_position, level_name: '', allowance_fee: item.allowance_cost, hotel_fee: item.hotel_cost, travel_fee: item.travel_cost, register_fee: item.reg_cost, other_fee: item.other_cost }];
  renderCompanionsTable();
  goWizardStep(1);
  switchTab('create');
}

async function submitTravel(e) {
  e.preventDefault();
  const id = document.getElementById('fRowId').value;
  const provId = Number(document.getElementById('fProvinceId').value || 0);
  const provRow = (state.master?.travelRates || []).find((r) => Number(r.province_id) === provId);
  let allow = 0, hotel = 0, travel = 0, reg = 0, other = 0;
  state.companions.forEach((c) => {
    allow += Number(c.allowance_fee || 0);
    hotel += Number(c.hotel_fee || 0);
    travel += Number(c.travel_fee || 0);
    reg += Number(c.register_fee || 0);
    other += Number(c.other_fee || 0);
  });

  const payload = {
    doc_no: document.getElementById('fDocNo').value,
    memo_scope: document.getElementById('fMemoScope').value,
    memo_date: document.getElementById('fMemoDate').value,
    travel_type: document.getElementById('fTravelType').value,
    subject: document.getElementById('fSubject').value,
    organizer: document.getElementById('fOrganizer').value,
    request_dept: document.getElementById('fRequestDept').value,
    destination: document.getElementById('fDestination').value,
    province_id: provId || null,
    province: provRow ? provRow.province_name_th : 'สกลนคร',
    distance_km: document.getElementById('fDistanceKm').value,
    start_date: document.getElementById('fStartDate').value,
    end_date: document.getElementById('fEndDate').value,
    total_days: document.getElementById('fTotalDays').value,
    transport_type: document.getElementById('fTransport').value,
    org_budget_text: document.getElementById('fOrgBudgetText').value,
    allowance_cost: allow,
    hotel_cost: hotel,
    travel_cost: travel,
    reg_cost: reg,
    other_cost: other,
    estimated_cost: allow + hotel + travel + reg + other,
    requester_name: document.getElementById('fReqName').value,
    requester_position: document.getElementById('fReqPos').value,
    head_name: document.getElementById('fHeadName').value,
    head_position: document.getElementById('fHeadPos').value,
    director_name: document.getElementById('fDirName').value,
    director_pos1: document.getElementById('fDirPos1').value,
    companions: state.companions.filter((c) => String(c.full_name || '').trim()),
    image_data: document.getElementById('fImageData').value,
    image_name: document.getElementById('fImageName').value,
    doc_pdf_data: document.getElementById('fDocPdfData').value,
    doc_pdf_name: document.getElementById('fDocPdfName').value,
    attachment: {
      history_status: document.querySelector('input[name="attHistory"]:checked')?.value || 'never',
      necessity_reason: document.getElementById('fAttNecessity').value,
      delegate_name: document.getElementById('fAttDelegate').value,
      knowledge_sharer: document.getElementById('fAttSharer').value,
      expected_benefit: document.getElementById('fAttBenefit').value,
      post_action_1: document.getElementById('fAttPlan1').value,
      post_action_2: document.getElementById('fAttPlan2').value,
      post_action_3: document.getElementById('fAttPlan3').value,
    },
  };

  try {
    let savedId = id;
    if (id) {
      await api(`/api/travels/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      const res = await api('/api/travels', { method: 'POST', body: JSON.stringify(payload) });
      savedId = res.row_id;
    }
    await loadStats();
    switchTab('mine');
    if (savedId) {
      openTravelPdf(savedId, 'all', payload.subject);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTravel(id) {
  if (!confirm(`ลบคำขอไปราชการ #${id}?`)) return;
  await api(`/api/travels/${id}`, { method: 'DELETE' });
  loadStats();
  applyFilters();
}

// ==================== REPORTS & ADMIN ====================
async function loadReports() {
  const d = await api('/api/reports/summary');
  const tbl = (title, cols, rows) => `
    <div class="report-box"><h3>${title}</h3><div class="table-wrap"><table>
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${rows || '<tr><td colspan="3">ไม่มีข้อมูล</td></tr>'}</tbody>
    </table></div></div>`;
  document.getElementById('reportsGrid').innerHTML =
    tbl('สรุปตามหน่วยงาน', ['หน่วยงาน', 'ครั้ง', 'งบประมาณ (บ.)'], d.byDepartment.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${Number(r.est_cost || 0).toLocaleString()}</td></tr>`).join('')) +
    tbl('สรุปตามพาหนะ', ['พาหนะ', 'ครั้ง'], d.byTransport.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.total}</td></tr>`).join(''));
}

function switchAdminPane(pane, btn) {
  document.querySelectorAll('#view-admin .seg-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['approve', 'persons', 'travelRates'].forEach((p) => {
    document.getElementById(`adminPane-${p}`).classList.toggle('hidden', p !== pane);
  });
  if (pane === 'approve') loadAdminList(1);
  if (pane === 'persons') loadPersons();
  if (pane === 'travelRates') loadTravelRates();
}

async function loadAdminList(page = 1) {
  const params = new URLSearchParams({
    page,
    limit: 20,
    all: '1',
    q: document.getElementById('adminQ')?.value || '',
    status: document.getElementById('adminStatusFilter')?.value ?? '0',
  });
  const data = await api(`/api/travels?${params.toString()}`);
  document.getElementById('adminTbody').innerHTML = (data.items || []).map((r) => `
    <tr>
      <td><code>${esc(r.doc_no || `#${r.row_id}`)}</code></td>
      <td><strong>${esc(r.subject)}</strong><br><small style="color:#64748b">${esc(r.requester_name)}${r.request_dept ? ` • ${esc(r.request_dept)}` : ''}</small></td>
      <td>${esc(r.destination)}<br><small style="color:#64748b">${esc(r.province || '')}</small></td>
      <td style="white-space:nowrap">${fmtThaiDate(r.start_date)}</td>
      <td>${Number(r.estimated_cost || 0).toLocaleString()} บ.</td>
      <td><span class="badge badge-${r.status || 0}">${esc(STATUS_LABELS[r.status] || 'รออนุมัติ')}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-aurora btn-sm" onclick="approveTravel(${r.row_id}, 1)">✓ อนุมัติ</button>
        <button class="btn-danger btn-sm" onclick="approveTravel(${r.row_id}, 9)">✕ ไม่อนุมัติ</button>
        <button class="btn-soft btn-sm" onclick="editTravel(${r.row_id})">✏️ แก้ไข</button>
        ${r.has_doc_pdf ? `<button class="btn-soft btn-sm" onclick="openPdfModal('หนังสือแนบ #${r.row_id}', '/api/travels/${r.row_id}/doc-pdf')">📎 หนังสือ</button>` : ''}
        <button class="btn-soft btn-sm" onclick="openTravelPdf(${r.row_id}, 'all', '${esc(r.subject)}')">🖨️ PDF</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b;">ไม่มีรายการ</td></tr>';

  const pagEl = document.getElementById('adminPagination');
  if (pagEl) {
    pagEl.innerHTML = `
      <div>ทั้งหมด <strong>${Number(data.total || 0).toLocaleString()}</strong> รายการ (หน้า ${data.page} / ${data.totalPages})</div>
      <div style="display:flex;gap:6px;">
        <button class="btn-soft btn-sm" ${data.page <= 1 ? 'disabled' : ''} onclick="loadAdminList(${data.page - 1})">◀ ก่อนหน้า</button>
        <button class="btn-soft btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="loadAdminList(${data.page + 1})">ถัดไป ▶</button>
      </div>
    `;
  }
}

async function approveTravel(id, status) {
  await api(`/api/travels/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ status }) });
  loadStats();
  loadAdminList(1);
}

async function approveAllPending() {
  const pendTxt = document.getElementById('adminStatPending')?.textContent || '';
  if (!confirm(`ยืนยันการอนุมัติคำขอที่ "รออนุมัติ" ทั้งหมด (${pendTxt} รายการ) ?`)) return;
  try {
    const res = await api('/api/travels/approve-all', { method: 'POST' });
    alert(`อนุมัติเรียบร้อยแล้ว ${Number(res.count || 0).toLocaleString()} รายการ`);
    await loadStats();
    loadAdminList(1);
  } catch (err) {
    alert(err.message);
  }
}

async function loadPersons() {
  const params = new URLSearchParams({
    q: document.getElementById('personSearchQ')?.value || '',
    department_id: document.getElementById('personDeptFilter')?.value || '',
    user_groups_id: document.getElementById('personGroupFilter')?.value || '',
  });
  const data = await api(`/api/persons?${params.toString()}`);
  document.getElementById('personsTbody').innerHTML = (data.items || []).map((p) => `
    <tr>
      <td><strong>${esc(p.full_name)}</strong><br><small style="color:#64748b">#${p.person_id} • <code>${esc(p.username || 'ไม่มี Username')}</code></small></td>
      <td>${esc(p.position_name || '-')}<br><small style="color:#64748b">${esc(p.department_name || '-')}</small></td>
      <td>
        <select id="pGrp_${p.person_id}" class="est-select">
          <option value="3" ${Number(p.user_groups_id) === 3 ? 'selected' : ''}>ผู้ใช้งานทั่วไป</option>
          <option value="2" ${Number(p.user_groups_id) === 2 ? 'selected' : ''}>ธุรการ (Admin)</option>
          <option value="1" ${Number(p.user_groups_id) === 1 ? 'selected' : ''}>ผู้ดูแลระบบ</option>
        </select>
      </td>
      <td style="text-align:center;"><button class="btn-aurora btn-sm" onclick="savePerson(${p.person_id}, this)">💾 บันทึก</button></td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px;color:#64748b;">ไม่พบข้อมูลบุคลากร</td></tr>';
}

async function savePerson(id, btn) {
  await api(`/api/persons/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ user_groups_id: document.getElementById(`pGrp_${id}`).value }),
  });
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✓ บันทึกแล้ว';
    setTimeout(() => { btn.textContent = old; }, 1500);
  }
}

async function loadTravelRates() {
  const q = document.getElementById('trSearchQ')?.value || '';
  const data = await api(`/api/travel-rates?q=${encodeURIComponent(q)}`);
  document.getElementById('travelRatesTbody').innerHTML = (data.items || []).map((r) => `
    <tr>
      <td><strong>${esc(r.province_name_th)}</strong></td>
      <td><input type="number" step="0.1" min="0" id="trDist_${r.id}" class="est-input" value="${Number(r.distance_roundtrip_km || 0)}" /></td>
      <td><input type="number" step="0.25" min="0" id="trCar_${r.id}" class="est-input" value="${Number(r.private_car_rate ?? 4)}" /></td>
      <td><input type="number" step="1" min="0" id="trBus_${r.id}" class="est-input" value="${Number(r.bus_fare || 0)}" /></td>
      <td><input type="number" step="1" min="0" id="trFlight_${r.id}" class="est-input" value="${Number(r.flight_fare || 0)}" /></td>
      <td><input type="number" step="1" min="0" id="trTrain_${r.id}" class="est-input" value="${Number(r.train_fare || 0)}" /></td>
      <td style="text-align:center;"><button class="btn-aurora btn-sm" onclick="saveTravelRate(${r.id}, this)">💾 บันทึก</button></td>
    </tr>
  `).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b;">ไม่พบข้อมูลจังหวัด</td></tr>';
}

async function saveTravelRate(id, btn) {
  await api(`/api/travel-rates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      distance_roundtrip_km: document.getElementById(`trDist_${id}`).value,
      private_car_rate: document.getElementById(`trCar_${id}`).value,
      bus_fare: document.getElementById(`trBus_${id}`).value,
      flight_fare: document.getElementById(`trFlight_${id}`).value,
      train_fare: document.getElementById(`trTrain_${id}`).value,
    }),
  });
  await loadMaster();
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✓ บันทึกแล้ว';
    setTimeout(() => { btn.textContent = old; }, 1500);
  }
}

// ==================== PDF PREVIEW (4 OFFICIAL FORMS) ====================
function openTravelPdf(id, form = 'memo_in', title = '') {
  state.pdfTravelId = id;
  state.pdfMode = 'travel';
  state.pdfForm = form;
  document.getElementById('pdfFormTabs').classList.remove('hidden');
  document.getElementById('pdfModalTitle').textContent = `เอกสารไปราชการ #${id} ${title ? `• ${title}` : ''}`;
  switchPdfForm(form);
  document.getElementById('pdfModal').classList.remove('hidden');
}

function switchPdfForm(form) {
  state.pdfForm = form;
  document.querySelectorAll('#pdfFormTabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.form === form));
  const url = `/api/travels/${state.pdfTravelId}/pdf?form=${form}`;
  document.getElementById('pdfDownloadBtn').href = `${url}&download=1`;
  document.getElementById('pdfNewTabBtn').href = url;
  document.getElementById('pdfFrame').src = url;
}

function openPdfModal(title, url) {
  state.pdfMode = 'single';
  document.getElementById('pdfFormTabs').classList.add('hidden');
  document.getElementById('pdfModalTitle').textContent = title;
  const sep = url.includes('?') ? '&' : '?';
  document.getElementById('pdfDownloadBtn').href = `${url}${sep}download=1`;
  document.getElementById('pdfNewTabBtn').href = url;
  document.getElementById('pdfFrame').src = url;
  document.getElementById('pdfModal').classList.remove('hidden');
}

function printBoard() {
  openPdfModal('รายงานทะเบียนคำขอไปราชการ A4', '/api/travels/board/pdf');
}

function closePdfModal() {
  document.getElementById('pdfFrame').src = 'about:blank';
  document.getElementById('pdfModal').classList.add('hidden');
}

function printPdfFrame() {
  const f = document.getElementById('pdfFrame');
  try { f.contentWindow.focus(); f.contentWindow.print(); }
  catch { window.open(document.getElementById('pdfNewTabBtn').href, '_blank'); }
}

function onTravelImageSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      document.getElementById('fImageData').value = dataUrl;
      document.getElementById('fImageName').value = file.name || 'image.jpg';
      document.getElementById('fImagePreview').src = dataUrl;
      document.getElementById('fImagePreviewWrap').classList.remove('hidden');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function removeTravelImage() {
  document.getElementById('fImageData').value = '__REMOVE__';
  document.getElementById('fImageName').value = '';
  document.getElementById('fImageFile').value = '';
  document.getElementById('fImagePreview').src = '';
  document.getElementById('fImagePreviewWrap').classList.add('hidden');
  document.getElementById('fDocPdfData').value = '';
  document.getElementById('fDocPdfName').value = '';
  document.getElementById('fDocPdfFile').value = '';
  document.getElementById('fDocPdfStatus').classList.add('hidden');
  document.getElementById('btnPreviewAttachedPdf').classList.add('hidden');
}

async function openTravelImageModal(id) {
  try {
    const data = await api(`/api/travels/${id}/image`);
    document.getElementById('travelImageModalTitle').textContent = `🖼️ ${data.subject || `รูปภาพ #${id}`}`;
    document.getElementById('travelImageModalImg').src = data.image_data;
    document.getElementById('travelImageModal').classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
}

function onDocPdfSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น');
    input.value = '';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    alert('ไฟล์ PDF มีขนาดใหญ่เกิน 8 MB กรุณาย่อขนาดไฟล์ก่อนอัปโหลด');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('fDocPdfData').value = reader.result;
    document.getElementById('fDocPdfName').value = file.name;
    document.getElementById('fDocPdfNameLabel').textContent = `📎 ${file.name}`;
    document.getElementById('fDocPdfStatus').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function removeDocPdf() {
  document.getElementById('fDocPdfData').value = '__REMOVE__';
  document.getElementById('fDocPdfName').value = '';
  document.getElementById('fDocPdfFile').value = '';
  document.getElementById('fDocPdfStatus').classList.add('hidden');
  document.getElementById('btnPreviewAttachedPdf').classList.add('hidden');
}

function previewAttachedDocPdf() {
  const id = document.getElementById('fRowId')?.value;
  if (id) openPdfModal(`หนังสือแนบ #${id}`, `/api/travels/${id}/doc-pdf`);
}

function openLoginModal() {
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

async function submitLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: document.getElementById('loginUser').value.trim(), password: document.getElementById('loginPass').value }),
    });
    await loadAuth();
    closeModal('loginModal');
    await loadStats();
    switchTab('mine');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  renderAuth();
  await loadStats();
  switchTab('list');
}

init();
