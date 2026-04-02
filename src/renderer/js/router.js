// renderer/js/router.js
// Single-shell router: loads page fragments via preload bridge and runs init hooks.

'use strict';

const ROUTES = {
  dashboard: { fragment: 'dashboard', init: 'initDashboard', css: null },
  students: { fragment: 'students', init: 'initStudents', css: '../css/student.css' },
  slots: { fragment: 'slots', init: 'initSlots', css: '../css/slots.css' },
  courses: { fragment: 'courses', init: 'initCourses', css: '../css/courses.css' },
  tests: { fragment: 'tests', init: 'initTests', css: '../css/tests.css' },
  forms: { fragment: 'forms', init: 'initForms', css: null },
  fees: { fragment: 'fees', init: 'initFees', css: '../css/fees.css' },
};

let current = null;
let currentDestroy = null;

function setPageCss(href) {
  const link = document.getElementById('page-css');
  if (!link) return;
  link.setAttribute('href', href || '');
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

async function loadFragment(fragmentName) {
  if (!window.api?.loadFragment) {
    throw new Error('Fragment loader unavailable (window.api.loadFragment missing).');
  }
  return await window.api.loadFragment(fragmentName);
}

async function navigate(page) {
  if (!ROUTES[page]) page = 'dashboard';
  if (current === page) return;

  // Let the previous page cleanup any global listeners.
  try { if (typeof currentDestroy === 'function') currentDestroy(); } catch (_) { }
  currentDestroy = null;

  current = page;

  setActiveNav(page);

  const outlet = document.getElementById('main-content');
  // Used by page CSS to scope tokens without affecting sidebar theme.
  outlet.dataset.page = page;
  outlet.innerHTML = `
    <div class="page-body">
      <div class="card" style="margin-top:24px; text-align:center; padding:60px 20px;">
        <p style="font-size:36px; margin-bottom:12px;">⏳</p>
        <h3 style="font-family:var(--font-display); margin-bottom:8px;">Loading…</h3>
        <p style="color:var(--text-secondary); font-size:13px;">Please wait</p>
      </div>
    </div>
  `;

  try {
    const { fragment, init, css, destroy } = ROUTES[page];
    setPageCss(css);
    const html = await loadFragment(fragment);
    outlet.innerHTML = html;

    if (init && typeof window[init] === 'function') {
      await window[init]();
    }

    if (destroy && typeof window[destroy] === 'function') {
      currentDestroy = window[destroy];
    }
  } catch (err) {
    outlet.innerHTML = `
      <div class="page-header">
        <div>
          <h2 class="page-title">Something went wrong</h2>
          <p class="page-subtitle">Could not load this section.</p>
        </div>
      </div>
      <div class="page-body">
        <div class="card" style="margin-top:24px;">
          <div style="color:var(--danger); font-weight:700; margin-bottom:6px;">Error</div>
          <div style="color:var(--text-secondary); font-size:13px; white-space:pre-wrap;">${String(err?.message || err)}</div>
        </div>
      </div>
    `;
  }
}

// ── Toast Utility ─────────────────────────────────────
// Usage: showToast('Saved!', 'success')
window.showToast = function (message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };

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

// Theme toggle (same as before, but safe)
(function initTheme() {
  try {
    const root = document.documentElement;
    const btn = document.getElementById('theme-toggle-btn');
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');

    function applyTheme(theme) {
      root.setAttribute('data-theme', theme);
      if (!icon || !label) return;
      if (theme === 'light') {
        icon.textContent = '☀️';
        label.textContent = 'Light mode';
      } else {
        icon.textContent = '🌙';
        label.textContent = 'Dark mode';
      }
    }

    let saved = 'light';
    try { saved = localStorage.getItem('theme') || 'light'; } catch (_) { }
    applyTheme(saved);

    btn?.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (_) { }
    });
  } catch (e) {
    console.warn('Theme init failed:', e);
  }
})();

// Wire sidebar clicks
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  // Use pointerdown so navigation happens before click-up,
  // preventing rare "ghost click" landing on newly-rendered buttons.
  item.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    navigate(item.dataset.page);
  });
});

// Boot
navigate('students');

