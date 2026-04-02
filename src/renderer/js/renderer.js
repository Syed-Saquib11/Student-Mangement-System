// src/renderer/js/renderer.js
// Handles: page routing, sidebar nav, toast notifications.
// NO business logic here.

// Legacy router kept for reference.
// The app now uses `router.js` + fragment pages under `pages/`.
'use strict';

// ── Page Registry ────────────────────────────────────
// When you add new pages, register them here.
const PAGE_LOADERS = {
  students:  loadStudentsPage,
  dashboard: loadDashboardPage,
  courses:   loadComingSoonPage.bind(null, 'Courses'),
  slots:     loadComingSoonPage.bind(null, 'Slot Management'),
  tests:     loadComingSoonPage.bind(null, 'Tests & Grades'),
  forms:     loadComingSoonPage.bind(null, 'Forms & Documents'),
  fees:      loadComingSoonPage.bind(null, 'Fees'),
};

let currentPage = null;

// ── Routing ──────────────────────────────────────────
function navigateTo(page) {
  if (currentPage === page) return;
  currentPage = page;

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Load the page
  const loader = PAGE_LOADERS[page];
  if (loader) loader();
}

// ── Page Loaders ─────────────────────────────────────
function loadStudentsPage() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Students</h2>
        <p class="page-subtitle" id="students-subtitle">Loading…</p>
      </div>
      <button class="btn btn-primary" id="btn-add-student">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Student
      </button>
    </div>
    <div class="page-body">
      <div class="stats-row" id="student-stats"></div>

      <div class="toolbar">
        <div class="search-wrapper">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="search-input" id="search-input" placeholder="Search by name, roll, ID…" />
        </div>
        <div class="ml-auto flex gap-2">
          <select class="form-select" id="filter-fee" style="width:160px">
            <option value="">All Fee Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Unpaid</option>
          </select>
        </div>
      </div>

      <div class="table-card" id="student-table-card">
        <div class="table-wrapper">
          <table id="students-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Class</th>
                <th>Roll No.</th>
                <th>Phone</th>
                <th>Fee Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="students-tbody">
              <tr><td colspan="7">
                <div class="empty-state">
                  <div class="empty-state-icon">⏳</div>
                  <h3>Loading students…</h3>
                </div>
              </td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer">
          <span class="table-count" id="table-count">—</span>
        </div>
      </div>
    </div>
  `;

  // Hand off to student.js
  if (typeof initStudentPage === 'function') initStudentPage();
}

function loadDashboardPage() {
  document.getElementById('main-content').innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Dashboard</h2>
        <p class="page-subtitle">Overview of your institute</p>
      </div>
    </div>
    <div class="page-body">
      <div class="card" style="margin-top:24px; text-align:center; padding:60px 20px;">
        <p style="font-size:36px; margin-bottom:12px;">📊</p>
        <h3 style="font-family:var(--font-display); margin-bottom:8px;">Dashboard coming in Phase 2</h3>
        <p style="color:var(--text-secondary); font-size:13px;">Finish the Students module first, then we'll hook up real data here.</p>
      </div>
    </div>
  `;
}

function loadComingSoonPage(name) {
  document.getElementById('main-content').innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">${name}</h2>
      </div>
    </div>
    <div class="page-body">
      <div class="card" style="margin-top:24px; text-align:center; padding:60px 20px;">
        <p style="font-size:36px; margin-bottom:12px;">🚧</p>
        <h3 style="font-family:var(--font-display); margin-bottom:8px;">${name} — Coming Soon</h3>
        <p style="color:var(--text-secondary); font-size:13px;">This module will be built after the Students module is complete.</p>
      </div>
    </div>
  `;
}

// ── Toast Utility ─────────────────────────────────────
// Usage: showToast('Student added!', 'success')
window.showToast = function (message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const icons = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-weight:600">${icons[type] || 'ℹ'}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ── Theme Toggle ──────────────────────────────────────
// Must not throw: a failure here would skip sidebar listeners and initial navigateTo below.
(function initTheme() {
  try {
    const root  = document.documentElement;
    const btn   = document.getElementById('theme-toggle-btn');
    const icon  = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');

    function applyTheme(theme) {
      root.setAttribute('data-theme', theme);
      if (!icon || !label) return;
      if (theme === 'light') {
        icon.textContent  = '☀️';
        label.textContent = 'Light mode';
      } else {
        icon.textContent  = '🌙';
        label.textContent = 'Dark mode';
      }
    }

    let saved = 'light';
    try {
      saved = localStorage.getItem('theme') || 'light';
    } catch (_) {
      /* private mode / restricted storage */
    }
    applyTheme(saved);

    btn?.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try {
        localStorage.setItem('theme', next);
      } catch (_) {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn('Theme init failed:', e);
  }
})();

// ── Sidebar Nav Listeners ─────────────────────────────
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', (e) => {
    const href = item.getAttribute('href');
    // If a nav item points to a dedicated page (e.g. course.html), allow page navigation.
    if (href && href !== '#') return;
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

// ── Boot: load default page ───────────────────────────
navigateTo('students');
