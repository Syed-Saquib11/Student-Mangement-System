// src/renderer/js/dashboard.js
// Dashboard module — loads live student data and renders stats.
'use strict';

window.initDashboard = async function initDashboard() {
  try {
    const students = await window.api.getAllStudents();
    renderDashStats(students);
    renderFeeChart(students);
    renderRecentStudents(students);
    bindDashQuickActions();

    const subtitle = document.getElementById('dash-subtitle');
    if (subtitle) subtitle.textContent = `${students.length} student${students.length !== 1 ? 's' : ''} enrolled`;
  } catch (err) {
    showToast('Dashboard failed to load: ' + err, 'error');
  }
};

function renderDashStats(students) {
  const el = document.getElementById('dash-stats');
  if (!el) return;

  const total   = students.length;
  const paid    = students.filter(s => s.feeStatus === 'paid').length;
  const pending = students.filter(s => s.feeStatus === 'pending').length;
  const rate    = total > 0 ? Math.round((paid / total) * 100) : 0;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Students</div>
      <div class="stat-value accent">${total}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Fee Paid</div>
      <div class="stat-value success">${paid}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Fee Unpaid</div>
      <div class="stat-value warning">${pending}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Collection Rate</div>
      <div class="stat-value">${rate}%</div>
    </div>
  `;
}

function renderFeeChart(students) {
  const el = document.getElementById('dash-fee-chart');
  if (!el) return;

  const total   = students.length;
  const paid    = students.filter(s => s.feeStatus === 'paid').length;
  const pending = total - paid;

  function bar(label, count, color) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
          <span style="color:var(--text-secondary)">${label}</span>
          <span style="font-weight:600;">${count} <span style="color:var(--text-secondary); font-weight:400;">(${pct}%)</span></span>
        </div>
        <div style="height:8px; border-radius:4px; background:var(--surface-raised); overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:${color}; border-radius:4px; transition:width 0.5s ease;"></div>
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    ${bar('Paid', paid, 'var(--success)')}
    ${bar('Unpaid', pending, 'var(--warning)')}
  `;
}

function renderRecentStudents(students) {
  const tbody = document.getElementById('dash-recent-tbody');
  if (!tbody) return;

  const recent = students.slice(0, 8); // already sorted by createdAt DESC from backend

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state" style="padding:16px 0;"><div class="empty-state-icon">👤</div><h3>No students yet</h3></div></td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(s => `
    <tr>
      <td><span class="student-id-badge">${esc(s.studentId)}</span></td>
      <td class="student-name">${esc(s.firstName)} ${esc(s.lastName)}</td>
      <td>${esc(s.class) || '—'}</td>
      <td>${esc(s.phone) || '—'}</td>
      <td>${feeBadge(s.feeStatus)}</td>
    </tr>
  `).join('');
}

function bindDashQuickActions() {
  document.getElementById('dash-add-student-btn')?.addEventListener('click', () => {
    // Navigate to students page and open the add modal
    const studentsNav = document.querySelector('.nav-item[data-page="students"]');
    if (studentsNav) studentsNav.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // Give router time to render, then open modal
    setTimeout(() => {
      if (typeof window.openStudentModal === 'function') window.openStudentModal(null);
    }, 400);
  });

  document.getElementById('dash-go-courses-btn')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="courses"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  document.getElementById('dash-go-fees-btn')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="fees"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  document.getElementById('dash-go-slots-btn')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="slots"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
}

// ── Helpers (duplicated here so dashboard works standalone) ──
function feeBadge(status) {
  if (status === 'paid')    return '<span class="badge badge-success">Paid</span>';
  if (status === 'pending') return '<span class="badge badge-warning">Unpaid</span>';
  return `<span class="badge">${esc(status)}</span>`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
