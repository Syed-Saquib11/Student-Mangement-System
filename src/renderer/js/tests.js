// src/renderer/js/tests.js
// Tests & Grades module

'use strict';

let testsData = [];
let gradesData = [];
let systemCourses = [];
let currentFilter = 'all';
let currentGradesPage = 1;
const GRADES_PAGE_SIZE = 15;

// defaultGrades removed, using dynamic gradesData from database

window.initTests = async function initTests() {
  try {
    testsData = await window.api.getAllTests();
  } catch (e) {
    console.error(e);
    testsData = [];
  }
  try {
    gradesData = await window.api.getGradesOverview();
  } catch (e) {
    console.error(e);
    gradesData = [];
  }
  try {
    systemCourses = await window.api.getCourses();
  } catch (e) {
    console.error(e);
    systemCourses = [];
  }

  populateGradeCourseFilter();
  renderGradesTable();
  renderDashboard();
  bindEvents();
  bindKeyboardShortcuts();
};

window.destroyTests = function () {
  document.removeEventListener('keydown', _testsKeyHandler);
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', _testsKeyHandler);
}

function _testsKeyHandler(e) {
  // ESC-only close - backdrop click disabled
  if (e.key === 'Escape') {
    const editor = document.getElementById('test-editor-overlay');
    if (editor && !editor.classList.contains('hidden')) {
       editor.classList.add('hidden');
    }

    const importModal = document.getElementById('import-form-modal');
    if (importModal?.classList.contains('active')) {
       importModal.classList.remove('active');
    }

    // Dynamic modals in root
    const root = document.getElementById('modal-root');
    if (root && root.innerHTML !== '') {
       root.innerHTML = '';
    }
  }

  if (e.key === 'Enter') {
    // Don't trigger if in a textarea (long questions in editor use textareas)
    if (document.activeElement.tagName === 'TEXTAREA') return;

    const editor = document.getElementById('test-editor-overlay');
    const importModal = document.getElementById('import-form-modal');

    if (!editor.classList.contains('hidden')) {
      const btn = document.getElementById('btn-save-editor');
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    } else if (importModal.classList.contains('active')) {
      const s1 = document.getElementById('form-import-step-1');
      const s2 = document.getElementById('form-import-step-2');
      if (s1 && !s1.classList.contains('hidden')) {
         const btn = document.getElementById('btn-load-form-preview');
         if (btn) { e.preventDefault(); btn.click(); }
      } else if (s2 && !s2.classList.contains('hidden')) {
         const btn = document.getElementById('btn-confirm-form-import');
         if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      }
    }
  }
}

function formatSelectedText(type) {
  const active = document.activeElement;
  if (!active || active.tagName !== 'TEXTAREA') return;

  const start = active.selectionStart;
  const end = active.selectionEnd;
  if (start === end) return; 

  const originalText = active.value.substring(start, end);
  let newText = originalText;

  if (type === 'bold') {
    newText = toUnicodeVariant(originalText, 'bold');
  } else if (type === 'italic') {
    newText = toUnicodeVariant(originalText, 'italic');
  } else if (type === 'underline') {
    newText = originalText.split('').map(c => c + '\u0332').join('');
  }

  active.setRangeText(newText, start, end, 'select');
  active.dispatchEvent(new Event('input', { bubbles: true }));
}

function toUnicodeVariant(str, variant) {
  const offsets = {
    bold: { A: 0x1D5D4, a: 0x1D5EE, 0: 0x1D7EC },
    italic: { A: 0x1D608, a: 0x1D622 } 
  };
  const off = offsets[variant];
  if (!off) return str;

  return str.split('').map(c => {
    let code = c.charCodeAt(0);
    if (code >= 0x41 && code <= 0x5A) return String.fromCodePoint(off.A + (code - 0x41));
    if (code >= 0x61 && code <= 0x7A) return String.fromCodePoint(off.a + (code - 0x61));
    if (variant === 'bold' && code >= 0x30 && code <= 0x39) return String.fromCodePoint(off['0'] + (code - 0x30));
    return c;
  }).join('');
}

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tests-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tests-tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderTestGrid();
    });
  });

  // Search
  document.getElementById('tests-search')?.addEventListener('input', () => {
    renderTestGrid();
  });

  document.getElementById('grade-search')?.addEventListener('input', () => {
    currentGradesPage = 1;
    renderGradesTable();
  });

  // Editor title sync
  document.getElementById('editor-top-title')?.addEventListener('input', (e) => {
    document.getElementById('paper-title').textContent = e.target.value;
  });

  // Editor PDF Event Listener
  document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
    if (!editorWorkingTest) return;
    const btn = document.getElementById('btn-export-pdf');
    const ogText = btn.textContent;
    btn.textContent = "WAIT...";
    try {
      const res = await window.api.exportPDF({ filename: editorWorkingTest.title });
      if (res.ok) {
        if (typeof window.showToast === 'function') window.showToast('PDF saved successfully!', 'success');
        else alert('PDF saved successfully!');
      } else {
        if (res.error !== 'Download canceled') {
          if (typeof window.showToast === 'function') window.showToast('Error: ' + res.error, 'error');
          else alert('Error: ' + res.error);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      btn.textContent = ogText;
    }
  });

  // Global Click Event Delegation
  document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (target.closest('.t-btn[title="Bold"]')) { e.preventDefault(); formatSelectedText('bold'); }
    if (target.closest('.t-btn[title="Italic"]')) { e.preventDefault(); formatSelectedText('italic'); }
    if (target.closest('.t-btn[title="Underline"]')) { e.preventDefault(); formatSelectedText('underline'); }
  });

  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('q-marks-input')) {
      updateEditorTotals();
    }
    if (e.target.id === 'select-id-question') {
      mapFormStudents();
    }
    // Grade filters
    if (e.target.id === 'grade-course-filter' || e.target.id === 'grade-status-filter'
      || e.target.id === 'grade-exam-filter' || e.target.id === 'grade-sort') {
      currentGradesPage = 1;
      renderGradesTable();
    }
  });

  // Global Click Event Delegation
  document.addEventListener('click', (e) => {
    const target = e.target;

    // Top level
    if (target.closest('#btn-add-test')) openTestModal();

    // Editor panel control
    if (target.closest('#btn-close-editor')) {
      document.getElementById('test-editor-overlay').classList.add('hidden');
    }
    if (target.closest('#btn-save-editor')) saveTestEditor();

    // Editor add questions
    if (target.closest('#btn-ed-mcq')) addEditorQuestion('mcq');
    if (target.closest('#btn-ed-short')) addEditorQuestion('short');
    if (target.closest('#btn-ed-long')) addEditorQuestion('long');

    // Editor internal actions
    const rmBtn = target.closest('.btn-remove-q');
    if (rmBtn) removeEditorQuestion(rmBtn);

    const mkCorrectBtn = target.closest('.btn-mark-correct');
    if (mkCorrectBtn) toggleOptionCorrect(mkCorrectBtn);

    // Test grid actions
    const viewBtn = target.closest('.action-view');
    if (viewBtn) openTestEditor(parseInt(viewBtn.dataset.id, 10));

    const pdfBtn = target.closest('.action-pdf');
    if (pdfBtn) downloadTestPDF(parseInt(pdfBtn.dataset.id, 10));

    const delBtn = target.closest('.action-delete');
    if (delBtn) deleteTest(parseInt(delBtn.dataset.id, 10));

    const delResultBtn = target.closest('.action-delete-result');
    if (delResultBtn) window.deleteResult(parseInt(delResultBtn.dataset.id, 10));

    const publishBtn = target.closest('.action-publish');
    if (publishBtn) handlePublishTest(parseInt(publishBtn.dataset.id, 10), publishBtn);

    // Import Form Modal Actions
    if (target.closest('#btn-import-grades')) openFormImportModal();
    if (target.closest('#btn-close-form-import') || target.closest('#btn-form-back-step1')) {
      document.getElementById('import-form-modal').classList.remove('active');
    }
    if (target.closest('#btn-load-form-preview')) loadFormPreview();
    if (target.closest('#btn-map-form-students')) mapFormStudents();
    if (target.closest('#btn-confirm-form-import')) executeFormImport();
  });
}

function renderDashboard() {
  renderStats();
  renderTestGrid();
  renderGradesTable();
}

// ── Stats rendering ──────────────────────────────────────
function renderStats() {
  const container = document.getElementById('tests-stats-container');
  if (!container) return;

  const total = testsData.length;
  const published = testsData.filter(t => t.status === 'PUBLISHED').length;

  // Compute real submissions and average from gradesData
  let totalSub = 0;
  let totalAvg = 0;
  let studentsWithTests = 0;
  gradesData.forEach(g => {
    const numTests = g.tests ? g.tests.length : 0;
    totalSub += numTests;
    if (numTests > 0) {
      let sMax = 0;
      let sActual = 0;
      g.tests.forEach(t => {
         const testMeta = testsData.find(td => td.id === t.testId);
         let tMax = 0;
         if (testMeta && testMeta.questions) {
            tMax = testMeta.questions.reduce((sum, q) => sum + (parseInt(q.marks) || 0), 0);
         }
         if (tMax === 0) tMax = 100;
         sMax += tMax;
         sActual += (t.score || 0);
      });
      const avg = sMax > 0 ? (sActual / sMax) * 100 : 0;
      totalAvg += avg;
      studentsWithTests++;
    }
  });
  const classAvg = studentsWithTests > 0 ? Math.round(totalAvg / studentsWithTests) : 0;

  container.innerHTML = `
  <div class="stat-card-elegant">
    <div class="stat-info">
      <span class="stat-title">TOTAL TESTS</span>
      <span class="stat-value">${total}</span>
    </div>
    <div class="stat-icon-wrapper stat-icon-blue">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    </div>
  </div>
  <div class="stat-card-elegant">
    <div class="stat-info">
      <span class="stat-title">PUBLISHED</span>
      <span class="stat-value">${published}</span>
    </div>
    <div class="stat-icon-wrapper stat-icon-green">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="8" r="7"/>
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
      </svg>
    </div>
  </div>
  <div class="stat-card-elegant">
    <div class="stat-info">
      <span class="stat-title">CLASS AVERAGE</span>
      <span class="stat-value">${classAvg}%</span>
    </div>
    <div class="stat-icon-wrapper stat-icon-purple">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    </div>
  </div>
  <div class="stat-card-elegant">
    <div class="stat-info">
      <span class="stat-title">SUBMISSIONS</span>
      <span class="stat-value">${totalSub}</span>
    </div>
    <div class="stat-icon-wrapper stat-icon-yellow">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    </div>
  </div>
`;
}
// ── Test Grid rendering ──────────────────────────────────
function renderTestGrid() {
  const container = document.getElementById('tests-grid');
  const searchEl = document.getElementById('tests-search');
  if (!container) return;

  let query = '';
  if (searchEl) query = searchEl.value.toLowerCase().trim();

  let filtered = testsData;
  if (currentFilter !== 'all') {
    filtered = filtered.filter(t => t.status && t.status.toLowerCase() === currentFilter);
  }
  if (query) {
    filtered = filtered.filter(t =>
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.courseId && t.courseId.toString().includes(query))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">No tests found matching criteria.</div>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    // Assuming marks is sum of question marks (you might need logic to calculate this)
    let marksTotal = 0;
    let numQuestions = 0;
    if (t.questions && Array.isArray(t.questions)) {
      marksTotal = t.questions.reduce((sum, q) => sum + (parseInt(q.marks) || 0), 0);
      numQuestions = t.questions.length;
    }
    const displayDate = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : 'N/A';

    let courseDisplay = t.courseId;
    if (systemCourses && t.courseId) {
      const foundCourse = systemCourses.find(c => String(c.id) === String(t.courseId));
      if (foundCourse) courseDisplay = foundCourse.name || foundCourse.courseName || t.courseId;
    }

    return `
      <div class="test-card">
        <div class="test-header theme-${t.color}">
          <div class="test-title-row">
            <div class="test-title">${esc(t.title)}</div>
            <div class="test-badge">${t.status}</div>
          </div>
          <div class="test-course">Course: ${esc(courseDisplay)}</div>
        </div>
        
        <div class="test-stats-grid">
          <div class="test-stat-col">
            <span class="test-stat-val">${marksTotal}</span>
            <span class="test-stat-lbl">Marks</span>
          </div>
          <div class="test-stat-col">
            <span class="test-stat-val">${t.duration || 0}m</span>
            <span class="test-stat-lbl">Duration</span>
          </div>
          <div class="test-stat-col">
            <span class="test-stat-val">${numQuestions}</span>
            <span class="test-stat-lbl">No of Questions</span>
          </div>
        </div>

        <div class="test-meta">
          <div class="test-meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${esc(displayDate)}
          </div>
        </div>

        <div class="test-actions">
          <button class="btn-view action-view" data-id="${t.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            View
          </button>
          <button class="btn-icon-sq action-pdf" title="Download" data-id="${t.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn-icon-sq action-delete" title="Delete" data-id="${t.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
          ${t.status === 'PUBLISHED' ? `
            <button class="btn-publish action-publish" data-id="${t.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" stroke-width="2.5">
                <path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/>
              </svg>
              Publish
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.deleteTest = function (id) {
  const root = document.getElementById('modal-root');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-overlay active" id="del-overlay">
      <div class="modal" style="width: 400px; padding: 24px;">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <h3 style="font-family:var(--font-display); font-size:18px; font-weight:800; color:var(--danger);">DELETE TEST</h3>
          <p style="font-size:14px; color:var(--text-secondary); line-height:1.5;">
            Are you sure you want to delete this test? This action cannot be undone and will remove all student submissions.
          </p>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:32px;">
          <button class="btn btn-ghost" id="del-cancel">Cancel</button>
          <button class="btn btn-primary" id="del-confirm" style="background:var(--danger); border-color:var(--danger); font-weight:800; letter-spacing:0.05em;">DELETE</button>
        </div>
      </div>
    </div>
  `;

  const closeFn = () => { root.innerHTML = ''; };
  document.getElementById('del-cancel').addEventListener('click', closeFn);
  // ESC-only close - backdrop click disabled
  // document.getElementById('del-overlay').addEventListener('click', (e) => {
  //   if (e.target === e.currentTarget) closeFn();
  // });

  document.getElementById('del-confirm').addEventListener('click', async () => {
    try {
      await window.api.deleteTest(id);
      testsData = await window.api.getAllTests();
      renderDashboard();
      closeFn();
      if (typeof window.showToast === 'function') window.showToast('Test deleted successfully.', 'success');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('Error deleting test.', 'error');
    }
  });
};

window.deleteResult = function (resultId) {
  const root = document.getElementById('modal-root');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-overlay active" id="del-res-overlay">
      <div class="modal" style="width: 400px; padding: 24px;">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <h3 style="font-family:var(--font-display); font-size:18px; font-weight:800; color:var(--danger);">DELETE GRADE</h3>
          <p style="font-size:14px; color:var(--text-secondary); line-height:1.5;">
            Are you sure you want to delete this grade? This will permanently remove the student's submission for this test.
          </p>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:32px;">
          <button class="btn btn-ghost" id="del-res-cancel">Cancel</button>
          <button class="btn btn-primary" id="del-res-confirm" style="background:var(--danger); border-color:var(--danger); font-weight:800; letter-spacing:0.05em;">DELETE</button>
        </div>
      </div>
    </div>
  `;

  const closeFn = () => { root.innerHTML = ''; };
  document.getElementById('del-res-cancel').addEventListener('click', closeFn);
  // ESC-only close - backdrop click disabled
  // document.getElementById('del-res-overlay').addEventListener('click', (e) => {
  //   if (e.target === e.currentTarget) closeFn();
  // });

  document.getElementById('del-res-confirm').addEventListener('click', async () => {
    try {
      await window.api.deleteTestResult(resultId);
      gradesData = await window.api.getGradesOverview();
      renderGradesTable();
      renderDashboard();
      closeFn();
      if (typeof window.showToast === 'function') window.showToast('Grade deleted successfully.', 'success');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('Error deleting grade.', 'error');
    }
  });
};

// ── Course filter population ─────────────────────────────
function populateGradeCourseFilter() {
  const sel = document.getElementById('grade-course-filter');
  if (!sel) return;
  sel.innerHTML = '<option value="all">All Courses</option>';
  (systemCourses || []).forEach(c => {
    const name = c.name || c.courseName || '';
    sel.innerHTML += `<option value="${esc(name)}">${esc(name)}</option>`;
  });
}

// ── Grades rendering ─────────────────────────────────────
function renderGradesTable() {
  const tbody = document.getElementById('grades-tbody');
  if (!tbody) return;

  // Read filter values
  const searchQuery = document.getElementById('grade-search')?.value.toLowerCase().trim() || '';
  const courseFilter = document.getElementById('grade-course-filter')?.value || 'all';
  const statusFilter = document.getElementById('grade-status-filter')?.value || 'all';
  const examFilter = document.getElementById('grade-exam-filter')?.value || 'all';
  const sortBy = document.getElementById('grade-sort')?.value || 'name-asc';

  // Enrich each student with computed fields
  let enriched = gradesData.map((g, idx) => {
    const numTests = g.tests ? g.tests.length : 0;
    let maxTotalScore = 0;
    let actualTotalScore = 0;
    
    if (numTests > 0) {
      g.tests.forEach(t => {
         const testMeta = testsData.find(td => td.id === t.testId);
         let maxMarks = 0;
         if (testMeta && testMeta.questions) {
            maxMarks = testMeta.questions.reduce((sum, q) => sum + (parseInt(q.marks) || 0), 0);
         }
         if (maxMarks === 0) maxMarks = 100;

         maxTotalScore += maxMarks;
         actualTotalScore += (t.score || 0);
      });
    }
    const avgScore = maxTotalScore > 0 ? Math.round((actualTotalScore / maxTotalScore) * 100) : 0;

    // Test 1 and Test 2 columns
    const test1 = g.tests && g.tests[0] ? g.tests[0].score : '—';
    const test2 = g.tests && g.tests[1] ? g.tests[1].score : '—';

    // New Status Logic
    // Excellent (green) >= 85
    // Good (yellow/orange) 50-84
    // Fail (red) < 50
    let status = 'Fail';
    let statusClass = 'status-fail';

    if (numTests > 0) {
      if (avgScore >= 85) {
        status = 'Excellent';
        statusClass = 'status-excellent';
      } else if (avgScore >= 50) {
        status = 'Good';
        statusClass = 'status-pass'; // Using status-pass color for "Good"
      } else {
        status = 'Fail';
        statusClass = 'status-fail';
      }
    }

    return {
      ...g,
      numTests,
      avgScore,
      status,
      statusClass,
      test1,
      test2,
      avatar: getTestAvatarSVG(g.firstName, g.lastName, idx)
    };
  });

  // Filter: search
  if (searchQuery) {
    enriched = enriched.filter(g =>
      (g.firstName + ' ' + g.lastName).toLowerCase().includes(searchQuery) ||
      (g.studentId || '').toLowerCase().includes(searchQuery) ||
      (g.rollNumber || '').toLowerCase().includes(searchQuery) ||
      (g.courseCode || '').toLowerCase().includes(searchQuery) ||
      (g.courseName || '').toLowerCase().includes(searchQuery)
    );
  }

  // Filter: course
  if (courseFilter !== 'all') {
    enriched = enriched.filter(g => (g.courseName || '') === courseFilter);
  }

  // Filter: status
  if (statusFilter !== 'all') {
    enriched = enriched.filter(g => g.status.toLowerCase() === statusFilter);
  }

  // Filter: exam taken only
  if (examFilter === 'taken') {
    enriched = enriched.filter(g => g.numTests > 0);
  }

  // Sort
  enriched.sort((a, b) => {
    switch (sortBy) {
      case 'name-desc': return (b.firstName + b.lastName).localeCompare(a.firstName + a.lastName);
      case 'score-desc': return b.avgScore - a.avgScore;
      case 'score-asc': return a.avgScore - b.avgScore;
      case 'tests-desc': return b.numTests - a.numTests;
      case 'name-asc':
      default: return (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName);
    }
  });

  // Pagination Logic
  const totalStudents = enriched.length;
  const totalPages = Math.ceil(totalStudents / GRADES_PAGE_SIZE);
  
  // Slice for current page
  const startIndex = (currentGradesPage - 1) * GRADES_PAGE_SIZE;
  const pageData = enriched.slice(startIndex, startIndex + GRADES_PAGE_SIZE);

  tbody.innerHTML = pageData.map(g => {
    const studentName = esc(g.firstName + ' ' + g.lastName);

    return `
      <tr>
        <td style="padding-left: 16px;">
          <div style="display: flex; align-items: center; gap: 14px; padding: 6px 0;">
            ${g.avatar}
            <div style="display: flex; flex-direction: column; justify-content: center; gap: 2px;">
              <strong style="color: var(--text-primary); font-size: 14px; font-weight: 600; font-family: var(--font-display);">${studentName}</strong>
              <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${esc(g.studentId)}</span>
            </div>
          </div>
        </td>
        <td style="font-weight: 500;">${esc(g.rollNumber || '—')}</td>
        <td><span class="test-course-pill">${esc(g.courseCode || '—')}</span></td>
        <td style="font-weight: 500; color: var(--text-primary);">${g.test1}</td>
        <td style="font-weight: 500; color: var(--text-primary);">${g.test2}</td>
        <td style="font-weight: 700; color: var(--accent);">${g.avgScore}%</td>
        <td><span class="status-pill ${g.statusClass}">${g.status}</span></td>
      </tr>
    `;
  }).join('');

  renderGradesPagination(totalStudents, totalPages);
}

function renderGradesPagination(totalStudents, totalPages) {
  const container = document.getElementById('grades-pagination');
  if (!container) return;

  if (totalStudents === 0 || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const start = (currentGradesPage - 1) * GRADES_PAGE_SIZE + 1;
  const end = Math.min(currentGradesPage * GRADES_PAGE_SIZE, totalStudents);

  let html = `
    <div style="color: var(--text-muted); font-size: 13px; font-weight: 500;">
      Showing <strong>${start}-${end}</strong> of <strong>${totalStudents}</strong>
    </div>
    <div class="pagination">
  `;

  // Prev button
  html += `
    <button class="pg-btn pg-prev ${currentGradesPage === 1 ? 'pg-disabled' : ''}" onclick="changeGradesPage(${currentGradesPage - 1})" ${currentGradesPage === 1 ? 'disabled' : ''}>
      <i class="fas fa-chevron-left"></i>
    </button>
  `;

  // Page numbers with ellipsis
  const pages = _buildGradesPageNumbers(currentGradesPage, totalPages);
  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `
        <button class="pg-btn pg-num ${p === currentGradesPage ? 'pg-active' : ''}" onclick="changeGradesPage(${p})">
          ${p}
        </button>
      `;
    }
  });

  // Next button
  html += `
    <button class="pg-btn pg-next ${currentGradesPage === totalPages ? 'pg-disabled' : ''}" onclick="changeGradesPage(${currentGradesPage + 1})" ${currentGradesPage === totalPages ? 'disabled' : ''}>
      <i class="fas fa-chevron-right"></i>
    </button>
  `;

  html += `</div>`;
  container.innerHTML = html;
}

function _buildGradesPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

window.changeGradesPage = function(page) {
  currentGradesPage = page;
  renderGradesTable();
  // Scroll to top of table
  document.querySelector('.table-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });
};

// ── Modal Logic ──────────────────────────────────────────
async function openTestModal() {
  const root = document.getElementById('modal-root');

  // Fetch dynamic courses
  let courseOpts = '<option value="">Select a course...</option>';
  try {
    const courses = await window.api.getCourses();
    if (courses && courses.length > 0) {
      courseOpts += courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    }
  } catch (e) {
    console.error('Failed fetching courses for modal', e);
  }

  root.innerHTML = `
    <div class="modal-overlay active" id="tm-overlay">
      <div class="modal">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Create New Test</h3>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:2px;">Fill in the details and add questions below</p>
          </div>
          <button class="modal-close" id="tm-close">✕</button>
        </div>
        
        <div class="modal-body" style="padding-bottom: 0;">
          <span class="section-label" style="margin-top:0;">TEST DETAILS</span>
          
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Test Title <span style="color:#ef4444">*</span></label>
              <input class="form-input" id="tm-title" type="text" placeholder="e.g. Mid-Term Calculus" />
            </div>
            <div class="form-group">
              <label class="form-label">Course <span style="color:#ef4444">*</span></label>
              <div class="form-select-wrapper">
                <select class="form-select" id="tm-course">
                  ${courseOpts}
                </select>
              </div>
            </div>
            
            <div class="form-group">
              <label class="form-label">Duration (minutes) <span style="color:#ef4444">*</span></label>
              <input class="form-input" id="tm-duration" type="number" placeholder="e.g. 90" />
            </div>

            <div class="form-group">
              <label class="form-label">Card Color</label>
              <div class="color-picker" id="tm-colors">
                <div class="color-option bg-blue selected" data-color="blue"></div>
                <div class="color-option bg-green" data-color="green"></div>
                <div class="color-option bg-orange" data-color="orange"></div>
                <div class="color-option bg-purple" data-color="purple"></div>
                <div class="color-option bg-teal" data-color="teal"></div>
                <div class="color-option bg-pink" data-color="pink"></div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Status</label>
              <div class="form-select-wrapper">
                <select class="form-select" id="tm-status">
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                </select>
              </div>
            </div>
          </div>

          <div class="questions-header">
            <span class="section-label">QUESTIONS</span>
            <div class="question-buttons">
              <button class="q-btn action-add-q" data-type="mcq">+ MCQ</button>
              <button class="q-btn action-add-q" data-type="short">+ Short Answer</button>
              <button class="q-btn action-add-q" data-type="long">+ Long Answer</button>
            </div>
          </div>
          
          <div id="tm-questions-container">
            <div class="questions-empty-state" id="tm-empty-state">
              <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <p>No questions yet. Add questions using the buttons above.</p>
            </div>
            <div class="questions-list" id="tm-q-list" style="display:none;"></div>
          </div>

          <div class="total-marks-row">
            <span>Total Marks: <strong id="tm-total">0</strong></span>
          </div>
        </div>

        <div class="modal-footer" style="border-top: none;">
          <button class="btn btn-ghost" id="tm-cancel">Cancel</button>
          <button class="btn btn-primary" id="tm-save" style="background:var(--accent); border-color:var(--accent);">Save Test</button>
        </div>
      </div>
    </div>
  `;

  // Bind color picker
  document.querySelectorAll('.color-option').forEach(el => {
    el.addEventListener('click', (e) => {
      document.querySelectorAll('.color-option').forEach(c => c.classList.remove('selected'));
      e.target.classList.add('selected');
    });
  });

  // Modal actions
  const closeFn = () => { root.innerHTML = ''; };
  document.getElementById('tm-close').addEventListener('click', closeFn);
  document.getElementById('tm-cancel').addEventListener('click', closeFn);
  // ESC-only close - backdrop click disabled
  // document.getElementById('tm-overlay').addEventListener('click', (e) => {
  //   if (e.target === e.currentTarget) closeFn();
  // });

  // Dynamic question adder
  let totalMarks = 0;
  let qCount = 0;
  const listEl = document.getElementById('tm-q-list');
  const emptyEl = document.getElementById('tm-empty-state');
  const totalEl = document.getElementById('tm-total');

  const addQuestion = (type, defaultMarks) => {
    qCount++;
    totalMarks += defaultMarks;
    totalEl.textContent = totalMarks;

    emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    let typeLabel = '';
    if (type === 'mcq') typeLabel = 'Multiple Choice';
    if (type === 'short') typeLabel = 'Short Answer';
    if (type === 'long') typeLabel = 'Long Answer';

    const div = document.createElement('div');
    div.className = 'question-item pending-q-item';
    div.dataset.type = type;

    let optionsHtml = '';
    if (type === 'mcq') {
      optionsHtml = `
        <div class="options-container">
          <label>Options <span>(select correct answer)</span></label>
          <div class="option-row">
            <span class="option-letter">A</span>
            <input class="form-input pd-opt-input" style="background:#fff; flex:1;" type="text" value="Option A" />
            <label class="option-radio">
              <input type="radio" class="pd-opt-radio" name="q${qCount}" checked />
              Correct
            </label>
          </div>
          <div class="option-row">
            <span class="option-letter">B</span>
            <input class="form-input pd-opt-input" style="background:#fff; flex:1;" type="text" value="Option B" />
            <label class="option-radio">
              <input type="radio" class="pd-opt-radio" name="q${qCount}" />
              Correct
            </label>
          </div>
          <div class="option-row">
            <span class="option-letter">C</span>
            <input class="form-input pd-opt-input" style="background:#fff; flex:1;" type="text" value="Option C" />
            <label class="option-radio">
              <input type="radio" class="pd-opt-radio" name="q${qCount}" />
              Correct
            </label>
          </div>
          <div class="option-row">
            <span class="option-letter">D</span>
            <input class="form-input pd-opt-input" style="background:#fff; flex:1;" type="text" value="Option D" />
            <label class="option-radio">
              <input type="radio" class="pd-opt-radio" name="q${qCount}" />
              Correct
            </label>
          </div>
        </div>
      `;
    }

    div.innerHTML = `
      <div class="question-header-row">
        <h4>Q${qCount} — ${typeLabel}</h4>
        <button class="remove-btn" title="Remove question">✕</button>
      </div>
      <div class="question-field" style="margin-bottom:8px;">
        <label>Question</label>
        <textarea class="form-input pd-q-text" style="background:#fff;" placeholder=""></textarea>
      </div>
      <div class="question-field" style="margin-bottom:8px;">
        <label>Image URL (Optional)</label>
        <input class="form-input pd-q-image" style="background:#fff;" type="text" placeholder="https://example.com/image.png" />
      </div>
      <div class="question-marks-row">
        <label>Marks:</label>
        <input class="form-input pd-q-marks" style="background:#fff;" type="number" value="${defaultMarks}" />
      </div>
      ${optionsHtml}
    `;

    div.querySelector('.remove-btn').addEventListener('click', () => {
      div.remove();
      const currentVal = parseInt(div.querySelector('.pd-q-marks').value) || 0;
      totalMarks = Math.max(0, totalMarks - currentVal);
      totalEl.textContent = totalMarks;
      if (listEl.children.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = 'flex';
      }
    });

    listEl.appendChild(div);
    listEl.scrollTop = listEl.scrollHeight;
  };

  // Event Delegation for action add Q
  document.querySelectorAll('.action-add-q').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      if (type === 'mcq') addQuestion('mcq', 10);
      if (type === 'short') addQuestion('short', 10);
      if (type === 'long') addQuestion('long', 20);
    });
  });

  // Save handler
  document.getElementById('tm-save').addEventListener('click', async () => {
    const title = document.getElementById('tm-title').value.trim();
    const course = document.getElementById('tm-course').value.trim();
    const duration = document.getElementById('tm-duration').value;
    const status = document.getElementById('tm-status').value;
    const color = document.querySelector('.color-option.selected')?.dataset.color || 'blue';

    if (!title || !course || !duration) {
      if (typeof window.showToast === 'function') window.showToast('Please fill all required fields.', 'error');
      return;
    }

    // Scrape dynamically added questions
    let finalQuestions = [];
    document.querySelectorAll('.pending-q-item').forEach(el => {
      const typeStr = el.dataset.type;
      const textStr = el.querySelector('.pd-q-text').value;
      const marksStr = el.querySelector('.pd-q-marks').value;
      const imageUrlStr = el.querySelector('.pd-q-image')?.value?.trim() || '';
      const marks = parseInt(marksStr) || 0;

      let options = [];
      if (typeStr === 'mcq') {
        el.querySelectorAll('.option-row').forEach(optRow => {
          options.push({
            text: optRow.querySelector('.pd-opt-input').value,
            isCorrect: optRow.querySelector('.pd-opt-radio').checked
          });
        });
      }

      finalQuestions.push({
        type: typeStr,
        text: textStr,
        imageUrl: imageUrlStr,
        marks: marks,
        options: options
      });
    });

    const newTest = {
      title,
      courseId: parseInt(course, 10),
      color,
      status,
      duration: parseInt(duration, 10),
      questions: finalQuestions
    };

    try {
      await window.api.createTest(newTest);
      testsData = await window.api.getAllTests();
      renderDashboard();
      closeFn();
      if (typeof window.showToast === 'function') window.showToast('Test created successfully.', 'success');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('Error saving test', 'error');
      console.error(err);
    }
  });
}

// ── Advanced Test Editor Logic ───────────────────────────
let editorWorkingTest = null;

window.openTestEditor = function (id) {
  const test = testsData.find(t => t.id === id);
  if (!test) return;

  editorWorkingTest = JSON.parse(JSON.stringify(test)); // Deep clone
  if (!editorWorkingTest.questions) editorWorkingTest.questions = [];

  // Update Top Nav
  document.getElementById('editor-top-title').value = editorWorkingTest.title;
  const statusSelect = document.getElementById('editor-status-select');
  if (statusSelect) statusSelect.value = editorWorkingTest.status || 'DRAFT';

  // Update Paper
  document.getElementById('paper-title').textContent = editorWorkingTest.title;
  document.getElementById('paper-course').textContent = editorWorkingTest.courseId ? `Course #` + editorWorkingTest.courseId : '';

  const displayDate = editorWorkingTest.createdAt ? new Date(editorWorkingTest.createdAt).toLocaleDateString() : 'N/A';
  document.getElementById('paper-date').textContent = displayDate;
  document.getElementById('paper-duration').textContent = editorWorkingTest.duration + " minutes";

  renderEditorQuestions();
  document.getElementById('test-editor-overlay').classList.remove('hidden');
};

function renderEditorQuestions() {
  const listEl = document.getElementById('editor-q-list');
  listEl.innerHTML = editorWorkingTest.questions.map((q, idx) => {
    let typeLabel = '';
    if (q.type === 'mcq') typeLabel = 'MCQ';
    else if (q.type === 'short') typeLabel = 'Short Answer';
    else if (q.type === 'long') typeLabel = 'Long Answer';

    let optionsHtml = '';
    if (q.type === 'mcq') {
      optionsHtml = `<div class="editor-opt-list">` +
        (q.options || []).map((opt, oIdx) => `
           <div class="editor-opt-row ${opt.isCorrect ? 'correct-opt' : ''}">
             <span class="opt-letter">${String.fromCharCode(65 + oIdx)}.</span>
             <input type="text" class="opt-input" value="${esc(opt.text)}" placeholder="Option text" />
             <button class="btn-mark-correct action-mark-correct">Mark correct</button>
           </div>
         `).join('')
        + `</div>`;
    }

    return `
      <div class="editor-q-item" data-type="${q.type}">
        <div class="editor-q-header">
          <div class="q-label">
            QUESTION <span class="q-index-num">${idx + 1}</span>
            <span class="q-badge">${typeLabel}</span>
          </div>
          <div class="q-marks-wrap">
            Marks: <input type="number" class="q-marks-input" value="${q.marks}" />
            <button class="btn-remove-q action-remove-q">✕</button>
          </div>
        </div>
        <div class="editor-q-image-wrap" style="margin-bottom:8px;">
          <input type="text" class="editor-q-image-input form-input" style="font-size: 13px;" value="${esc(q.imageUrl || '')}" placeholder="Image URL (Optional)..." />
        </div>
        <textarea class="editor-q-text" placeholder="Enter question text...">${esc(q.text)}</textarea>
        ${optionsHtml}
        ${q.type === 'short' ? `<div class="short-ans-box">Student short answer space</div>` : ''}
        ${q.type === 'long' ? `<div class="short-ans-box long-ans-box">Student long answer space</div>` : ''}
      </div>
    `;
  }).join('');
  updateEditorTotals();
}

window.addEditorQuestion = function (type) {
  if (!editorWorkingTest) return;
  const newQ = {
    type: type,
    text: '',
    marks: type === 'long' ? 20 : 10
  };

  if (type === 'mcq') {
    newQ.options = [
      { text: 'Option A', isCorrect: true },
      { text: 'Option B', isCorrect: false },
      { text: 'Option C', isCorrect: false },
      { text: 'Option D', isCorrect: false }
    ];
  }

  editorWorkingTest.questions.push(newQ);
  renderEditorQuestions();

  // Scroll to bottom
  const canvas = document.querySelector('.editor-canvas');
  if (canvas) {
    setTimeout(() => canvas.scrollTo({ top: canvas.scrollHeight, behavior: 'smooth' }), 50);
  }
};

window.removeEditorQuestion = function (btn) {
  btn.closest('.editor-q-item').remove();

  // Re-number
  document.querySelectorAll('.editor-q-item').forEach((el, idx) => {
    const textSpan = el.querySelector('.q-index-num');
    if (textSpan) textSpan.textContent = idx + 1;
  });
  updateEditorTotals();
};

window.toggleOptionCorrect = function (btn) {
  const row = btn.closest('.editor-opt-row');
  row.classList.toggle('correct-opt');
};

window.updateEditorTotals = function () {
  const qItems = document.querySelectorAll('.editor-q-item');
  let total = 0;
  qItems.forEach(el => {
    total += parseInt(el.querySelector('.q-marks-input').value) || 0;
  });
  const count = qItems.length;
  document.getElementById('editor-top-meta').textContent = `${count} questions • ${total} marks`;
  document.getElementById('paper-qcount').textContent = `${count} questions`;
  document.getElementById('paper-marks').textContent = total;
};

window.saveTestEditor = async function () {
  if (!editorWorkingTest) return;

  const titleInput = document.getElementById('editor-top-title');
  if (titleInput) {
    editorWorkingTest.title = titleInput.value.trim() || 'Untitled Test';
  }

  const statusSelect = document.getElementById('editor-status-select');
  if (statusSelect) {
    editorWorkingTest.status = statusSelect.value;
  }

  // Scrape dynamic questions from editor DOM
  let newQuestions = [];
  document.querySelectorAll('.editor-q-item').forEach(el => {
    const typeStr = el.dataset.type;
    const textStr = el.querySelector('.editor-q-text').value;
    const marksStr = el.querySelector('.q-marks-input').value;
    const imageStr = el.querySelector('.editor-q-image-input')?.value?.trim() || '';

    let options = [];
    if (typeStr === 'mcq') {
       el.querySelectorAll('.editor-opt-row').forEach(optRow => {
         options.push({
           text: optRow.querySelector('.opt-input').value,
           isCorrect: optRow.classList.contains('correct-opt')
         });
       });
    }

    newQuestions.push({
      type: typeStr,
      text: textStr,
      marks: parseInt(marksStr) || 0,
      imageUrl: imageStr,
      options: options
    });
  });
  
  editorWorkingTest.questions = newQuestions;

  try {
    const payload = {
      title: editorWorkingTest.title,
      questions: editorWorkingTest.questions,
      status: editorWorkingTest.status
    };

    await window.api.updateTest(editorWorkingTest.id, payload);

    // Refresh local lists
    testsData = await window.api.getAllTests();
    renderDashboard();

    if (typeof window.showToast === 'function') {
      window.showToast('Test updated successfully', 'success');
    }

    document.getElementById('test-editor-overlay').classList.add('hidden');
    editorWorkingTest = null;
  } catch (err) {
    if (typeof window.showToast === 'function') {
      window.showToast('Error updating test: ' + err.message, 'error');
    } else {
      alert('Error updating test: ' + err.message);
    }
  }
};

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.downloadTestPDF = function (id) {
  openTestEditor(id);
  setTimeout(async () => {
    const test = testsData.find(t => t.id === id);
    if (!test) return;
    try {
      const res = await window.api.exportPDF({ filename: test.title });
      if (res.ok) {
        if (typeof window.showToast === 'function') window.showToast('PDF saved successfully!', 'success');
        else alert('PDF saved successfully!');
      } else {
        if (res.error !== 'Download canceled') {
          if (typeof window.showToast === 'function') window.showToast('Error: ' + res.error, 'error');
          else alert('Error: ' + res.error);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      document.getElementById('test-editor-overlay').classList.add('hidden');
    }
  }, 350);
};

async function handlePublishTest(testId, btnEl) {
  const originalText = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.textContent = 'Publishing...';

  const result = await window.api.publishTest(testId);

  btnEl.disabled = false;
  btnEl.innerHTML = originalText;

  if (!result.ok) {
    if (typeof window.showToast === 'function') window.showToast(result.error, 'error');
    else alert(result.error);
    return;
  }

  // Refresh testsData so the newly saved googleFormId is available
  try { testsData = await window.api.getAllTests(); } catch (e) { console.error(e); }

  // Show success modal
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay active" id="publish-overlay">
      <div class="modal" style="width:480px;">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">🎉 Form Published!</h3>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:2px;">
              Share this link with your students
            </p>
          </div>
          <button class="modal-close" id="publish-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">
            Your test is now live on Google Forms:
          </p>
          <div class="publish-url-box">
            <input type="text" class="publish-url-input" id="publish-url-val" 
              value="${result.url}" readonly />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="publish-close-2">Close</button>
          <button class="btn btn-primary" id="publish-copy" 
            style="background:var(--success);border-color:var(--success);">
            Copy Link
          </button>
        </div>
      </div>
    </div>
  `;

  const closeFn = () => { root.innerHTML = ''; };
  document.getElementById('publish-close').addEventListener('click', closeFn);
  document.getElementById('publish-close-2').addEventListener('click', closeFn);
  // ESC-only close - backdrop click disabled
  // document.getElementById('publish-overlay').addEventListener('click', (e) => {
  //   if (e.target === e.currentTarget) closeFn();
  // });

  document.getElementById('publish-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(result.url).then(() => {
      const copyBtn = document.getElementById('publish-copy');
      if (copyBtn) {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { if (copyBtn) copyBtn.textContent = 'Copy Link'; }, 2000);
      }
    });
  });
}

// ── Import Forms Logic ────────────────────────────────────
let currentFormPreviewData = null;

function openFormImportModal() {
  document.getElementById('form-import-step1-status').textContent = '';

  // Populate test link dropdown — show all published tests
  const testSelect = document.getElementById('select-test-link');
  testSelect.innerHTML = '<option value="">Select a published test to import results from...</option>';
  testsData.filter(t => t.status === 'PUBLISHED').forEach(t => {
    const label = t.googleFormId ? esc(t.title) : esc(t.title) + ' (needs re-publish)';
    testSelect.innerHTML += `<option value="${t.id}" data-form-id="${esc(t.googleFormId || '')}">${label}</option>`;
  });

  document.getElementById('form-import-step-1').classList.remove('hidden');
  document.getElementById('form-import-step-2').classList.add('hidden');
  document.getElementById('import-form-modal').classList.remove('hidden');
  document.getElementById('import-form-modal').classList.add('active');

  // ESC-only close - backdrop click disabled
  // modal.addEventListener('click', (e) => {
  //   if (e.target === modal) {
  //     modal.classList.remove('active');
  //   }
  // });
}

async function loadFormPreview() {
  const testSelect = document.getElementById('select-test-link');
  const selectedOption = testSelect.options[testSelect.selectedIndex];
  const testId = testSelect.value;
  const statusEl = document.getElementById('form-import-step1-status');

  if (!testId) {
    statusEl.innerHTML = '<span style="color:var(--danger)">Please select a published test.</span>';
    return;
  }

  const formId = selectedOption.dataset.formId;
  if (!formId) {
    statusEl.innerHTML = '<span style="color:var(--danger)">This test has no linked Google Form ID. Please re-publish it.</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color:var(--accent)">Loading form responses...</span>';
  try {
    const data = await window.api.importPreviewForm(formId);
    currentFormPreviewData = { ...data, targetTestId: parseInt(testId, 10) };

    // Switch to step 2
    document.getElementById('form-import-step-1').classList.add('hidden');
    document.getElementById('form-import-step-2').classList.remove('hidden');

    // Populate question selects
    const qSelect = document.getElementById('select-id-question');
    qSelect.innerHTML = (currentFormPreviewData.formStructure.items || [])
      .filter(item => item.questionItem) // only questions
      .map(item => `<option value="${item.questionItem.question.questionId}">${esc(item.title)}</option>`)
      .join('');

    const totalRes = currentFormPreviewData.responses.length;
    document.getElementById('form-preview-summary').textContent = `Found ${totalRes} responses. Please map them below.`;

    // Auto map using the first option
    mapFormStudents();
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
  }
}

function mapFormStudents() {
  if (!currentFormPreviewData) return;
  const qId = document.getElementById('select-id-question').value;
  if (!qId) return;

  const students = currentFormPreviewData.systemStudents || [];
  const tbody = document.getElementById('form-preview-tbody');

  currentFormPreviewData.mappedResults = [];

  tbody.innerHTML = currentFormPreviewData.responses.map((resp) => {
    // Get Answer
    let studentIdentifier = 'Unknown';
    if (resp.answers && resp.answers[qId] && resp.answers[qId].textAnswers) {
      studentIdentifier = resp.answers[qId].textAnswers.answers[0].value;
    }

    const idStr = studentIdentifier.toLowerCase().trim();

    // PASS 1: Try to find an exact matching student first
    let matchedStudent = students.find(s => {
      const fullName = ((s.firstName || '') + ' ' + (s.lastName || '')).toLowerCase().trim();
      const fName = (s.firstName || '').toLowerCase().trim();
      const sId = String(s.studentId || '').toLowerCase().trim();
      const roll = String(s.rollNumber || '').toLowerCase().trim();
      const phone = String(s.phone || '').toLowerCase().trim();

      return roll === idStr || sId === idStr || phone === idStr || fullName === idStr || fName === idStr;
    });

    // PASS 2: Partial name match as a fallback (only if the input isn't a short number)
    if (!matchedStudent && idStr.length > 2 && isNaN(Number(idStr))) {
      matchedStudent = students.find(s => {
        const fullName = ((s.firstName || '') + ' ' + (s.lastName || '')).toLowerCase().trim();
        return fullName.includes(idStr);
      });
    }

    let totalScore = resp.totalScore || 0;

    let sysText = matchedStudent
      ? `<span style="color:var(--success)">${esc(matchedStudent.firstName + ' ' + matchedStudent.lastName)} (Roll: ${esc(matchedStudent.rollNumber || matchedStudent.studentId)})</span>`
      : `<span style="color:var(--danger)">Unmatched</span>`;

    if (matchedStudent) {
      currentFormPreviewData.mappedResults.push({
        testId: currentFormPreviewData.targetTestId,
        studentId: matchedStudent.id,
        score: totalScore,
        answers: resp.answers || {}
      });
    }

    return `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid var(--border);">${esc(studentIdentifier)}</td>
        <td style="padding:10px 16px; border-bottom:1px solid var(--border);">${sysText}</td>
        <td style="padding:10px 16px; border-bottom:1px solid var(--border); text-align:right;">${totalScore}</td>
      </tr>
    `;
  }).join('');

  const confirmBtn = document.getElementById('btn-confirm-form-import');
  if (currentFormPreviewData.mappedResults.length > 0) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = `Import ${currentFormPreviewData.mappedResults.length} Scores`;
  } else {
    confirmBtn.disabled = true;
    confirmBtn.textContent = `No matched students`;
  }
}

async function executeFormImport() {
  if (!currentFormPreviewData || !currentFormPreviewData.mappedResults || currentFormPreviewData.mappedResults.length === 0) return;

  const btn = document.getElementById('btn-confirm-form-import');
  const orgTxt = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const res = await window.api.importExecuteForm(currentFormPreviewData.mappedResults);
    if (typeof window.showToast === 'function') {
      window.showToast(`Imported ${res.inserted} grades successfully.`, 'success');
    }

    document.getElementById('import-form-modal').classList.remove('active');

    // Refresh grades overview
    try {
      gradesData = await window.api.getGradesOverview();
      renderDashboard(); // re-render charts and tables
    } catch (err) {
      console.error(err);
    }
  } catch (e) {
    if (typeof window.showToast === 'function') window.showToast(`Error: ${e.message}`, 'error');
    btn.disabled = false;
    btn.textContent = orgTxt;
  }
}

// ── Helpers ───────────────────────────────────────────────

function getTestInitials(firstName, lastName) {
  const f = firstName ? firstName.charAt(0).toUpperCase() : '';
  const l = lastName ? lastName.charAt(0).toUpperCase() : '';
  return f + l;
}

function getTestAvatarSVG(firstName, lastName, index) {
  const initials = getTestInitials(firstName, lastName) || '?';
  const gradients = [
    { start: '#6366f1', end: '#4f46e5' },
    { start: '#0ea5e9', end: '#2563eb' },
    { start: '#10b981', end: '#059669' },
    { start: '#f43f5e', end: '#e11d48' },
    { start: '#8b5cf6', end: '#7c3aed' }
  ];
  const g = gradients[index % gradients.length];

  return `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); flex-shrink: 0;">
      <defs>
        <linearGradient id="grad-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${g.start}" />
          <stop offset="100%" stop-color="${g.end}" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" fill="url(#grad-${index})" />
      <text x="50%" y="54%" dy=".1em" fill="#ffffff" font-size="15" font-weight="700" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5px">
        ${initials}
      </text>
    </svg>
  `;
}
