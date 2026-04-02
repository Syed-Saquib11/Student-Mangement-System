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

// ── Init (called by renderer.js after injecting the page HTML) ─
window.initStudentPage = async function () {
  await loadStudents();
  bindSearchAndFilter();
  bindAddButton();
};

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

  counter.textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;

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
    return;
  }

  tbody.innerHTML = students.map((s, idx) => {
    const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim();
    const initials  = getInitials(s);
    const avatarBg  = avatarGradient(s.firstName, s.lastName, s.studentId);
    const course    = getCourseForStudent(s);
    const slots     = getSlotsForStudent(s);
    const courseTxt = course?.name || course?.code || (slots[0]?.subject || '—');

    return `
      <tr data-id="${s.id}" style="opacity: 0; animation: sectionPopUp 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; animation-delay: ${0.28 + (idx * 0.06)}s">
        <td class="col-photo">
          <div class="student-avatar" style="background:${avatarBg};"><span class="avatar-initials">${esc(initials)}</span></div>
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
            <span>Edit</span>
          </button>
        </td>
        <td class="col-action">
          <div class="action-cell">
            <button class="btn btn-sm btn-action btn-view" onclick="openViewModal(${s.id})" title="View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>View</span>
            </button>
            <button class="btn btn-sm btn-action btn-delete" onclick='openDeleteConfirm(${s.id}, ${JSON.stringify(fullName)})' title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderStats(students) {
  const el = document.getElementById('student-stats');
  if (!el) return;

  const pending = students.filter(s => s.feeStatus === 'pending').length;
  
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
        s.firstName.toLowerCase().includes(query)  ||
        s.lastName.toLowerCase().includes(query)   ||
        (s.rollNumber || '').toLowerCase().includes(query) ||
        s.studentId.toLowerCase().includes(query)
      );
    }

    if (fee) {
      results = results.filter(s => s.feeStatus === fee);
    }

    if (course) {
      results = results.filter(s => String(s.courseId ?? '') === String(course));
    }

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
    openStudentViewModal(student);
  } catch (err) {
    showToast('Could not load student data.', 'error');
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

  const rawSlots = (student?.slotId ? String(student.slotId).split(',') : []).filter(s => s.includes('|'));
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
  const rollValue = String(student?.rollNumber || '').replace(/^#/, '');

  const statusValue = student?.status || 'Active';

  const modalHtml = `
    <div class="modal-overlay" id="student-modal-overlay">
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


            <div class="form-group">
              <label class="form-label edit-form-label">ROLL NUMBER</label>
              <input class="form-input edit-form-input" id="inp-roll" type="text" placeholder="01" value="${esc(rollValue)}" />
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
              <label class="form-label edit-form-label">FEE AMOUNT (₹)</label>
              <input class="form-input edit-form-input" id="inp-feeAmount" type="number" placeholder="15000" value="${esc(student?.feeAmount || '')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">FEE STATUS</label>
              <select class="form-select edit-form-select" id="inp-fee">
                <option value="paid" ${(!student || student.feeStatus === 'paid') ? 'selected' : ''}>Paid</option>
                <option value="pending" ${student?.feeStatus === 'pending' ? 'selected' : ''}>Unpaid</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">STATUS</label>
              <select class="form-select edit-form-select" id="inp-status">
                <option value="Active" ${(statusValue === 'Active') ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${(statusValue === 'Inactive') ? 'selected' : ''}>Inactive</option>
              </select>
            </div>
          </div>

          <h4 style="margin: 24px 0 16px; font-size: 11.5px; color: #94a3b8; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; letter-spacing: 0.8px;">Parent / Guardian Info</h4>
          <div class="form-grid edit-form-grid">
            <div class="form-group">
              <label class="form-label edit-form-label">PARENT / GUARDIAN NAME</label>
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
      const arr = [];
      if (day1 && time1) arr.push(`${day1}|${time1}`);
      if (day2 && time2) arr.push(`${day2}|${time2}`);
      return arr.join(',');
    })(),
    phone:       document.getElementById('inp-phone')?.value.trim(),
    feeAmount:   Number(document.getElementById('inp-feeAmount')?.value) || 0,
    feeStatus:   document.getElementById('inp-fee')?.value,
    status:      document.getElementById('inp-status')?.value,
    parentName:  document.getElementById('inp-parentName')?.value.trim(),
    parentPhone: document.getElementById('inp-parentPhone')?.value.trim(),
    address:     document.getElementById('inp-address')?.value.trim(),
  };

  const saveBtn = document.getElementById('modal-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    if (editingId) {
      await window.api.updateStudent(editingId, data);
      showToast('Student updated successfully.', 'success');
    } else {
      await window.api.addStudent(data);
      showToast('Student added successfully.', 'success');
    }
    closeModal();
    await loadStudents();
  } catch (err) {
    showToast(err || 'Something went wrong.', 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = editingId ? 'Save Changes' : 'Add Student';
  }
}

function openStudentViewModal(student) {
  const fullName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
  const course   = getCourseForStudent(student);
  const slot     = getSlotForStudent(student);

  const avatarBg = avatarGradient(student.firstName, student.lastName, student.studentId);
  const initials = getInitials(student);

  const modalHtml = `
    <div class="modal-overlay" id="student-view-overlay">
      <div class="modal" style="max-width: 640px; padding: 0; overflow: hidden; border-radius: 12px;">
        
        <!-- Header area with vibrant subtle background -->
        <div style="background: #f8fafc; padding: 24px 32px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="display: flex; gap: 20px; align-items: center;">
            <div class="student-avatar student-avatar-lg" style="background:${avatarBg}; width: 72px; height: 72px; font-size: 24px; box-shadow: 0 8px 16px rgba(0,0,0,0.1);"><span class="avatar-initials">${esc(initials)}</span></div>
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

        <div class="modal-body" style="padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 28px;">
          
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
                <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; text-transform: uppercase;">Student Mobile</div>
                <div style="font-size: 14px; color: #334155;">${esc(student.phone || '—')}</div>
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
    <div class="modal-overlay" id="delete-modal-overlay">
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
  const first = String(student?.firstName || '').trim();
  const last  = String(student?.lastName || '').trim();
  const id    = String(student?.studentId || '').trim();

  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first[0].toUpperCase();
  if (last) return last[0].toUpperCase();
  return id.slice(0, 2).toUpperCase() || '—';
}

function renderRoll(rollNumber) {
  if (rollNumber === null || rollNumber === undefined) return '—';
  const v = String(rollNumber).trim();
  if (!v) return '—';
  return v.startsWith('#') ? esc(v) : esc(`#${v}`);
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
  // Deterministic vivid gradient backgrounds — one per student, always the same.
  const seed = `${firstName || ''}|${lastName || ''}|${studentId || ''}`;
  const gradients = [
    'linear-gradient(135deg, #06b6d4, #0ea5e9)',   // cyan-sky  (like AK)
    'linear-gradient(135deg, #f59e0b, #ef4444)',   // amber-red (like PS)
    'linear-gradient(135deg, #ef4444, #dc2626)',   // red       (like RM)
    'linear-gradient(135deg, #22c55e, #16a34a)',   // green     (like SG)
    'linear-gradient(135deg, #8b5cf6, #7c3aed)',   // purple    (like VN)
    'linear-gradient(135deg, #3b82f6, #6366f1)',   // blue-indigo
    'linear-gradient(135deg, #f97316, #ef4444)',   // orange-red
    'linear-gradient(135deg, #ec4899, #8b5cf6)',   // pink-purple
    'linear-gradient(135deg, #14b8a6, #06b6d4)',   // teal-cyan
    'linear-gradient(135deg, #10b981, #3b82f6)',   // emerald-blue
  ];
  const idx = Math.abs(hashString(seed)) % gradients.length;
  return gradients[idx];
}

function getCourseForStudent(student) {
  const key = student?.courseId !== null && student?.courseId !== undefined
    ? String(student.courseId)
    : '';
  return key ? (courseMap.get(key) || null) : null;
}

function getSlotsForStudent(student) {
  let ids = [];
  if (student?.slotId) {
    ids = String(student.slotId).split(',').map(s => s.trim()).filter(Boolean);
  }

  // If not explicitly saved via dropdown, actively scan the rich Slots module data 
  // to see if they were enrolled via the 'Add Students' button in the Slot UI!
  if (globalSlotData) {
    for (const day of Object.keys(globalSlotData)) {
      const dayStudents = globalSlotData[day].students || {};
      for (const [sId, enrolledArr] of Object.entries(dayStudents)) {
        if (Array.isArray(enrolledArr) && enrolledArr.includes(String(student.id))) {
          if (!ids.includes(sId)) ids.push(sId);
        }
      }
    }
  }

  return ids.map(id => {
    if (id.includes('|')) {
      const [d, t] = id.split('|');
      return { raw: true, label: `${t} (${d})` };
    }
    return slotMap.get(id);
  }).filter(Boolean);
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
