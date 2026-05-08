// ═══════════════════════════════════════════════════════════
//  SLOTS.JS
//  Entry point: initSlots()  — called by router.js
//  Cleanup:     destroySlots() — called by router.js on nav away
//
//  Key change from standalone version:
//  - MASTER_STUDENTS pulled from window.api.getStudents() instead
//    of hardcoded array
//  - Slot data still stored in JSON file via window.api.loadSlotData()
//    / saveSlotData() — maps to 'data:load' / 'data:save' IPC channels
//  - No inline onclick handlers anywhere — all addEventListener
//  - No DOMContentLoaded — init called by router
// ═══════════════════════════════════════════════════════════

// ── CONSTANTS ──────────────────────────────────────────────
const SLOT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOT_DSHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_DEFAULT_CAP = 5;

const SLOT_DEFAULTS = [
  { id: 's1', start: '07:00', end: '08:00', label: '7:00 AM – 8:00 AM', session: 'morning' },
  { id: 's2', start: '08:00', end: '09:00', label: '8:00 AM – 9:00 AM', session: 'morning' },
  { id: 's3', start: '17:00', end: '18:00', label: '5:00 PM – 6:00 PM', session: 'evening' },
  { id: 's4', start: '18:00', end: '19:00', label: '6:00 PM – 7:00 PM', session: 'evening' },
];

// ── MODULE STATE ────────────────────────────────────────────
let _slotData = null;
let _slotCurDay = null;
let _slotOpenPanel = null;
let _slotAddSeg = 'morning';
let _slotConfirmCb = null;
let _masterStudents = [];

// Edit slot state
let _editSlotId = null;
let _editCapacity = SLOT_DEFAULT_CAP;
let _editSeg = 'morning';
let _editDays = new Set();

// Picker state
let _pickerSlotId = null;
let _pickerSelected = new Set();

// ── ENTRY POINT ─────────────────────────────────────────────
async function initSlots() {
  // Reset all state
  _slotData = null; _slotCurDay = null; _slotOpenPanel = null;
  _slotAddSeg = 'morning'; _slotConfirmCb = null;
  _editSlotId = null; _pickerSlotId = null;
  _pickerSelected = new Set(); _editDays = new Set();

  // Load students from DB for the picker
  try { _masterStudents = (await window.api.getAllStudents()) || []; }
  catch (e) { _masterStudents = []; console.warn('[Slots] Could not load students:', e); }

  const safeBind = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    else console.error('[Slots] Element not found for binding:', id);
  };

  // Wire all static buttons
  safeBind('open-add-slot-btn', 'click', _openAddSlot);
  safeBind('export-schedule-btn', 'click', _confirmExport);

  safeBind('cancel-add-slot', 'click', _closeAddSlot);
  safeBind('confirm-add-slot', 'click', _doAddSlot);
  safeBind('add-seg-morning', 'click', () => _setAddSeg('morning'));
  safeBind('add-seg-evening', 'click', () => _setAddSeg('evening'));
  safeBind('ns-start', 'input', _updateAddPreview);
  safeBind('ns-end', 'input', _updateAddPreview);

  safeBind('cancel-edit-slot', 'click', _closeEditSlot);
  safeBind('save-edit-slot', 'click', _saveEditSlot);
  safeBind('delete-from-edit', 'click', _confirmDelFromEdit);
  safeBind('edit-seg-morning', 'click', () => _setEditSeg('morning'));
  safeBind('edit-seg-evening', 'click', () => _setEditSeg('evening'));
  safeBind('es-start', 'input', _updateEditPreview);
  safeBind('es-end', 'input', _updateEditPreview);
  safeBind('cap-minus', 'click', () => _changeCapacity(-1));
  safeBind('cap-plus', 'click', () => _changeCapacity(1));

  safeBind('cancel-picker', 'click', _closePicker);
  safeBind('confirm-picker', 'click', _confirmPicker);
  safeBind('picker-search', 'input', _renderPickerList);

  safeBind('cancel-slot-confirm', 'click', _closeConfirm);

  // Backdrop close for all modals
  // ESC-only close - backdrop click disabled
  // ['add-slot-modal', 'edit-slot-modal', 'slot-picker-modal', 'slot-confirm-modal'].forEach(id => {
  //   safeBind(id, 'click', (e) => {
  //     if (e.target.id === id) document.getElementById(id).classList.remove('active');
  //   });
  // });

  // Escape key
  document.addEventListener('keydown', _slotsKeyHandler);

  // Load data and render
  await _loadSlotData();
}

function destroySlots() {
  document.removeEventListener('keydown', _slotsKeyHandler);
}

function _slotsKeyHandler(e) {
  if (e.key === 'Escape') {
    ['add-slot-modal', 'edit-slot-modal', 'slot-picker-modal', 'slot-confirm-modal'].forEach(id => {
      document.getElementById(id).classList.remove('active');
    });
  }
  if (e.key === 'Enter') {
    // Don't trigger if in a textarea (none in slots.html currently, but for safety)
    if (document.activeElement.tagName === 'TEXTAREA') return;

    const addModal = document.getElementById('add-slot-modal');
    const editModal = document.getElementById('edit-slot-modal');
    const pickerModal = document.getElementById('slot-picker-modal');
    const confirmModal = document.getElementById('slot-confirm-modal');

    if (addModal.classList.contains('active')) {
      const btn = document.getElementById('confirm-add-slot');
      if (btn && !btn.disabled) { e.preventDefault(); _doAddSlot(); }
    } else if (editModal.classList.contains('active')) {
      const btn = document.getElementById('save-edit-slot');
      if (btn && !btn.disabled) { e.preventDefault(); _saveEditSlot(); }
    } else if (pickerModal.classList.contains('active')) {
      const btn = document.getElementById('confirm-picker');
      if (btn && !btn.disabled) { e.preventDefault(); _confirmPicker(); }
    } else if (confirmModal.classList.contains('active')) {
      const btn = document.getElementById('ok-slot-confirm');
      if (btn) { e.preventDefault(); btn.click(); }
    }
  }
}

// ── DATA ────────────────────────────────────────────────────
function _initSlotData() {
  const d = {};
  SLOT_DAYS.forEach(day => {
    d[day] = {
      slots: SLOT_DEFAULTS.map(s => ({ ...s })),
      students: SLOT_DEFAULTS.reduce((a, s) => ({ ...a, [s.id]: [] }), {})
    };
  });
  return d;
}

async function _loadSlotData() {
  try {
    const saved = await window.api.loadSlotData();
    _slotData = saved || _initSlotData();
  } catch (e) {
    console.warn('[Slots] Load failed, using defaults:', e);
    _slotData = _initSlotData();
  }
  
  await _syncDropdownSlots();

  _slotCurDay = SLOT_DAYS[_todayIdx()];
  _renderAll();
}

async function _syncDropdownSlots() {
  if (!_masterStudents || !_masterStudents.length) return;

  const dayMap = {
    'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
    'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
  };

  const normTime = (t) => String(t || '').replace(/–/g, '-').replace(/\s+/g, '').toLowerCase();

  let dirty = false;

  _masterStudents.forEach(stu => {
    const stuIdStr = String(stu.id);
    const expected = [];

    // Parse dropdown assigned slots from the student's DB slotId field
    if (stu.status !== 'Inactive' && stu.slotId && typeof stu.slotId === 'string' && stu.slotId.includes('|')) {
      const parts = stu.slotId.split(',').map(s => s.trim()).filter(s => s.includes('|'));
      parts.forEach(p => {
        const [sDay, sTime] = p.split('|');
        const fullDay = dayMap[sDay];
        if (fullDay && sTime) {
          expected.push({ day: fullDay, time: sTime });
        }
      });
    }

    // Now find or create the expected slot objects
    const expectedSlotIds = expected.map(exp => {
      const nt = normTime(exp.time);
      let found = _slotData[exp.day].slots.find(s => normTime(s.label) === nt);
      if (!found) {
        // Create custom slot on the fly
        let start = '00:00';
        let end = '01:00';
        let session = 'morning';
        const tMatch = exp.time.match(/(\d{1,2}:\d{2})\s*(AM|PM)\s*[-|–]\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
        if (tMatch) {
           const parse12 = (tStr, p) => {
             let [h, m] = tStr.split(':').map(Number);
             if (p.toUpperCase() === 'PM' && h < 12) h += 12;
             if (p.toUpperCase() === 'AM' && h === 12) h = 0;
             return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
           };
           start = parse12(tMatch[1], tMatch[2]);
           end = parse12(tMatch[3], tMatch[4]);
           session = parseInt(start.split(':')[0], 10) >= 12 ? 'evening' : 'morning';
        }
        found = {
          id: `cs_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          start, end, label: exp.time, session, capacity: SLOT_DEFAULT_CAP, custom: true
        };
        _slotData[exp.day].slots.push(found);
        _slotData[exp.day].students[found.id] = [];
        dirty = true;
      }
      return { day: exp.day, sId: found.id };
    });

    // Build a quick lookup: "day|slotId" → true for expected enrollments
    const expectedKeys = new Set(expectedSlotIds.map(ts => `${ts.day}|${ts.sId}`));

    // REMOVE student from any slot/day they're NOT supposed to be in
    SLOT_DAYS.forEach(day => {
      if (!_slotData[day]) return;
      for (const [sId, enrolled] of Object.entries(_slotData[day].students)) {
        if (!Array.isArray(enrolled)) continue;
        const key = `${day}|${sId}`;
        if (!expectedKeys.has(key) && enrolled.includes(stuIdStr)) {
          _slotData[day].students[sId] = enrolled.filter(x => x !== stuIdStr);
          dirty = true;
        }
      }
    });

    // ADD student to expected slots they're missing from
    expectedSlotIds.forEach(ts => {
      if (!_slotData[ts.day].students[ts.sId]) {
        _slotData[ts.day].students[ts.sId] = [];
      }
      if (!_slotData[ts.day].students[ts.sId].includes(stuIdStr)) {
        _slotData[ts.day].students[ts.sId].push(stuIdStr);
        dirty = true;
      }
    });

  });

  if (dirty) {
    await _saveSlotData();
  }
}


async function _saveSlotData() {
  try { await window.api.saveSlotData(_slotData); }
  catch (e) { console.error('[Slots] Save error:', e); }
}


// ── RENDER ──────────────────────────────────────────────────
function _renderAll() { _renderDayTabs(); _renderStats(); _renderTable(); }

function _renderDayTabs() {
  const c = document.getElementById('slot-day-tabs'); c.innerHTML = '';
  SLOT_DAYS.forEach((day, i) => {
    const en = Object.values(_slotData[day].students).flat().length;
    const cap = _slotData[day].slots.length * SLOT_DEFAULT_CAP;
    const btn = document.createElement('button');
    btn.className = 'day-tab' + (day === _slotCurDay ? ' active' : '');
    btn.innerHTML = `${SLOT_DSHORT[i]}${i === _todayIdx() ? ' <span class="today-dot">●</span>' : ''}<span class="day-tab-count">${en}/${cap}</span>`;
    btn.addEventListener('click', () => { _slotCurDay = day; _slotOpenPanel = null; _renderAll(); });
    c.appendChild(btn);
  });
}

function _renderStats() {
  let totalCap = 0, totalEnrolled = 0, totalSlots = 0;
  SLOT_DAYS.forEach(day => {
    totalSlots += _slotData[day].slots.length;
    totalCap += _slotData[day].slots.reduce((s, sl) => s + _slotCap(sl), 0);
    totalEnrolled += Object.values(_slotData[day].students).flat().length;
  });
  const remaining = totalCap - totalEnrolled;
  const util = totalCap > 0 ? Math.round(totalEnrolled / totalCap * 100) : 0;

  document.getElementById('slot-stats-grid').innerHTML = `
    <div class="slot-stat blue">
      <div><div class="ss-label">Total Capacity</div><div class="ss-val">${totalCap}</div><div class="ss-sub">${totalSlots} slots · all days</div></div>
      <div class="ss-icon si-blue">👥</div>
    </div>
    <div class="slot-stat green">
      <div><div class="ss-label">Filled Seats</div><div class="ss-val">${totalEnrolled}</div><div class="ss-sub">students enrolled</div></div>
      <div class="ss-icon si-green">📊</div>
    </div>
    <div class="slot-stat orange">
      <div><div class="ss-label">Remaining</div><div class="ss-val">${remaining}</div><div class="ss-sub">seats available</div></div>
      <div class="ss-icon si-orange">🕐</div>
    </div>
    <div class="slot-stat purple">
      <div><div class="ss-label">Utilization</div><div class="ss-val">${util}%</div><div class="ss-sub">overall fill rate</div></div>
      <div class="ss-icon si-purple">📈</div>
    </div>`;

  document.getElementById('util-pct-label').textContent = util + '%';
  requestAnimationFrame(() => { document.getElementById('util-fill').style.width = util + '%'; });
}

function _renderTable() {
  const dd = _slotData[_slotCurDay];
  const slots = dd.slots;
  document.getElementById('slot-tbl-title').textContent = `${_slotCurDay} — Slot Schedule`;
  document.getElementById('slot-tbl-sub').textContent =
    `${slots.length} slots · ${Object.values(dd.students).flat().length}/${slots.reduce((s, sl) => s + _slotCap(sl), 0)} students enrolled`;

  const tbody = document.getElementById('slot-tbody'); tbody.innerHTML = '';
  if (!slots.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><span style="font-size:32px;display:block;margin-bottom:8px">📭</span>No slots for ${_slotCurDay}. Click "+ Add Slot" to create one.</td></tr>`;
    return;
  }

  slots.forEach((slot, idx) => {
    const cap = _slotCap(slot);
    const sts = dd.students[slot.id] || [];
    const pct = sts.length / cap * 100;
    const bc = _barColor(sts.length, cap);
    const full = sts.length >= cap;
    const filling = sts.length >= Math.ceil(cap * 0.6);
    const stClass = full ? 's-full' : filling ? 's-fill' : 's-avail';
    const stLabel = full ? 'Full' : filling ? 'Filling' : 'Available';
    const isOpen = _slotOpenPanel === slot.id;

    const tr = document.createElement('tr');
    tr.className = 'row-anim';
    tr.style.animationDelay = `${0.36 + (idx * 0.05)}s`;
    tr.innerHTML = `
      <td><div class="slot-time">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7b8299" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${slot.label}
      </div></td>
      <td><span class="sess-badge sess-${slot.session}">${slot.session === 'morning' ? '☀️ Morning' : '🌇 Evening'}</span>${slot.custom ? '<span class="custom-chip">Custom</span>' : ''}</td>
      <td class="hide-mobile"><strong>${cap}</strong> <span style="color:var(--muted);font-size:12px">seats</span></td>
      <td><strong style="color:${bc};font-size:15px">${sts.length}</strong><span style="color:var(--muted);font-size:12px"> / ${cap}</span></td>
      <td><div class="fill-row">
        <div class="fill-track"><div class="fill-bar" style="width:${Math.min(pct, 100)}%;background:${bc}"></div></div>
        <span class="fill-pct" style="color:${bc}">${Math.round(pct)}%</span>
      </div></td>
      <td><span class="sbadge ${stClass}">${stLabel}</span></td>
      <td><div class="act-cell">
        <button class="abtn abtn-edit" data-edit="${slot.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="abtn" data-manage="${slot.id}">${isOpen ? 'Hide' : 'Manage'}</button>
      </div></td>`;
    tbody.appendChild(tr);

    // Wire action buttons with addEventListener (no inline onclick)
    tr.querySelector('[data-edit]').addEventListener('click', () => _openEditSlot(slot.id));
    tr.querySelector('[data-manage]').addEventListener('click', () => _togglePanel(slot.id));
    if (slot.custom) {
      const delBtn = tr.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', () => _confirmDeleteSlot(slot.id));
    }

    // Panel row
    const panelTr = document.createElement('tr');
    panelTr.className = 'slot-panel-row';
    panelTr.innerHTML = `<td colspan="7" style="padding:0"><div class="sp-panel${isOpen ? ' open' : ''}" id="panel-${slot.id}"></div></td>`;
    tbody.appendChild(panelTr);
    if (isOpen) _buildPanel(slot);
  });
}

function _buildPanel(slot) {
  const cap = _slotCap(slot);
  const sts = _slotData[_slotCurDay].students[slot.id] || [];
  const pct = sts.length / cap * 100;
  const bc = _barColor(sts.length, cap);
  const full = sts.length >= cap;
  const el = document.getElementById(`panel-${slot.id}`);
  if (!el) return;

  const stuRows = sts.map((stuId, i) => {
    const s = _masterStudents.find(x => String(x.id) === String(stuId)) ||
      { firstName: stuId, lastName: '', studentId: stuId, phone: '—' };
    const first = s.firstName || '';
    const last = s.lastName || '';
    const name = `${first} ${last}`.trim() || stuId;
    const sId = s.studentId || stuId;

    // Standardized initials
    let init = '??';
    if (first && last) init = (first[0] + last[0]).toUpperCase();
    else if (first) {
      const parts = first.trim().split(/\s+/);
      if (parts.length > 1) init = (parts[0][0] + parts[1][0]).toUpperCase();
      else init = first.slice(0, 2).toUpperCase();
    } else if (last) init = last.slice(0, 2).toUpperCase();

    // Standardized color
    const colors = ['#F97316', '#7C3AED', '#0D9488', '#EC4899', '#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#6366F1', '#F43F5E'];
    const seed = `${first} ${last} ${sId}`.trim().toLowerCase();
    let hash = 0;
    for (let j = 0; j < seed.length; j++) { hash = ((hash << 5) - hash) + seed.charCodeAt(j); hash |= 0; }
    const avatarBg = colors[Math.abs(hash) % colors.length];

    const avatarHtml = s.photo_path 
      ? `<img src="file://${s.photo_path}" class="stu-avatar-sm" style="width:32px; height:32px; border-radius: 22%; object-fit: cover;" />`
      : `<div class="stu-avatar-sm" style="background:${avatarBg}; border-radius: 22%; color: #fff; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; font-size: 11px;">${init}</div>`;

    return `<tr>
      <td style="color:var(--muted);font-weight:700;font-size:12px">${String(i + 1).padStart(2, '0')}</td>
      <td><div style="display:flex;align-items:center;gap:10px">
        ${avatarHtml}
        <div><div class="stu-name-sm">${name}</div><div class="stu-id-sm">${sId}</div></div>
      </div></td>
      <td><code class="id-chip">${sId}</code></td>
      <td style="font-size:12px;color:var(--muted)">📱 ${s.phone || '—'}</td>
      <td><button class="rm-btn" data-rm-slot="${slot.id}" data-rm-stu="${stuId}" data-rm-name="${name.replace(/"/g, '&quot;')}">Remove</button></td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="sp-inner">
    <div class="sp-top">
      <div class="sp-info">
        <h3>${slot.label} — ${slot.session === 'morning' ? '☀️ Morning' : '🌇 Evening'}</h3>
        <p>${_slotCurDay} · Max ${cap} students per slot</p>
      </div>
      <div class="sp-counters">
        <div class="spc"><div class="spc-val" style="color:${bc}">${sts.length}</div><div class="spc-lbl">Enrolled</div></div>
        <div class="spc"><div class="spc-val" style="color:#22c55e">${cap - sts.length}</div><div class="spc-lbl">Available</div></div>
        <div class="spc"><div class="spc-val" style="color:${bc}">${Math.round(pct)}%</div><div class="spc-lbl">Fill Rate</div></div>
      </div>
    </div>
    <div class="prog-section">
      <div class="prog-label"><span>Enrollment Progress</span><span style="color:${bc};font-weight:800">${sts.length}/${cap} seats filled</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${Math.min(pct, 100)}%;background:${bc}"></div></div>
    </div>
    <div class="enrolled-head">Enrolled Students (${sts.length})</div>
    ${sts.length === 0
      ? `<div class="no-students">👥 No students enrolled yet. Click "Add Students" below.</div>`
      : `<table class="enr-table"><thead><tr><th>#</th><th>Student</th><th>ID</th><th>Contact</th><th>Action</th></tr></thead><tbody>${stuRows}</tbody></table>`
    }
    ${full
      ? `<div class="full-banner">🚫 This slot is full — all ${cap} seats have been taken</div>`
      : `<button class="btn btn-primary add-stu-btn" data-add-stu="${slot.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
          Add Students
        </button>`
    }
  </div>`;

  // Wire remove + add buttons
  el.querySelectorAll('[data-rm-slot]').forEach(btn => {
    btn.addEventListener('click', () => _confirmRemoveStudent(btn.dataset.rmSlot, btn.dataset.rmStu, btn.dataset.rmName));
  });
  const addBtn = el.querySelector('[data-add-stu]');
  if (addBtn) addBtn.addEventListener('click', () => _openPicker(slot.id));
}

function _togglePanel(id) {
  _slotOpenPanel = _slotOpenPanel === id ? null : id;
  _renderTable();
  if (_slotOpenPanel) {
    setTimeout(() => {
      const el = document.getElementById(`panel-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }
}

// ── ADD SLOT ────────────────────────────────────────────────
function _openAddSlot() {
  document.getElementById('ns-start').value = '';
  document.getElementById('ns-end').value = '';
  _slotAddSeg = 'morning';
  document.getElementById('add-seg-morning').classList.add('active');
  document.getElementById('add-seg-evening').classList.remove('active');

  const dc = document.getElementById('add-day-checks'); dc.innerHTML = '';
  SLOT_DAYS.forEach((day, i) => {
    const lbl = document.createElement('label');
    lbl.className = 'day-check-label';
    lbl.innerHTML = `<input type="checkbox" value="${day}">${SLOT_DSHORT[i]}`;
    lbl.querySelector('input').addEventListener('change', (e) => {
      lbl.classList.toggle('checked', e.target.checked);
      _updateAddPreview();
    });
    dc.appendChild(lbl);
  });
  _updateAddPreview();
  document.getElementById('add-slot-modal').classList.add('active');
}

function _closeAddSlot() { document.getElementById('add-slot-modal').classList.remove('active'); }

function _setAddSeg(s) {
  _slotAddSeg = s;
  document.getElementById('add-seg-morning').classList.toggle('active', s === 'morning');
  document.getElementById('add-seg-evening').classList.toggle('active', s === 'evening');
  _updateAddPreview();
}

function _updateAddPreview() {
  const s = document.getElementById('ns-start').value;
  const e = document.getElementById('ns-end').value;
  const days = [...document.querySelectorAll('#add-day-checks input:checked')].map(x => x.value);
  const ok = s && e && s < e && days.length > 0;
  document.getElementById('confirm-add-slot').disabled = !ok;
  const prev = document.getElementById('add-preview');
  if (ok) {
    prev.style.display = 'block';
    prev.innerHTML = `<strong>${_fmt12(s)} – ${_fmt12(e)}</strong> · ${_slotAddSeg === 'morning' ? '☀️ Morning' : '🌇 Evening'} · ${days.map(d => SLOT_DSHORT[SLOT_DAYS.indexOf(d)]).join(', ')} · ${SLOT_DEFAULT_CAP} seats`;
  } else {
    prev.style.display = 'none';
  }
}

function _doAddSlot() {
  const s = document.getElementById('ns-start').value;
  const e = document.getElementById('ns-end').value;
  const days = [...document.querySelectorAll('#add-day-checks input:checked')].map(x => x.value);
  if (!s || !e || s >= e || !days.length) { showToast('Please fill all fields and select at least one day', 'error'); return; }
  const id = `c_${Date.now()}`;
  const slot = { id, start: s, end: e, label: `${_fmt12(s)} – ${_fmt12(e)}`, session: _slotAddSeg, custom: true };
  days.forEach(day => { _slotData[day].slots.push({ ...slot }); _slotData[day].students[id] = []; });
  _saveSlotData();
  _closeAddSlot();
  showToast(`Slot added to ${days.length} day${days.length > 1 ? 's' : ''}!`, 'success');
  _renderAll();
}

// ── EDIT SLOT ───────────────────────────────────────────────
function _openEditSlot(slotId) {
  _editSlotId = slotId;
  _editDays = new Set([_slotCurDay]);
  const slot = _slotData[_slotCurDay].slots.find(s => s.id === slotId);
  if (!slot) return;

  const existsOnDays = SLOT_DAYS.filter(day => _slotData[day].slots.some(s => s.id === slotId));
  const totalEnrolled = existsOnDays.reduce((sum, day) => sum + (_slotData[day].students[slotId] || []).length, 0);
  const maxEnrolled = existsOnDays.reduce((mx, day) => Math.max(mx, (_slotData[day].students[slotId] || []).length), 0);
  _editCapacity = slot.capacity || SLOT_DEFAULT_CAP;
  _editSeg = slot.session;

  document.getElementById('edit-slot-sub').innerHTML =
    `Editing: <strong>${slot.label}</strong> &nbsp;·&nbsp; ${existsOnDays.length} day(s) &nbsp;·&nbsp; ${totalEnrolled} students enrolled`;

  document.getElementById('edit-info-row').innerHTML = `
    <div class="edit-info-chip">🗓️ Exists on: ${existsOnDays.map(d => SLOT_DSHORT[SLOT_DAYS.indexOf(d)]).join(', ')}</div>
    <div class="edit-info-chip">👥 ${totalEnrolled} enrolled</div>
    <div class="edit-info-chip" style="color:${slot.custom ? 'var(--purple)' : 'var(--blue)'}">
      ${slot.custom ? '⚡ Custom Slot' : '📌 Default Slot'}
    </div>`;

  document.getElementById('es-start').value = slot.start;
  document.getElementById('es-end').value = slot.end;
  document.getElementById('edit-seg-morning').classList.toggle('active', slot.session === 'morning');
  document.getElementById('edit-seg-evening').classList.toggle('active', slot.session === 'evening');
  document.getElementById('cap-display').textContent = _editCapacity;
  document.getElementById('cap-note').textContent = maxEnrolled > 0 ? `⚠ ${maxEnrolled} student(s) already enrolled` : '';

  _buildEditDayGrid(slotId);
  _updateEditPreview();
  document.getElementById('edit-slot-modal').classList.add('active');
}

function _closeEditSlot() { document.getElementById('edit-slot-modal').classList.remove('active'); _editSlotId = null; }

function _buildEditDayGrid(slotId) {
  const grid = document.getElementById('edit-day-grid'); grid.innerHTML = '';
  SLOT_DAYS.forEach((day, i) => {
    const exists = _slotData[day].slots.some(s => s.id === slotId);
    const isOn = _editDays.has(day);
    const btn = document.createElement('button');
    btn.className = 'day-apply-btn' + (isOn ? ' on' : '');
    btn.style.opacity = exists ? '1' : '0.35';
    btn.title = exists ? day : `Slot does not exist on ${day}`;
    btn.textContent = SLOT_DSHORT[i];
    if (exists) {
      btn.addEventListener('click', () => {
        if (_editDays.has(day)) _editDays.delete(day);
        else _editDays.add(day);
        _buildEditDayGrid(slotId);
        _updateEditPreview();
      });
    }
    grid.appendChild(btn);
  });
}

function _setEditSeg(s) {
  _editSeg = s;
  document.getElementById('edit-seg-morning').classList.toggle('active', s === 'morning');
  document.getElementById('edit-seg-evening').classList.toggle('active', s === 'evening');
  _updateEditPreview();
}

function _changeCapacity(delta) {
  const maxEnrolled = SLOT_DAYS.reduce((mx, day) => {
    if (!_slotData[day].slots.some(s => s.id === _editSlotId)) return mx;
    return Math.max(mx, (_slotData[day].students[_editSlotId] || []).length);
  }, 0);
  const next = _editCapacity + delta;
  if (next < 1) { showToast('Capacity must be at least 1', 'error'); return; }
  if (next < maxEnrolled) { showToast(`Can't go below ${maxEnrolled} — students already enrolled`, 'error'); return; }
  _editCapacity = next;
  document.getElementById('cap-display').textContent = _editCapacity;
  _updateEditPreview();
}

function _updateEditPreview() {
  const s = document.getElementById('es-start').value;
  const e = document.getElementById('es-end').value;
  const days = [..._editDays];
  const ok = s && e && s < e && days.length > 0;
  document.getElementById('save-edit-slot').disabled = !ok;
  const prev = document.getElementById('edit-preview');
  if (ok) {
    prev.style.display = 'block';
    prev.innerHTML = `<strong>${_fmt12(s)} – ${_fmt12(e)}</strong> · ${_editSeg === 'morning' ? '☀️ Morning' : '🌇 Evening'} · ${days.map(d => SLOT_DSHORT[SLOT_DAYS.indexOf(d)]).join(', ')} · ${_editCapacity} seats`;
  } else {
    prev.style.display = 'none';
  }
}

async function _saveEditSlot() {
  const s = document.getElementById('es-start').value;
  const e = document.getElementById('es-end').value;
  const days = [..._editDays];
  if (!s || !e || s >= e || !days.length) { showToast('Please fill all fields and select at least one day', 'error'); return; }
  const newLabel = `${_fmt12(s)} – ${_fmt12(e)}`;
  const daysSelectedSet = new Set(days);

  // Preserve the custom flag from the current slot instance if it exists
  let isCustom = false;
  SLOT_DAYS.forEach(day => {
    const existing = _slotData[day].slots.find(sl => sl.id === _editSlotId);
    if (existing && existing.custom) isCustom = true;
  });

  SLOT_DAYS.forEach(day => {
    const idx = _slotData[day].slots.findIndex(sl => sl.id === _editSlotId);
    if (daysSelectedSet.has(day)) {
      if (idx !== -1) {
        _slotData[day].slots[idx] = { ..._slotData[day].slots[idx], start: s, end: e, label: newLabel, session: _editSeg, capacity: _editCapacity };
      } else {
        _slotData[day].slots.push({ id: _editSlotId, start: s, end: e, label: newLabel, session: _editSeg, capacity: _editCapacity, custom: isCustom });
        if (!_slotData[day].students[_editSlotId]) _slotData[day].students[_editSlotId] = [];
      }
    } else {
      if (idx !== -1) {
        _slotData[day].slots.splice(idx, 1);
        delete _slotData[day].students[_editSlotId];
      }
    }
  });

  await _saveSlotData();
  await _syncAllStudentsToSlots();
  _closeEditSlot();
  showToast(`Slot updated on ${days.length} day${days.length > 1 ? 's' : ''}`, 'success');
  _renderAll();
}

function _confirmDelFromEdit() { const id = _editSlotId; _closeEditSlot(); _confirmDeleteSlot(id); }

// ── STUDENT PICKER ──────────────────────────────────────────
function _openPicker(slotId) {
  _pickerSlotId = slotId;
  _pickerSelected = new Set();
  const slot = _slotData[_slotCurDay].slots.find(s => s.id === slotId);
  const sts = _slotData[_slotCurDay].students[slotId] || [];
  const cap = _slotCap(slot);
  const avail = cap - sts.length;
  document.getElementById('picker-sub').innerHTML =
    `Slot: <strong>${slot.label}</strong> · ${sts.length}/${cap} enrolled · <strong>${avail} seat${avail !== 1 ? 's' : ''}</strong> remaining`;
  document.getElementById('picker-search').value = '';
  document.getElementById('slot-picker-modal').classList.add('active');
  _renderPickerList();
}

function _closePicker() {
  document.getElementById('slot-picker-modal').classList.remove('active');
  _pickerSlotId = null; _pickerSelected = new Set();
}

function _renderPickerList() {
  const q = document.getElementById('picker-search').value.toLowerCase();
  const enrolled = (_slotData[_slotCurDay].students[_pickerSlotId] || []).map(String);
  const slot = _slotData[_slotCurDay].slots.find(s => s.id === _pickerSlotId);
  const cap = _slotCap(slot);
  const avail = cap - enrolled.length;

  // Use DB students (only active); fall back to showing IDs already enrolled if list is empty
  const pool = _masterStudents.length > 0 ? _masterStudents.filter(s => s.status !== 'Inactive') : [];
  const filtered = pool.filter(s => {
    const name = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
    const id = (s.studentId || String(s.id) || '').toLowerCase();
    return !q || name.includes(q) || id.includes(q);
  });

  const list = document.getElementById('picker-list');
  if (!filtered.length) {
    list.innerHTML = `<div class="no-results">🔍 No students found${_masterStudents.length === 0 ? ' — add students in the Students module first' : ''}.</div>`;
    _updatePickerCount();
    return;
  }

  list.innerHTML = filtered.map(s => {
    const sid = String(s.id);
    const isEnrolled = enrolled.includes(sid);
    const isSel = _pickerSelected.has(sid);
    const disabled = isEnrolled || (!isSel && _pickerSelected.size >= avail);
    
    const first = s.firstName || '';
    const last = s.lastName || '';
    const sIdDisplay = s.studentId || s.id;
    const fullName = `${first} ${last}`.trim();

    // Standardized initials
    let init = '??';
    if (first && last) init = (first[0] + last[0]).toUpperCase();
    else if (first) {
      const parts = first.trim().split(/\s+/);
      if (parts.length > 1) init = (parts[0][0] + parts[1][0]).toUpperCase();
      else init = first.slice(0, 2).toUpperCase();
    } else if (last) init = last.slice(0, 2).toUpperCase();

    // Standardized color
    const colors = ['#F97316', '#7C3AED', '#0D9488', '#EC4899', '#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#6366F1', '#F43F5E'];
    const seed = `${first} ${last} ${sIdDisplay}`.trim().toLowerCase();
    let hash = 0;
    for (let j = 0; j < seed.length; j++) { hash = ((hash << 5) - hash) + seed.charCodeAt(j); hash |= 0; }
    const avatarBg = colors[Math.abs(hash) % colors.length];

    const avatarHtml = s.photo_path 
      ? `<img src="file://${s.photo_path}" class="pi-avatar" style="width:32px; height:32px; border-radius: 22%; object-fit: cover;" />`
      : `<div class="pi-avatar" style="background:${avatarBg}; border-radius: 22%; color: #fff; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; font-size: 11px;">${init}</div>`;

    return `<div class="picker-item${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}" data-pid="${sid}">
      <div class="pi-chk">${isSel ? '✓' : ''}</div>
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div class="pi-name">${fullName}</div>
        <div class="pi-info">${sIdDisplay}${s.class ? ' · Class ' + s.class : ''}</div>
      </div>
      <span class="pi-badge ${isEnrolled ? 'pi-enrolled' : 'pi-avail'}">${isEnrolled ? '✓ Enrolled' : 'Available'}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.picker-item:not(.disabled)').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.pid;
      if (_pickerSelected.has(id)) _pickerSelected.delete(id);
      else _pickerSelected.add(id);
      _renderPickerList();
    });
  });
  _updatePickerCount();
}

function _updatePickerCount() {
  const enrolled = _slotData[_slotCurDay].students[_pickerSlotId] || [];
  const slot = _slotData[_slotCurDay].slots.find(s => s.id === _pickerSlotId);
  const avail = _slotCap(slot) - enrolled.length;
  document.getElementById('picker-count').innerHTML =
    `<span>${_pickerSelected.size}</span> selected · ${avail} seat${avail !== 1 ? 's' : ''} available`;
  document.getElementById('confirm-picker').disabled = _pickerSelected.size === 0;
}

async function _confirmPicker() {
  const enrolled = (_slotData[_slotCurDay].students[_pickerSlotId] || []).map(String);
  const slot = _slotData[_slotCurDay].slots.find(s => s.id === _pickerSlotId);
  const cap = _slotCap(slot);
  const newList = [...enrolled, ...Array.from(_pickerSelected)];
  if (newList.length > cap) { showToast('Exceeds slot capacity!', 'error'); return; }
  _slotData[_slotCurDay].students[_pickerSlotId] = newList;
  await _saveSlotData();
  await _syncAllStudentsToSlots();
  showToast(`${_pickerSelected.size} student${_pickerSelected.size !== 1 ? 's' : ''} enrolled`, 'success');
  _closePicker();
  _renderAll();
  if (_slotOpenPanel === _pickerSlotId) {
    setTimeout(() => {
      const sl = _slotData[_slotCurDay].slots.find(s => s.id === _pickerSlotId);
      if (sl) _buildPanel(sl);
    }, 80);
  }
}

// ── REMOVE STUDENT ──────────────────────────────────────────
function _confirmRemoveStudent(slotId, stuId, name) {
  _showConfirm('Remove Student?',
    `Remove <strong>${name}</strong> from this slot on <strong>${_slotCurDay}</strong>? Other days are not affected.`,
    async () => {
      _slotData[_slotCurDay].students[slotId] =
        (_slotData[_slotCurDay].students[slotId] || []).filter(x => String(x) !== String(stuId));
      await _saveSlotData();
      await _syncAllStudentsToSlots();
      showToast(`${name} removed`, 'info');
      _renderAll();
      if (_slotOpenPanel === slotId) {
        setTimeout(() => { const sl = _slotData[_slotCurDay].slots.find(s => s.id === slotId); if (sl) _buildPanel(sl); }, 80);
      }
    }
  );
}

// ── DELETE SLOT ─────────────────────────────────────────────
function _confirmDeleteSlot(slotId) {
  _showConfirm('Delete Slot?',
    'This will delete the slot from all days it was applied to, including all enrolled students. This cannot be undone.',
    async () => {
      SLOT_DAYS.forEach(day => {
        const { [slotId]: _, ...rest } = _slotData[day].students;
        _slotData[day].slots = _slotData[day].slots.filter(s => s.id !== slotId);
        _slotData[day].students = rest;
      });
      if (_slotOpenPanel === slotId) _slotOpenPanel = null;
      await _saveSlotData();
      await _syncAllStudentsToSlots();
      showToast('Slot deleted', 'info');
      _renderAll();
    }
  );
}

// ── SYNCHRONIZE DB ──────────────────────────────────────────
async function _syncAllStudentsToSlots() {
  if (!_masterStudents || !_masterStudents.length) return;
  const updates = [];
  
  _masterStudents.forEach(stu => {
    const stuIdStr = String(stu.id);
    const newSlots = [];

    SLOT_DAYS.forEach(day => {
      if (!_slotData[day]) return;
      for (const [sId, enrolled] of Object.entries(_slotData[day].students)) {
        if (Array.isArray(enrolled) && enrolled.includes(stuIdStr)) {
          const slotObj = _slotData[day].slots.find(s => s.id === sId) || Object.values(_slotData).flatMap(d => d.slots).find(s => s.id === sId);
          if (slotObj) {
             const dayShort = SLOT_DSHORT[SLOT_DAYS.indexOf(day)];
             const t = slotObj.label || (slotObj.start ? _fmt12(slotObj.start) + ' - ' + _fmt12(slotObj.end) : '');
             newSlots.push(`${dayShort}|${t}`);
          }
        }
      }
    });

    const newSlotIdStr = newSlots.join(', ');
    
    // Sort array elements to compare sets simply
    const oldSetStr = (stu.slotId || '').split(',').map(s => s.trim()).filter(Boolean).sort().join(',');
    const newSetStr = newSlots.sort().join(',');
    
    if (oldSetStr !== newSetStr) {
       stu.slotId = newSlotIdStr; // Update local memory immediately
       updates.push({ id: stu.id, slotId: newSlotIdStr });
    }
  });

  for (const up of updates) {
    try { await window.api.updateStudent(up.id, { slotId: up.slotId }); }
    catch(e) { console.error('Failed syncing student slot:', e); }
  }
}

// ── CONFIRM MODAL ───────────────────────────────────────────
function _showConfirm(title, msg, cb) {
  document.getElementById('slot-confirm-title').textContent = title;
  document.getElementById('slot-confirm-msg').innerHTML = msg;
  document.getElementById('slot-confirm-modal').classList.add('active');
  _slotConfirmCb = cb;
  const okBtn = document.getElementById('ok-slot-confirm');
  // Remove previous listener to avoid stacking
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.addEventListener('click', () => { 
    if (_slotConfirmCb) {
      const cb = _slotConfirmCb;
      _closeConfirm(); 
      cb();
    } else {
      _closeConfirm();
    }
  });
}
function _closeConfirm() {
  document.getElementById('slot-confirm-modal').classList.remove('active');
  _slotConfirmCb = null;
}

// ── EXPORT TO PDF ───────────────────────────────────────────
function _confirmExport() {
  _showConfirm(
    'Export Slot Schedule?',
    'This will generate a formatted PDF containing all time slots and enrolled students for all days. You can use this for manual attendance and sign-offs.',
    _exportSchedule
  );
}

async function _exportSchedule() {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    const purpleMain = [91, 33, 182];    // #5B21B6
    const purpleLight = [245, 243, 255]; // #F5F3FF
    const greyBorder = [229, 231, 235];  // #E5E7EB
    
    const dateStr = new Date().toLocaleDateString('en-GB', { 
      day: '2-digit', month: 'short', year: 'numeric'
    });

    doc.setTextColor(30, 27, 75);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Slot Management Schedule', 14, 17);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Exported: ${dateStr}`, 155, 17);

    // ── PREPARE DATA ──
    const tableBody = [];
    
    SLOT_DAYS.forEach(day => {
      const daySlots = (_slotData[day].slots || []).sort((a, b) => a.start.localeCompare(b.start));
      if (daySlots.length === 0) return;

      // DAY HEADER
      tableBody.push([
        { 
          content: day.toUpperCase(), 
          colSpan: 2, 
          styles: { 
            fillColor: purpleMain, 
            textColor: 255, 
            fontStyle: 'bold', 
            halign: 'center',
            fontSize: 11,
            padding: 3
          } 
        }
      ]);

      daySlots.forEach(slot => {
        const enrolledIds = _slotData[day].students[slot.id] || [];
        
        // SLOT SUB-HEADER
        tableBody.push([
          { 
            content: `⏰ ${slot.label}`, 
            colSpan: 2, 
            styles: { 
              fillColor: purpleLight, 
              textColor: purpleMain, 
              fontStyle: 'bold',
              padding: 2.5,
              fontSize: 10
            } 
          }
        ]);

        // Get student strings
        const studentStrings = enrolledIds.map((stuId, idx) => {
          const s = _masterStudents.find(x => String(x.id) === String(stuId));
          const name = s ? `${s.firstName || ''} ${s.lastName || ''}`.trim() : `ID: ${stuId}`;
          const roll = s ? (s.rollNumber || s.studentId || '—') : '—';
          return `${idx + 1}. ${name} (Roll: ${roll})`;
        });

        // Add 3 blank rows for manual entry
        const startBlankCount = studentStrings.length + 1;
        for (let i = 0; i < 3; i++) {
          studentStrings.push(`${startBlankCount + i}. [ ____________________ ]`);
        }

        // Chunk into 2-column grid
        for (let i = 0; i < studentStrings.length; i += 2) {
          tableBody.push([
            { content: studentStrings[i] || '', styles: { minCellHeight: 10, halign: 'left' } },
            { content: studentStrings[i+1] || '', styles: { minCellHeight: 10, halign: 'left' } }
          ]);
        }
        
        // Notes area for this slot
        tableBody.push([
          { 
            content: 'Observations: ____________________________________________________________________________________', 
            colSpan: 2, 
            styles: { 
              minCellHeight: 14, 
              textColor: [160, 160, 160], 
              fontSize: 8,
              valign: 'top',
              padding: 3
            } 
          }
        ]);
      });
    });

    // ── GENERATE TABLE ──
    doc.autoTable({
      startY: 28,
      body: tableBody,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 2,
        lineColor: greyBorder,
        lineWidth: 0.1,
        valign: 'middle'
      },
      columnStyles: {
        0: { cellWidth: 91 },
        1: { cellWidth: 91 }
      },
      margin: { left: 14, right: 14, bottom: 20 },
      pageBreak: 'auto',
      rowPageBreak: 'avoid', // Prevent breaking inside a student row or header
      didDrawPage: (data) => {
        doc.setFontSize(8);
        doc.setTextColor(180);
        const pageCount = doc.internal.getNumberOfPages();
        doc.text(`Page ${data.pageNumber} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }
    });

    // Save
    doc.save(`Slot_Schedule_${new Date().toISOString().split('T')[0]}.pdf`);
    
    // Success Pop-up
    _showConfirm(
      'Export Complete',
      'The Compact Schedule has been generated. It uses a smart grid layout to save paper while keeping plenty of room for your manual notes.',
      () => {}
    );
    document.getElementById('ok-slot-confirm').textContent = 'Perfect';
    document.getElementById('cancel-slot-confirm').style.display = 'none';
    
    const originalClose = _closeConfirm;
    window._closeConfirm = () => {
      document.getElementById('ok-slot-confirm').textContent = 'Confirm';
      document.getElementById('cancel-slot-confirm').style.display = 'inline-block';
      originalClose();
      window._closeConfirm = originalClose; 
    };

  } catch (err) {
    console.error('PDF Export Error:', err);
    showToast('Failed to generate compact schedule.', 'error');
  }
}


// ── UTILS ────────────────────────────────────────────────────
function _todayIdx() { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; }
function _fmt12(t) { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; }
function _slotCap(slot) { return slot.capacity || SLOT_DEFAULT_CAP; }
function _barColor(n, cap) { return n >= cap ? '#ef4444' : n >= Math.ceil(cap * 0.6) ? '#eab308' : '#22c55e'; }
function _initials(name) { return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??'; }
const _COLORS = ['#3b6ef5', '#22c55e', '#f97316', '#7c3aed', '#ef4444', '#eab308', '#06b6d4', '#ec4899', '#14b8a6', '#8b5cf6'];
function _avatarColor(i) { return _COLORS[Math.abs(i) % _COLORS.length]; }