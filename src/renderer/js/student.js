// src/renderer/js/student.js
// All UI logic for the Students page.
// Talks to backend ONLY via window.api (preload bridge). Never directly.

'use strict';

// ── State ─────────────────────────────────────────────
let allStudents   = [];   // full list from DB
let editingId     = null; // null = adding new, number = editing existing
let courseMap     = new Map();
let slotMap       = new Map();
let globalSlotData = null;
let _editOriginalRawSlots = []; // preserves ALL slot entries when editing (not just Slot 1/2)

// ── Pagination State ──────────────────────────────────
const PAGE_SIZE = 10;
let currentPage = 1;
let currentFilteredStudents = [];

// ── Init (called by renderer.js after injecting the page HTML) ─
window.initStudentPage = async function () {
  await loadStudents();
  bindSearchAndFilter();
  bindAddButton();
  
  // Initialize Google Sheets Bulk Import Modal and "Change Photo" delegation
  if (typeof initGoogleImportListeners === 'function') {
    initGoogleImportListeners();
  }
  
  bindKeyboardShortcuts();
};

window.destroyStudents = function () {
  document.removeEventListener('keydown', _studentKeyHandler);
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', _studentKeyHandler);
}

function _studentKeyHandler(e) {
  if (e.key === 'Escape') {
    // Close any active modal
    const viewModal = document.getElementById('student-view-overlay');
    if (viewModal?.classList.contains('active')) {
      viewModal.classList.remove('active');
    }
    
    const editModal = document.getElementById('student-modal-overlay');
    if (editModal?.classList.contains('active')) {
      // Logic from closeBtn click
      editModal.classList.remove('active');
      setTimeout(() => { document.getElementById('modal-root').innerHTML = ''; }, 300);
    }

    const importModal = document.getElementById('import-modal');
    if (importModal?.classList.contains('active')) {
      importModal.classList.remove('active');
    }

    const photoOverlay = document.getElementById('photo-remove-overlay');
    if (photoOverlay) {
       document.getElementById('modal-root').innerHTML = '';
    }
  }

  if (e.key === 'Enter') {
    // Don't trigger if in a textarea
    if (document.activeElement.tagName === 'TEXTAREA') return;

    const editModal = document.getElementById('student-modal-overlay');
    const importModal = document.getElementById('import-modal');
    const photoOverlay = document.getElementById('photo-remove-overlay');

    if (editModal?.classList.contains('active')) {
      const btn = document.getElementById('btn-save-student');
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    } else if (importModal?.classList.contains('active')) {
      // Step 1: Load Preview, Step 2: Confirm Import
      const s1 = document.getElementById('import-step-1');
      const s2 = document.getElementById('import-step-2');
      if (s1 && s1.style.display !== 'none') {
        const btn = document.getElementById('btn-load-preview');
        if (btn) { e.preventDefault(); btn.click(); }
      } else if (s2 && s2.style.display !== 'none') {
        const btn = document.getElementById('btn-confirm-import');
        if (btn) { e.preventDefault(); btn.click(); }
      }
    } else if (photoOverlay) {
       const btn = document.getElementById('photo-confirm-btn');
       if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    }
  }
}

// New single-shell entrypoint (router.js expects this).
window.initStudents = window.initStudentPage;

// ── Load & Render Students ────────────────────────────
async function loadStudents() {
  try {
    const [students, courses, slotDataObj] = await Promise.all([
      window.api.getAllStudents(),
      (window.api.getCourses ? window.api.getCourses() : Promise.resolve([])).catch(() => []),
      (window.api.loadSlotData ? window.api.loadSlotData() : Promise.resolve(null)).catch(() => null),
    ]);

    // Extract unique slots from the rich JSON structure
    let uniqueSlots = [];
    if (slotDataObj) {
      const slotSet = new Map();
      Object.keys(slotDataObj).forEach(day => {
        const dailySlots = slotDataObj[day]?.slots || [];
        dailySlots.forEach(s => {
          if (!slotSet.has(s.id)) {
            slotSet.set(s.id, { ...s, days: [day] });
          } else {
            slotSet.get(s.id).days.push(day);
          }
        });
      });
      uniqueSlots = Array.from(slotSet.values());
    }

    globalSlotData = slotDataObj;
    allStudents = students || [];
    
    // Sort: Inactive at bottom, then Recent at top
    allStudents.sort((a, b) => {
      const aInact = (String(a.status || '').trim().toLowerCase() === 'inactive') ? 1 : 0;
      const bInact = (String(b.status || '').trim().toLowerCase() === 'inactive') ? 1 : 0;
      if (aInact !== bInact) return aInact - bInact;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    courseMap = new Map((courses || []).map(c => [String(c.id), c]));
    slotMap   = new Map(uniqueSlots.map(s => [String(s.id), s]));

    populateCourseFilter(courses || []);

    renderTable(allStudents);
    renderStats(allStudents);
    updateSubtitle(allStudents.length);
  } catch (err) {
    showToast('Failed to load students: ' + err, 'error');
  }
}

function renderTable(students) {
  const tbody   = document.getElementById('students-tbody');
  const counter = document.getElementById('table-count');
  if (!tbody) return;

  // Store filtered list for pagination
  currentFilteredStudents = students;
  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = start + PAGE_SIZE;
  const pageStudents = students.slice(start, end);

  if (counter) {
    const from = students.length ? start + 1 : 0;
    const to   = Math.min(end, students.length);
    counter.textContent = `Showing ${from}–${to} of ${students.length} student${students.length !== 1 ? 's' : ''}`;
  }

  if (students.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <h3>No students found</h3>
          <p>Click "Add Student" to get started.</p>
        </div>
      </td></tr>
    `;
    renderPagination(0, 1);
    return;
  }

  students = pageStudents;

  tbody.innerHTML = students.map((s, idx) => {
    const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim();
    const initials  = getInitials(s);
    const palette = avatarGradient(s.firstName, s.lastName, s.studentId);
    const course    = getCourseForStudent(s);
    const slots     = getSlotsForStudent(s);
    const courseTxt = course?.code || course?.name || (slots[0]?.subject || '—');

    const isInactive = s.status === 'Inactive';
    const rowStatusStyle = isInactive ? 'filter: grayscale(100%) opacity(0.6);' : '';

    const avatarHtml = s.photo_path 
      ? `<img src="file://${s.photo_path}" class="student-thumb" />`
      : `<div class="student-avatar" style="background:${palette.bg}; --avatar-glow:${palette.glow}"><span class="avatar-initials">${esc(initials)}</span></div>`;

    return `
      <tr data-id="${s.id}" class="row-anim" style="${rowStatusStyle} animation-delay: ${0.28 + (idx * 0.05)}s">
        <td class="col-photo">
          <div class="thumb-wrapper" onclick="event.stopPropagation(); openRemovePhotoConfirm(${s.id}, '${s.studentId}', '${esc(fullName)}')" title="Click to remove photo">
            ${avatarHtml}
          </div>
        </td>

        <td class="col-name">
          <span class="student-name">${esc(fullName)}</span>
        </td>
        <td class="col-roll">
          ${renderRoll(s.rollNumber)}
        </td>
        <td class="col-course">
          ${courseTxt && courseTxt !== '—' ? `<span class="course-pill">${esc(courseTxt)}</span>` : '—'}
        </td>
        <td class="col-slot">
          ${slots.length > 0
            ? slots.map(sl => `<span class="slot-pill" style="display:inline-flex;margin-bottom:4px;white-space:normal;text-align:left;">${clockIcon()}${esc(getSlotDisplay(sl))}</span>`).join('<br>')
            : '—'}
        </td>
        <td class="col-fee">${feeBadge(s.feeStatus)}</td>
        <td class="col-edit">
          <button class="btn btn-sm btn-action btn-edit" onclick="openEditModal(${s.id})" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
          </button>
        </td>
        <td class="col-action">
          <div class="action-cell">
            <button class="btn btn-sm btn-action btn-camera btn-change-photo" data-student-id="${s.studentId}" title="Change Photo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
            <button class="btn btn-sm btn-action btn-view" onclick="openViewModal(${s.id})" title="View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button class="btn btn-sm btn-action btn-delete" onclick='openDeleteConfirm(${s.id}, ${JSON.stringify(fullName)})' title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderPagination(totalPages, currentPage);
}

// ── Pagination Rendering ─────────────────────────────
function renderPagination(totalPages, activePage) {
  const container = document.getElementById('pagination-controls');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Prev button
  html += `<button class="pg-btn pg-prev ${activePage <= 1 ? 'pg-disabled' : ''}" data-page="${activePage - 1}" ${activePage <= 1 ? 'disabled' : ''}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
  </button>`;

  // Page numbers with ellipsis logic
  const pages = _buildPageNumbers(activePage, totalPages);
  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `<button class="pg-btn pg-num ${p === activePage ? 'pg-active' : ''}" data-page="${p}">${p}</button>`;
    }
  });

  // Next button
  html += `<button class="pg-btn pg-next ${activePage >= totalPages ? 'pg-disabled' : ''}" data-page="${activePage + 1}" ${activePage >= totalPages ? 'disabled' : ''}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;

  container.innerHTML = html;

  // Bind click handlers
  container.querySelectorAll('.pg-btn:not(.pg-disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderTable(currentFilteredStudents);
      }
    });
  });
}

function _buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  const rangeStart = Math.max(2, current - 1);
  const rangeEnd   = Math.min(total - 1, current + 1);
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function renderStats(students) {
  const el = document.getElementById('student-stats');
  if (!el) return;

  const pending = students.filter(s => s.feeStatus === 'pending' && s.status !== 'Inactive').length;
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div class="chip chip-purple-date">
      <span class="chip-dot chip-dot-purple" aria-hidden="true"></span>
      ${dateStr}
    </div>
    <div class="chip chip-pending">
      ${pending} Dues Unpaid
    </div>
  `;
}

function updateSubtitle(count) {
  const el = document.getElementById('students-subtitle');
  if (el) el.textContent = `Total ${count} students enrolled`;
}

// ── Search & Filter ───────────────────────────────────
function bindSearchAndFilter() {
  const searchInput = document.getElementById('search-input');
  const courseFilter = document.getElementById('filter-course');
  const feeFilter   = document.getElementById('filter-fee');

  function applyFilters() {
    const query  = (searchInput?.value || '').toLowerCase().trim();
    const fee    = feeFilter?.value || '';
    const course = courseFilter?.value || '';

    let results = allStudents;

    if (query) {
      results = results.filter(s =>
        (s.firstName || '').toLowerCase().includes(query)  ||
        (s.lastName || '').toLowerCase().includes(query)   ||
        (s.rollNumber || '').toLowerCase().includes(query) ||
        (s.studentId || '').toLowerCase().includes(query) ||
        (s.phone || '').toLowerCase().includes(query)
      );
    }

    if (fee) {
      results = results.filter(s => s.feeStatus === fee);
    }

    if (course) {
      results = results.filter(s => String(s.courseId ?? '') === String(course));
    }

    // Sort: Inactive at bottom, then Recent at top
    results.sort((a, b) => {
      const aInact = (String(a.status || '').trim().toLowerCase() === 'inactive') ? 1 : 0;
      const bInact = (String(b.status || '').trim().toLowerCase() === 'inactive') ? 1 : 0;
      if (aInact !== bInact) return aInact - bInact;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    currentPage = 1;
    renderTable(results);
  }

  searchInput?.addEventListener('input', applyFilters);
  courseFilter?.addEventListener('change', applyFilters);
  feeFilter?.addEventListener('change', applyFilters);
}

function populateCourseFilter(courses) {
  const el = document.getElementById('filter-course');
  if (!el) return;

  const options = (courses || [])
    .map(c => ({
      id: c?.id,
      label: c?.name || c?.code || `Course ${c?.id ?? ''}`,
    }))
    .filter(x => x.id !== null && x.id !== undefined)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map(x => `<option value="${esc(String(x.id))}">${esc(String(x.label))}</option>`)
    .join('');

  el.innerHTML = `<option value="">All Courses</option>${options}`;
}

// ── ADD Button ────────────────────────────────────────
function bindAddButton() {
  document.getElementById('btn-add-student')?.addEventListener('click', () => {
    openStudentModal(null);
  });
}

// Expose for dashboard quick-action access
window.openStudentModal = openStudentModal;

// ── Add / Edit Modal ──────────────────────────────────
window.openEditModal = async function (id) {
  try {
    const student = await window.api.getStudentById(id);
    openStudentModal(student);
  } catch (err) {
    showToast('Could not load student data.', 'error');
  }
};

window.openViewModal = async function (id) {
  try {
    const student = await window.api.getStudentById(id);
    if (!student) {
      showToast('Student record not found.', 'error');
      return;
    }
    openStudentViewModal(student);
  } catch (err) {
    showToast('Could not load student data: ' + err, 'error');
  }
};

function openStudentModal(student) {
  editingId = student ? student.id : null;
  const isEdit = editingId !== null;

  const courseOptions = Array.from(courseMap.values())
    .sort((a, b) => String(a?.name || a?.code || '').localeCompare(String(b?.name || b?.code || '')))
    .map(c => {
      const selected = student?.courseId !== null && student?.courseId !== undefined
        ? String(c.id) === String(student.courseId)
        : false;
      return `<option value="${esc(String(c.id))}" ${selected ? 'selected' : ''}>${esc(c.name || c.code || 'Course')}</option>`;
    })
    .join('');

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TIMES = [
    '7:00 AM - 8:00 AM',
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM',
    '5:00 PM - 6:00 PM',
    '6:00 PM - 7:00 PM',
    '7:00 PM - 8:00 PM'
  ];

  const rawSlots = (student?.slotId ? String(student.slotId).split(',') : []).map(s => s.trim()).filter(s => s.includes('|'));
  _editOriginalRawSlots = isEdit ? [...rawSlots] : []; // preserve ALL entries for merge on save
  let d1 = '', t1 = '', d2 = '', t2 = '';
  if (rawSlots[0]) { [d1, t1] = rawSlots[0].split('|'); }
  if (rawSlots[1]) { [d2, t2] = rawSlots[1].split('|'); }

  const currentClass = student?.class || '';
  const commonClasses = [
    'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
    'B.Tech', 'BCA', 'MCA'
  ];
  const classList = Array.from(new Set([...commonClasses, currentClass].filter(Boolean)));
  const classOptions = classList.map(v => `
    <option value="${esc(v)}" ${String(v) === String(currentClass) ? 'selected' : ''}>${esc(v)}</option>
  `).join('');

  const fullNameValue = `${student?.firstName || ''} ${student?.lastName || ''}`.trim();
  const rollValue = String(student?.rollNumber || '').trim();

  const statusValue = student?.status || 'Active';

  const modalHtml = `
    <div class="modal-overlay active" id="student-modal-overlay">
      <div class="modal edit-student-modal">
        <div class="modal-header edit-modal-header">
          <h3 class="modal-title edit-modal-title">
            <svg class="edit-title-icon" viewBox="0 0 24 24" fill="none" stroke="#f26f60" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
            ${isEdit ? 'Edit Student' : 'Add Student'}
          </h3>
          <button class="modal-close" id="modal-close-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body edit-modal-body">
          <div class="form-grid edit-form-grid">
            <div class="form-group form-full">
              <label class="form-label edit-form-label">FULL NAME <span class="required-star">*</span></label>
              <input class="form-input edit-form-input" id="inp-fullName" type="text" placeholder="Amit Kumar" value="${esc(fullNameValue)}" />
            </div>


            <div class="form-group" style="position:relative;">
              <label class="form-label edit-form-label">ROLL NUMBER</label>
              <input class="form-input edit-form-input" id="inp-roll" type="text" placeholder="01" value="${esc(rollValue)}" />
              <div id="roll-error" style="color: #ef4444; font-size: 11px; margin-top: 4px; display: none;"></div>
            </div>

            <div class="form-group">
              <label class="form-label edit-form-label">CLASS / GRADE</label>
              <select class="form-select edit-form-select" id="inp-class">
                ${classOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">COURSE</label>
              <select class="form-select edit-form-select" id="inp-course">
                <option value="" ${(!student || student.courseId === null || student.courseId === undefined) ? 'selected' : ''}>—</option>
                ${courseOptions}
              </select>
            </div>

            <div class="form-group form-full">
              <label class="form-label edit-form-label">SLOT 1</label>
              <div style="display:flex; gap:10px;">
                <select class="form-select edit-form-select" id="inp-day1" style="flex:1">
                  <option value="">Select Day</option>
                  ${ DAYS.map(d => `<option value="${esc(d)}" ${d===d1?'selected':''}>${esc(d)}</option>`).join('') }
                </select>
                <select class="form-select edit-form-select" id="inp-time1" style="flex:1">
                  <option value="">Select Time</option>
                  ${ TIMES.map(t => `<option value="${esc(t)}" ${t===t1?'selected':''}>${esc(t)}</option>`).join('') }
                </select>
              </div>
            </div>

            <div class="form-group form-full">
              <label class="form-label edit-form-label">SLOT 2</label>
              <div style="display:flex; gap:10px;">
                <select class="form-select edit-form-select" id="inp-day2" style="flex:1">
                  <option value="">Select Day</option>
                  ${ DAYS.map(d => `<option value="${esc(d)}" ${d===d2?'selected':''}>${esc(d)}</option>`).join('') }
                </select>
                <select class="form-select edit-form-select" id="inp-time2" style="flex:1">
                  <option value="">Select Time</option>
                  ${ TIMES.map(t => `<option value="${esc(t)}" ${t===t2?'selected':''}>${esc(t)}</option>`).join('') }
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">MOBILE</label>
              <input class="form-input edit-form-input" id="inp-phone" type="tel" placeholder="9876543210" value="${esc(student?.phone || '')}" />
            </div>

            <div class="form-group">
              <label class="form-label edit-form-label">MONTHLY FEE (₹)</label>
              <input class="form-input edit-form-input" id="inp-feeAmount" type="number" placeholder="15000" value="${esc(student?.feeAmount || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label" style="opacity: 0.6;">FEE STATUS (Read-only)</label>
              <div style="background: var(--bg-card); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border-color); color: var(--text-secondary); cursor: not-allowed; display: flex; align-items: center; justify-content: space-between;">
                 <span style="font-weight: 500; font-size: 13px;">${student?.feeStatus === 'paid' ? 'Paid' : 'Unpaid (Managed in Fees Tab)'}</span>
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <input type="hidden" id="inp-fee" value="${esc(student?.feeStatus || 'pending')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">ADMISSION DATE</label>
              <input class="form-input edit-form-input" id="inp-admissionDate" type="date" value="${esc(student?.admissionDate || (student?.createdAt ? student.createdAt.slice(0, 10) : ''))}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">STATUS</label>
              <select class="form-select edit-form-select" id="inp-status">
                <option value="Active" ${(statusValue === 'Active') ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${(statusValue === 'Inactive') ? 'selected' : ''}>Inactive</option>
              </select>
            </div>
          </div>

          <h4 style="margin: 24px 0 16px; font-size: 11.5px; color: #94a3b8; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; letter-spacing: 0.8px;">Additional Details (For Forms)</h4>
          <div class="form-grid edit-form-grid">
            <div class="form-group">
              <label class="form-label edit-form-label">DATE OF BIRTH</label>
              <input class="form-input edit-form-input" id="inp-dob" type="date" value="${esc(student?.dob || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">SEX</label>
              <select class="form-select edit-form-select" id="inp-sex">
                <option value="" ${!student?.sex ? 'selected' : ''}>—</option>
                <option value="M" ${student?.sex === 'M' ? 'selected' : ''}>Male (M)</option>
                <option value="F" ${student?.sex === 'F' ? 'selected' : ''}>Female (F)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">FATHER'S NAME</label>
              <input class="form-input edit-form-input" id="inp-fatherName" type="text" placeholder="Enter father's name" value="${esc(student?.fatherName || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">MOTHER'S NAME</label>
              <input class="form-input edit-form-input" id="inp-motherName" type="text" placeholder="Enter mother's name" value="${esc(student?.motherName || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">NATIONALITY</label>
              <input class="form-input edit-form-input" id="inp-nationality" type="text" placeholder="Indian" value="${esc(student?.nationality || 'Indian')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">CATEGORY</label>
              <select class="form-select edit-form-select" id="inp-category">
                <option value="General" ${student?.category === 'General' ? 'selected' : ''}>General</option>
                <option value="OBC" ${student?.category === 'OBC' ? 'selected' : ''}>OBC</option>
                <option value="SC" ${student?.category === 'SC' ? 'selected' : ''}>SC</option>
                <option value="ST" ${student?.category === 'ST' ? 'selected' : ''}>ST</option>
              </select>
            </div>
            <div class="form-group form-full">
              <label class="form-label edit-form-label">QUALIFICATION / PREVIOUS EXAM</label>
              <input class="form-input edit-form-input" id="inp-qualification" type="text" placeholder="E.g. 10th / 12th / B.A." value="${esc(student?.qualification || '')}" />
            </div>
          </div>

          <h4 style="margin: 24px 0 16px; font-size: 11.5px; color: #94a3b8; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; letter-spacing: 0.8px;">Parent / Guardian Info</h4>
          <div class="form-grid edit-form-grid">
            <div class="form-group">
              <label class="form-label edit-form-label">GUARDIAN NAME</label>
              <input class="form-input edit-form-input" id="inp-parentName" type="text" placeholder="Enter name" value="${esc(student?.parentName || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">PARENT MOBILE</label>
              <input class="form-input edit-form-input" id="inp-parentPhone" type="tel" placeholder="Enter mobile" value="${esc(student?.parentPhone || '')}" />
            </div>
            <div class="form-group form-full">
              <label class="form-label edit-form-label">HOME ADDRESS</label>
              <input class="form-input edit-form-input" id="inp-address" type="text" placeholder="Enter home address" value="${esc(student?.address || '')}" />
            </div>
          </div>
        </div>
        <div class="modal-footer edit-modal-footer">
          <button class="btn btn-save-changes" id="modal-save-btn">
            💾 ${isEdit ? 'Save Changes' : 'Add Student'}
          </button>
          <button class="btn btn-cancel-outline" id="modal-cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const root = document.getElementById('modal-root');
  root.innerHTML = modalHtml;

  // Close handlers
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('student-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Save handler
  document.getElementById('modal-save-btn').addEventListener('click', handleSaveStudent);

  // Multi-select toggle behavior for slot timing native dropdown
  const slotSelect = document.getElementById('inp-slot');
  if (slotSelect) {
    slotSelect.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'OPTION') {
        e.preventDefault();
        e.target.selected = !e.target.selected;
        // optionally focus the select so scrolling works
        this.focus();
      }
    });
  }

  // Focus first input
  setTimeout(() => document.getElementById('inp-fullName')?.focus(), 50);

  // Roll number validation
  const rollInput = document.getElementById('inp-roll');
  if (rollInput) {
    const handleRollValidation = async () => {
      const roll = rollInput.value.trim();
      const errEl = document.getElementById('roll-error');
      if (!roll) {
        errEl.style.display = 'none';
        return true;
      }
      try {
        const conflict = await window.api.checkRollNumber(roll, editingId);
        if (conflict) {
          errEl.textContent = `Roll number ${roll} is already assigned to ${conflict.firstName} ${conflict.lastName}. Please choose a different number.`;
          errEl.style.display = 'block';
          return false;
        } else {
          errEl.style.display = 'none';
          return true;
        }
      } catch (err) {
        console.error('Validation error:', err);
        return true;
      }
    };
    rollInput.addEventListener('blur', handleRollValidation);
    // Attach to window so save handler can use it easily
    window._checkRollNumberValidation = handleRollValidation;
  }
}

async function handleSaveStudent() {
  const fullName = document.getElementById('inp-fullName')?.value.trim() || '';
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    showToast('Please enter full name (first and last).', 'error');
    return;
  }

  const firstName = parts[0];
  const lastName  = parts.slice(1).join(' ');

  const data = {
    firstName,
    lastName,
    class:      document.getElementById('inp-class')?.value.trim(),
    rollNumber: (document.getElementById('inp-roll')?.value.trim() || '').replace(/^#/, ''),
    courseId: (() => {
      const v = document.getElementById('inp-course')?.value;
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    })(),
    slotId: (() => {
      const day1 = document.getElementById('inp-day1')?.value;
      const time1 = document.getElementById('inp-time1')?.value;
      const day2 = document.getElementById('inp-day2')?.value;
      const time2 = document.getElementById('inp-time2')?.value;

      // Build the new Slot 1 and Slot 2 entries
      const newSlot1 = (day1 && time1) ? `${day1}|${time1}` : '';
      const newSlot2 = (day2 && time2) ? `${day2}|${time2}` : '';

      if (editingId && _editOriginalRawSlots.length > 2) {
        // Preserve additional slot enrollments beyond Slot 1 & 2
        // (those added via Slot Management picker)
        const extraSlots = _editOriginalRawSlots.slice(2);
        const arr = [];
        if (newSlot1) arr.push(newSlot1);
        if (newSlot2) arr.push(newSlot2);
        arr.push(...extraSlots);
        return arr.join(', ');
      } else {
        // New student or ≤2 slots — straightforward
        const arr = [];
        if (newSlot1) arr.push(newSlot1);
        if (newSlot2) arr.push(newSlot2);
        return arr.join(', ');
      }
    })(),
    phone:       document.getElementById('inp-phone')?.value.trim(),
    feeAmount:   Number(document.getElementById('inp-feeAmount')?.value) || 0,
    feeStatus:   document.getElementById('inp-fee')?.value,
    status:      document.getElementById('inp-status')?.value,
    parentName:  document.getElementById('inp-parentName')?.value.trim(),
    parentPhone: document.getElementById('inp-parentPhone')?.value.trim(),
    address:     document.getElementById('inp-address')?.value.trim(),
    admissionDate: document.getElementById('inp-admissionDate')?.value || null,
    dob:         document.getElementById('inp-dob')?.value || null,
    sex:         document.getElementById('inp-sex')?.value || null,
    fatherName:  document.getElementById('inp-fatherName')?.value.trim(),
    motherName:  document.getElementById('inp-motherName')?.value.trim(),
    nationality: document.getElementById('inp-nationality')?.value.trim() || 'Indian',
    category:    document.getElementById('inp-category')?.value || 'General',
    qualification: document.getElementById('inp-qualification')?.value.trim()
  };

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  if (window._checkRollNumberValidation) {
    const isValid = await window._checkRollNumberValidation();
    if (!isValid) {
      saveBtn.disabled = false;
      saveBtn.textContent = editingId ? 'Save Changes' : 'Add Student';
      return; 
    }
  }

  try {
    let savedStudentId = editingId;

    if (editingId) {
      await window.api.updateStudent(editingId, data);
      showToast('Student updated successfully.', 'success');
    } else {
      const result = await window.api.addStudent(data);
      savedStudentId = result?.id || null;
      showToast('Student added successfully.', 'success');
    }

    // ── Sync slot enrollment JSON data ──────────────────────
    if (savedStudentId) {
      const syncSlots = data.status === 'Inactive' ? '' : data.slotId;
      await _syncStudentSlotsAfterSave(savedStudentId, syncSlots);
    }

    closeModal();
    await loadStudents();
  } catch (err) {
    showToast(err || 'Something went wrong.', 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = editingId ? 'Save Changes' : 'Add Student';
  }
}

/**
 * After saving a student from the edit modal, update the slot enrollment JSON
 * so Slot Management stays in sync.
 * 1. Remove student from ALL existing slot enrollments (clean slate)
 * 2. Re-add them to the slots in their new slotId string
 */
async function _syncStudentSlotsAfterSave(studentDbId, newSlotIdStr) {
  try {
    const slotData = await window.api.loadSlotData();
    if (!slotData) return;

    const stuIdStr = String(studentDbId);
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayMap = {
      'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
      'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
    };
    const normTime = (t) => String(t || '').replace(/–/g, '-').replace(/\s+/g, '').toLowerCase();

    // Step 1: Remove student from ALL enrollments across all days
    DAYS.forEach(day => {
      if (!slotData[day]) return;
      for (const sId of Object.keys(slotData[day].students || {})) {
        const arr = slotData[day].students[sId];
        if (Array.isArray(arr) && arr.includes(stuIdStr)) {
          slotData[day].students[sId] = arr.filter(x => x !== stuIdStr);
        }
      }
    });

    // Step 2: Parse new slotId and re-enroll
    if (newSlotIdStr && newSlotIdStr.includes('|')) {
      const entries = newSlotIdStr.split(',').map(s => s.trim()).filter(s => s.includes('|'));
      entries.forEach(entry => {
        const [shortDay, timeStr] = entry.split('|');
        const fullDay = dayMap[shortDay];
        if (!fullDay || !slotData[fullDay]) return;

        // Find matching slot by comparing time labels
        const nt = normTime(timeStr);
        let slot = (slotData[fullDay].slots || []).find(s => normTime(s.label) === nt);

        // If no matching slot exists, create one on the fly
        if (!slot) {
          let start = '00:00', end = '01:00', session = 'morning';
          const tMatch = timeStr.match(/(\d{1,2}:\d{2})\s*(AM|PM)\s*[-|–]\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
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
          slot = {
            id: `cs_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            start, end, label: timeStr, session, capacity: 5, custom: true
          };
          slotData[fullDay].slots.push(slot);
          slotData[fullDay].students[slot.id] = [];
        }

        // Enroll student in this slot
        if (!slotData[fullDay].students[slot.id]) {
          slotData[fullDay].students[slot.id] = [];
        }
        if (!slotData[fullDay].students[slot.id].includes(stuIdStr)) {
          slotData[fullDay].students[slot.id].push(stuIdStr);
        }
      });
    }

    // Step 3: Save updated slot data
    await window.api.saveSlotData(slotData);
  } catch (e) {
    console.error('[Student] Slot sync after save failed:', e);
  }
}


function openStudentViewModal(student) {
  const fullName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
  const course   = getCourseForStudent(student);
  const slots    = getSlotsForStudent(student);

  const avatarBg = avatarGradient(student.firstName, student.lastName, student.studentId);
  const initials = getInitials(student);

  const avatarHtml = student.photo_path
    ? `<img src="file://${student.photo_path}" class="student-avatar-lg" style="width: 72px; height: 72px; object-fit: cover; box-shadow: 0 8px 16px rgba(0,0,0,0.1);" />`
    : `<div class="student-avatar student-avatar-lg" style="background:${avatarBg.bg}; width: 72px; height: 72px; font-size: 24px; box-shadow: 0 8px 16px rgba(0,0,0,0.1);"><span class="avatar-initials">${esc(initials)}</span></div>`;

  const formatDDMMYYYY = (ds) => {
    if (!ds) return '—';
    const d = new Date(ds);
    if (isNaN(d.getTime())) return ds;
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth()+1).padStart(2, '0') + '-' + d.getFullYear();
  };

  const modalHtml = `
    <div class="modal-overlay active" id="student-view-overlay">
      <div class="modal" style="max-width: 640px; padding: 0; overflow: hidden; border-radius: 12px; display: flex; flex-direction: column; max-height: 90vh;">
        
        <!-- Header area with vibrant subtle background -->
        <div style="background: #f8fafc; padding: 24px 32px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="display: flex; gap: 20px; align-items: center;">
            ${avatarHtml}
            <div>
              <h2 style="margin: 0 0 6px 0; font-family: var(--font-display); font-size: 24px; font-weight: 800; color: #0f172a;">${esc(fullName || '—')}</h2>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="font-size: 13px; font-weight: 700; color: ${student.status === 'Inactive' ? '#94a3b8' : '#10b981'};">${esc(student.status || 'Active')}</span>
              </div>
            </div>
          </div>
          <button class="modal-close" id="view-close-btn" style="background: transparent; padding: 4px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="modal-body" style="padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 28px; overflow-y: auto;">
          
          <!-- Student Academic Details -->
          <section>
            <h4 style="margin: 0 0 16px; font-size: 12px; color: #0ea5e9; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;">Academic Info</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9;">
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Course</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(getCourseDisplay(course, getSlotsForStudent(student)[0]))}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Slot Timing</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600; display: flex; flex-direction: column; gap: 6px;">
                  ${getSlotsForStudent(student).map(sl => `<div style="display:flex;align-items:center;gap:6px;">${clockIcon()} ${esc(getSlotDisplay(sl))}</div>`).join('') || '—'}
                </div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Class / Grade</div>
                <div style="font-size: 14px; color: #334155;">${esc(student.class || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Roll Number</div>
                <div style="font-size: 14px; color: #334155;">${esc(student.rollNumber || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Fee Status</div>
                <div>${feeBadge(student.feeStatus)}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Admission Date</div>
                <div style="font-size: 14px; color: #334155;">${esc(formatDDMMYYYY(student.admissionDate || (student.createdAt ? student.createdAt.slice(0, 10) : null)))}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Student Mobile</div>
                <div style="font-size: 14px; color: #334155;">${esc(student.phone || '—')}</div>
              </div>
            </div>
          </section>

          <!-- Personal & Additional Details -->
          <section>
            <h4 style="margin: 0 0 16px; font-size: 12px; color: #f59e0b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;">Personal & Additional Details</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9;">
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Date of Birth</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(formatDDMMYYYY(student.dob) || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Sex</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.sex === 'M' ? 'Male (M)' : student.sex === 'F' ? 'Female (F)' : student.sex || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Category</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.category || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Nationality</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.nationality || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Qualification</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.qualification || '—')}</div>
              </div>
              <div style="grid-column: 1 / -1;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Father's Name</div>
                    <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.fatherName || '—')}</div>
                  </div>
                  <div>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Mother's Name</div>
                    <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.motherName || '—')}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Parent / Guardian Details -->
          <section>
            <h4 style="margin: 0 0 16px; font-size: 12px; color: #8b5cf6; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;">Guardian Details</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9;">
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Parent Name</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 600;">${esc(student.parentName || '—')}</div>
              </div>
              <div>
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Parent Mobile</div>
                <div style="font-size: 14px; color: #334155;">${esc(student.parentPhone || '—')}</div>
              </div>
              <div style="grid-column: 1 / -1;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Home Address</div>
                <div style="font-size: 14px; color: #334155; line-height: 1.5;">${esc(student.address || '—')}</div>
              </div>
            </div>
          </section>

        </div>
        
        <div class="modal-footer" style="padding: 20px 32px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; background: #ffffff;">
          <button class="btn btn-outline" id="view-close-btn-2" style="font-weight: 600; padding: 8px 20px; border-radius: 8px;">Close</button>
          <button class="btn btn-primary" id="view-edit-btn" style="background: #0ea5e9; border: none; font-weight: 700; padding: 10px 24px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
            Edit Profile
          </button>
        </div>
      </div>
    </div>
  `;

  const root = document.getElementById('modal-root');
  root.innerHTML = modalHtml;

  document.getElementById('view-close-btn').addEventListener('click', closeModal);
  document.getElementById('view-close-btn-2').addEventListener('click', closeModal);
  document.getElementById('view-edit-btn').addEventListener('click', () => {
    closeModal();
    openStudentModal(student);
  });
  document.getElementById('student-view-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ── Delete Confirm ─────────────────────────────────────
window.openDeleteConfirm = function (id, name) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay active" id="delete-modal-overlay">
      <div class="modal delete-confirm-modal" style="width:440px">
        <div class="modal-header delete-modal-header">
          <div class="delete-modal-title-row">
            <div class="delete-warning-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 class="modal-title">Delete Student</h3>
          </div>
          <button class="modal-close" id="del-close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="delete-confirm-body">
            <p class="confirm-text">
              You are about to permanently delete
              <span class="confirm-name">${esc(name)}</span>.
            </p>
            <p class="confirm-subtext">
              ⚠️ This action <strong>cannot be undone</strong>. All student data, records, and history will be removed.
            </p>
          </div>
        </div>
        <div class="modal-footer delete-modal-footer">
          <button class="btn btn-ghost" id="del-cancel-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Cancel
          </button>
          <button class="btn btn-danger-solid" id="del-confirm-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Yes, Delete Forever
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('del-close-btn').addEventListener('click', closeModal);
  document.getElementById('del-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('delete-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('del-confirm-btn').addEventListener('click', async () => {
    const btn = document.getElementById('del-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
        <path d="M12 2a10 10 0 0 1 10 10"/>
      </svg>
      Deleting…
    `;
    try {
      await window.api.deleteStudent(id);

      // ── Clean up slot enrollment data ──────────────────
      try {
        const slotData = await window.api.loadSlotData();
        if (slotData) {
          const stuIdStr = String(id);
          const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
          DAYS.forEach(day => {
            if (!slotData[day]) return;
            for (const sId of Object.keys(slotData[day].students || {})) {
              const arr = slotData[day].students[sId];
              if (Array.isArray(arr) && arr.includes(stuIdStr)) {
                slotData[day].students[sId] = arr.filter(x => x !== stuIdStr);
              }
            }
          });
          await window.api.saveSlotData(slotData);
        }
      } catch (slotErr) {
        console.error('[Student] Slot cleanup after delete failed:', slotErr);
      }

      showToast('✓ Student deleted successfully.', 'success');
      closeModal();
      await loadStudents();
    } catch (err) {
      showToast('Delete failed: ' + err, 'error');
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        Yes, Delete Forever
      `;
    }
  });
};

// ── Remove Photo Confirm ──────────────────────────────
window.openRemovePhotoConfirm = function (id, studentId, name) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay active" id="photo-remove-overlay">
      <div class="modal delete-confirm-modal" style="width:400px">
        <div class="modal-header" style="background: rgba(245, 158, 11, 0.08); border-bottom: 1px solid rgba(245, 158, 11, 0.2);">
          <div class="delete-modal-title-row">
            <div class="delete-warning-icon" style="background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.3); color: #f59e0b;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </div>
            <h3 class="modal-title">Remove Photo</h3>
          </div>
          <button class="modal-close" id="photo-close-btn">✕</button>
        </div>
        <div class="modal-body" style="padding: 24px;">
          <div class="delete-confirm-body">
            <p class="confirm-text">
              Are you sure you want to remove the profile photo for 
              <span class="confirm-name">${esc(name)}</span>?
            </p>
            <p style="font-size: 13px; color: #64748b; margin-top: 8px;">
              The image will be replaced by a colorful initials placeholder.
            </p>
          </div>
        </div>
        <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 12px; background: #fafafa;">
          <button class="btn btn-ghost" id="photo-cancel-btn" style="padding: 8px 16px;">
            Cancel
          </button>
          <button class="btn" id="photo-confirm-btn" style="background: #f59e0b; color: #ffffff; border: none; font-weight: 700; padding: 8px 20px; border-radius: 8px; display: flex; align-items: center; gap: 8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Remove Profile Photo
          </button>
        </div>
      </div>
    </div>
  `;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('photo-close-btn').addEventListener('click', close);
  document.getElementById('photo-cancel-btn').addEventListener('click', close);
  document.getElementById('photo-remove-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  document.getElementById('photo-confirm-btn').addEventListener('click', async () => {
    const btn = document.getElementById('photo-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Removing…`;
    
    try {
      const res = await window.api.updateStudentPhoto(studentId, null);
      if (res && res.success) {
        showToast('✓ Photo removed successfully.', 'success');
        close();
        await loadStudents(); // Refresh to update all UI parts
      } else {
        throw new Error(res.error || 'Update failed');
      }
    } catch (err) {
      showToast('Removal failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = `Remove Profile Photo`;
    }
  });
};

// ── Helpers ───────────────────────────────────────────
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  editingId = null;
}

function feeBadge(status) {
  if (status === 'paid') {
    return '<span class="badge badge-success student-fee-badge"><span class="fee-icon" aria-hidden="true">✓</span> Paid</span>';
  }
  if (status === 'pending') {
    return '<span class="badge badge-warning student-fee-badge"><span class="fee-icon" aria-hidden="true">✗</span> Unpaid</span>';
  }
  return `<span class="badge">${esc(status)}</span>`;
}

// Escape HTML to prevent XSS from DB values
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clockIcon() {
  // Styled via CSS using `currentColor`
  return `
    <svg class="slot-clock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </svg>
  `;
}

function getInitials(student) {
  const fullName = `${student?.firstName || ''} ${student?.lastName || ''}`.trim();
  if (!fullName) return '??';
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    // Take first letter of first word and first letter of last word
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function renderRoll(rollNumber) {
  if (rollNumber === null || rollNumber === undefined) return '—';
  const v = String(rollNumber).trim();
  if (!v) return '—';
  return esc(v);
}

function hashString(str) {
  let hash = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  return hash;
}

function avatarGradient(firstName, lastName, studentId) {
  const seed = `${firstName || ''} ${lastName || ''} ${studentId || ''}`.trim().toLowerCase();
  
  // Premium Multi-Stop Gradient Pairs
  const palettes = [
    { bg: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)', glow: 'rgba(255, 107, 107, 0.5)' }, // Sunset
    { bg: 'linear-gradient(135deg, #6366F1 0%, #A855F7 100%)', glow: 'rgba(99, 102, 241, 0.5)' },  // Indigo Violet
    { bg: 'linear-gradient(135deg, #3B82F6 0%, #2DD4BF 100%)', glow: 'rgba(59, 130, 246, 0.5)' },  // Ocean
    { bg: 'linear-gradient(135deg, #F97316 0%, #F59E0B 100%)', glow: 'rgba(249, 115, 22, 0.5)' },  // Fire
    { bg: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)', glow: 'rgba(16, 185, 129, 0.5)' },  // Emerald
    { bg: 'linear-gradient(135deg, #EC4899 0%, #F43F5E 100%)', glow: 'rgba(236, 72, 153, 0.5)' },  // Pink Coral
    { bg: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)', glow: 'rgba(139, 92, 246, 0.5)' },  // Purple Pink
    { bg: 'linear-gradient(135deg, #06B6D4 0%, #3B82F6 100%)', glow: 'rgba(6, 182, 212, 0.5)' },  // Cyan Blue
    { bg: 'linear-gradient(135deg, #F43F5E 0%, #FB923C 100%)', glow: 'rgba(244, 63, 94, 0.5)' },  // Rose Orange
    { bg: 'linear-gradient(135deg, #22C55E 0%, #84CC16 100%)', glow: 'rgba(34, 197, 94, 0.5)' },  // Green Lime
  ];

  const idx = Math.abs(hashString(seed)) % palettes.length;
  return palettes[idx];
}

function getCourseForStudent(student) {
  const key = student?.courseId !== null && student?.courseId !== undefined
    ? String(student.courseId)
    : '';
  return key ? (courseMap.get(key) || null) : null;
}

function getSlotsForStudent(student) {
  const normTime = (t) => String(t||'').replace(/–/g, '-').replace(/\s+/g, '').toLowerCase();
  const dayMapRev = { 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat', 'Sunday': 'Sun' };
  
  // timeKey -> { label: "9:00 AM - 10:00 AM", days: Set<string> }
  const timeGroups = new Map();

  const addSlotToGroup = (timeStr, shortDay) => {
    const nk = normTime(timeStr);
    if (!timeGroups.has(nk)) {
      timeGroups.set(nk, { label: timeStr, days: new Set() });
    }
    if (shortDay) {
      timeGroups.get(nk).days.add(shortDay);
    }
  };

  // 1. Process DB slotId
  if (student?.slotId) {
    const parts = String(student.slotId).split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(p => {
      if (p.includes('|')) {
        const [d, t] = p.split('|');
        addSlotToGroup(t, d);
      } else {
        // Legacy slot ID (like 's1')
        const sObj = slotMap.get(p);
        if (sObj) {
          const t = sObj.label || formatTime12h(sObj.start) || 'Time';
          addSlotToGroup(t, null); 
        }
      }
    });
  }

  // 2. Process dynamically from Slot UI changes
  if (globalSlotData) {
    for (const [day, dayData] of Object.entries(globalSlotData)) {
      const dayStudents = dayData.students || {};
      for (const [sId, enrolledArr] of Object.entries(dayStudents)) {
        if (Array.isArray(enrolledArr) && enrolledArr.includes(String(student.id))) {
          const slotObj = (dayData.slots || []).find(s => s.id === sId) || slotMap.get(sId);
          if (slotObj) {
            const shortDay = dayMapRev[day] || day;
            const t = slotObj.label || (slotObj.start ? formatTime12h(slotObj.start) : '') || 'Time';
            addSlotToGroup(t, shortDay);
          }
        }
      }
    }
  }

  // Generate final labels
  const results = [];
  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (const group of timeGroups.values()) {
    let finalLabel = group.label;
    if (group.days.size > 0) {
      const sortedDays = Array.from(group.days).sort((a, b) => {
         let ixA = dayOrder.indexOf(a);
         let ixB = dayOrder.indexOf(b);
         if (ixA === -1) ixA = 99;
         if (ixB === -1) ixB = 99;
         return ixA - ixB;
      });
      finalLabel += ` (${sortedDays.join(', ')})`;
    }
    results.push({ raw: true, label: finalLabel });
  }

  return results;
}

function getCourseDisplay(course, slot) {
  return course?.name || course?.code || slot?.subject || '—';
}

function getSlotDisplay(slot) {
  if (!slot) return '—';
  if (slot.label) return slot.label;
  const t = slot.startTime || slot.start || '';
  const formatted = formatTime12h(t);
  if (formatted) return formatted;
  return slot.name || slot.subject || '—';
}

function formatTime12h(time24) {
  if (!time24) return '';
  const m = String(time24).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(time24);
  let hh = Number(m[1]);
  const mm = m[2];
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ampm}`;
}

// ============================================================================
// ── Google Sheets Import & Photo Management ─────────────────────────────────
// ============================================================================
// The following code handles the 3-step bulk import flow from Google Sheets
// as well as delegating clicks for the "Change Photo" action on student rows.

// Temporarily stores parsed sheet data before user confirms insertion
let importPendingRows = [];

function initGoogleImportListeners() {
  
  // ── 1. Modal State & Toggle Listeners ─────────────────────────────────
  // Controls the visibility of the multi-step import modal overlay
  const modal = document.getElementById('import-modal');
  
  // Opens the modal and resets to Step 1 (Input Sheet ID)
  document.getElementById('btn-open-import')?.addEventListener('click', () => {
    document.getElementById('input-sheet-id').value = '';
    document.getElementById('import-step1-status').textContent = '';
    
    // Reset display states for all steps
    document.getElementById('import-step-1').style.display = 'block';
    document.getElementById('import-step-2').style.display = 'none';
    document.getElementById('import-step-3').style.display = 'none';
    // Display modal by adding native app class
    modal.classList.add('active');
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  // Closes the modal from the top-right X button
  document.getElementById('btn-close-import')?.addEventListener('click', () => { 
    // Close using native app class
    modal.classList.remove('active'); 
  });
  
  // "Back" button from Step 2 (Preview) to Step 1 (Input)
  document.getElementById('btn-back-to-step1')?.addEventListener('click', () => {
    document.getElementById('import-step-1').style.display = 'block';
    document.getElementById('import-step-2').style.display = 'none';
  });
  
  // "Done" button on Step 3 (Success Screen). Triggers a full data reload.
  document.getElementById('btn-close-after-import')?.addEventListener('click', () => { 
    modal.classList.remove('active'); 
    if(window.initStudentPage) window.initStudentPage(); // Refresh table from DB
  });

  // ── 2. Data Fetching & Preview (Step 1 -> Step 2) ────────────────────
  // Calls the backend to fetch the sheet data, maps it, and renders a preview table
  document.getElementById('btn-load-preview')?.addEventListener('click', async () => {
    const sheetId = document.getElementById('input-sheet-id').value.trim();
    if (!sheetId) return;

    const statusEl = document.getElementById('import-step1-status');
    statusEl.textContent = 'Loading and mapping your Google Sheet...';
    
    try {
      // IPC call to preview data silently without writing to DB
      const result = await window.api.importPreviewSheet(sheetId);
      importPendingRows = result.rows;
      
      // If the sheet contains Course Names that don't match the DB exact names,
      // warn the user so they know course assignment might default to empty.
      const warnBox = document.getElementById('unmatched-courses-warning');
      if (result.unmatchedCourses && result.unmatchedCourses.length > 0) {
        document.getElementById('unmatched-list').textContent = result.unmatchedCourses.join(', ');
        warnBox.style.display = 'block';
      } else {
        warnBox.style.display = 'none';
      }

      // Render the fetched rows into the preview table UI
      const tbody = document.getElementById('preview-tbody');
      tbody.innerHTML = importPendingRows.map((r, i) => `
        <tr>
          <td><input type="checkbox" class="cb-import-row" data-index="${i}" checked /></td>
          <td>${r.firstName} ${r.lastName}</td>
          <td>${r.phone}</td>
          <td>${r.email}</td>
          <td style="${!r.courseId ? 'color:var(--danger)' : ''}">${r.rawCourseName || '—'}</td>
          <td>${r.dob || '—'}</td>
          <td>${r.category || '—'}</td>
          <td>${r.fatherName || '—'}</td>
          <td>${r.motherName || '—'}</td>
          <td>${r.address || '—'}</td>
          <td>${r.drivePhotoUrl ? '✓' : '—'}</td>
        </tr>
      `).join('');

      document.getElementById('preview-summary').textContent = `Found ${importPendingRows.length} students. Please review the mappings below.`;
      
      // Transition to Step 2
      document.getElementById('import-step-1').style.display = 'none';
      document.getElementById('import-step-2').style.display = 'block';
      
      // Initialize the button text counter (e.g. "Import Selected (50)")
      updateConfirmBtnText(); 
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  });

  // ── 3. Checkbox Selection Logic (Step 2) ──────────────────────────────
  // Handle mass selection/deselection to skip problematic students
  
  document.getElementById('btn-preview-sel-all')?.addEventListener('click', () => {
    document.querySelectorAll('.cb-import-row').forEach(cb => cb.checked = true);
    updateConfirmBtnText();
  });
  
  document.getElementById('btn-preview-desel-all')?.addEventListener('click', () => {
    document.querySelectorAll('.cb-import-row').forEach(cb => cb.checked = false);
    updateConfirmBtnText();
  });

  // Event delegation to watch individual checkbox ticks in the table
  document.getElementById('import-modal')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('cb-import-row')) updateConfirmBtnText();
  });

  // Helper to dynamically update the final call-to-action button
  function updateConfirmBtnText() {
    const count = document.querySelectorAll('.cb-import-row:checked').length;
    document.getElementById('btn-confirm-import').textContent = `Import Selected (${count})`;
  }

  // ── 4. Final Import Execution (Step 2 -> Step 3) ──────────────────────
  // Submits the selected rows to the backend to bulk-insert and download photos 
  document.getElementById('btn-confirm-import')?.addEventListener('click', async () => {
    // Gather all indexes from checked boxes
    const checkedIndexes = Array.from(document.querySelectorAll('.cb-import-row:checked')).map(cb => cb.dataset.index);
    const rowsToImport = checkedIndexes.map(idx => importPendingRows[idx]);

    if (rowsToImport.length === 0) return;

    const btn = document.getElementById('btn-confirm-import');
    btn.textContent = 'Importing... Please wait (Downloading Photos)';
    btn.disabled = true;

    try {
      // IPC call to write rows to SQLite and download/save Google Drive images
      const resp = await window.api.importExecute(rowsToImport);
      
      // Transition to Step 3 (Success Display)
      document.getElementById('import-step-2').style.display = 'none';
      document.getElementById('import-step-3').style.display = 'block';
      
      // Print detailed statistics returned from SQLite transaction
      document.getElementById('import-result-msg').innerHTML = 
        `Import process complete.<br/><br/>
         ✅ <b>${resp.inserted}</b> new students added.<br/>
         ⏭️ <b>${resp.skipped}</b> skipped (due to duplicate IDs).<br/>
         ⚠️ <b>${resp.photosFailed}</b> photos failed to download.`;
    } catch (e) {
      alert("Import Error: " + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ── 5. "Change Photo" Delegation (Main Student Table) ──────────────────
  // Event Delegation specifically inside the student table to catch dynamic buttons.
  // This lives here because it relies on the same photo-upload IPC system.
  document.getElementById('students-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-change-photo');
    if (!btn) return; // Ignore clicks if they weren't on the 'Change Photo' button
    
    // Read the unique student ID attached to the button
    const dbId = btn.dataset.studentId; 
    
    // Trigger OS-level native File Picker to select an image
    const filePath = await window.api.openFileDialog();
    
    if (filePath) {
      // Send file path to backend to save into database mapping
      const res = await window.api.updateStudentPhoto(dbId, filePath);
      
      if (res && res.success) {
        // --- Lightning-Fast UI Render ---
        // Target the thumb-wrapper specifically to clear any initials or existing photo
        const row = btn.closest('tr');
        const cell = row ? row.querySelector('td.col-photo') : null;
        const wrapper = cell ? cell.querySelector('.thumb-wrapper') : null;
        
        if (wrapper) {
          // Completely replace contents to prevent overlap
          // Use a cache-busting UNIX timestamp (?t=12345) to bypass chromium's strict local file cache
          wrapper.innerHTML = `<img src="file://${res.photoPath}?t=${Date.now()}" class="student-thumb" />`;
        } else if (cell) {
          // Fallback for unexpected missing wrapper: create one and add the image
          cell.innerHTML = `
            <div class="thumb-wrapper" onclick="event.stopPropagation(); openRemovePhotoConfirm('${dbId}', '${dbId}', '');" title="Click to remove photo">
              <img src="file://${res.photoPath}?t=${Date.now()}" class="student-thumb" />
            </div>`;
        }
      } else {
        alert("Failed to update photo in database.");
      }
    }
  });
}
