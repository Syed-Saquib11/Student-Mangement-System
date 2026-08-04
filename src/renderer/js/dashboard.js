// src/renderer/js/dashboard.js
// Dashboard module — live stats, animated donut, calendar with reminders, activity log.
// Follows router pattern: initDashboard() / destroyDashboard()
'use strict';

const MOS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DC = { exam: '#8b5cf6', assign: '#3b82f6', meet: '#10b981', fee: '#ef4444', event: '#f59e0b', other: '#94a3b8' };

let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _selDay = new Date().getDate();
let _dashboardActive = false;
let _hasRunIntro = false;

// Renders Holidays
const INDIAN_HOLIDAYS = [
  // 2025
  { y: 2025, m: 0, d: 26, l: 'Republic Day' },
  { y: 2025, m: 1, d: 26, l: 'Maha Shivratri' },
  { y: 2025, m: 2, d: 14, l: 'Holi' },
  { y: 2025, m: 3, d: 14, l: 'Dr. Ambedkar Jayanti' },
  { y: 2025, m: 3, d: 18, l: 'Good Friday' },
  { y: 2025, m: 4, d: 12, l: 'Buddha Purnima' },
  { y: 2025, m: 7, d: 15, l: 'Independence Day' },
  { y: 2025, m: 9, d: 2, l: 'Gandhi Jayanti' },
  { y: 2025, m: 9, d: 2, l: 'Dussehra' },
  { y: 2025, m: 9, d: 20, l: 'Diwali' },
  { y: 2025, m: 10, d: 5, l: 'Guru Nanak Jayanti' },
  { y: 2025, m: 11, d: 25, l: 'Christmas Day' },
  // 2026
  { y: 2026, m: 0, d: 26, l: 'Republic Day' },
  { y: 2026, m: 1, d: 15, l: 'Maha Shivratri' },
  { y: 2026, m: 2, d: 3, l: 'Holi' },
  { y: 2026, m: 2, d: 31, l: 'Id-ul-Fitr (Eid)' },
  { y: 2026, m: 3, d: 3, l: 'Good Friday' },
  { y: 2026, m: 3, d: 14, l: 'Dr. Ambedkar Jayanti' },
  { y: 2026, m: 4, d: 31, l: 'Buddha Purnima' },
  { y: 2026, m: 5, d: 7, l: 'Id-ul-Adha (Bakrid)' },
  { y: 2026, m: 7, d: 15, l: 'Independence Day' },
  { y: 2026, m: 8, d: 5, l: 'Janmashtami' },
  { y: 2026, m: 9, d: 2, l: 'Gandhi Jayanti' },
  { y: 2026, m: 9, d: 20, l: 'Dussehra' },
  { y: 2026, m: 10, d: 8, l: 'Diwali' },
  { y: 2026, m: 10, d: 24, l: 'Guru Nanak Jayanti' },
  { y: 2026, m: 11, d: 25, l: 'Christmas Day' },
];

// Pre-populate holidays into reminders store
const _rems = {};
INDIAN_HOLIDAYS.forEach(h => {
  const k = `${h.y}-${h.m}-${h.d}`;
  if (!_rems[k]) _rems[k] = [];
  _rems[k].push({ t: 'event', l: h.l, s: 'National Holiday', d: false });
});

// ── Init ─────────────────────────────────────────────────────
window.initDashboard = async function initDashboard() {
  _dashboardActive = true;

  // Set today's date in the header pill
  const dateDisplay = document.getElementById('dash-date-display');
  const dayDisplay = document.querySelector('.dp-day');
  if (dateDisplay) {
    const today = new Date();
    dateDisplay.textContent = `${MOS[today.getMonth()].substring(0, 3)} ${today.getDate()}, ${today.getFullYear()}`;
    if (dayDisplay) dayDisplay.textContent = DOWS[today.getDay()];
  }

  // Pre-prepare elements with entry state (hidden)
  document.querySelector('.header')?.classList.add('ag-entry');
  document.querySelector('.cal-outer')?.classList.add('ag-entry');
  document.querySelectorAll('.split-left > .card').forEach(c => c.classList.add('ag-entry'));
  document.querySelectorAll('.split-right > .card').forEach(c => c.classList.add('ag-entry'));

  try {
    const students = await window.api.getAllStudents();
    const activities = await window.api.getRecentActivities();

    if (!_dashboardActive) return;

    const activeStudents = students.filter(s => String(s.status || '').trim().toLowerCase() !== 'inactive');

    _renderDashStats(activeStudents);
    _renderFeeDonut(activeStudents);
    
    // Sort active students by creation date to find truly newest 9
    const trulyRecent = [...activeStudents].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    _renderRecentStudents(trulyRecent);
    
    _renderActivityLog(activities);

    // Re-bind actions
    _bindSyncAction();
    
    // Check if we need to wait for splash screen or unlock
    if (window.splashScreenActive) {
      window.addEventListener('splashScreenDone', () => {
        // If the lock screen is showing, we wait for appUnlocked instead.
        const lockScreen = document.getElementById('lock-screen');
        if (lockScreen && !lockScreen.classList.contains('hidden')) {
          window.addEventListener('appUnlocked', () => {
            if (_dashboardActive) _runAntigravitySequence();
          }, { once: true });
        } else {
          if (_dashboardActive) _runAntigravitySequence();
        }
      }, { once: true });
    } else {
      // If no splash, check if lock screen is active
      const lockScreen = document.getElementById('lock-screen');
      if (lockScreen && !lockScreen.classList.contains('hidden')) {
        window.addEventListener('appUnlocked', () => {
          if (_dashboardActive) _runAntigravitySequence();
        }, { once: true });
      } else {
        // Trigger after a tiny microtask to ensure DOM is ready
        setTimeout(_runAntigravitySequence, 50);
      }
    }

  } catch (err) {
    console.error('Dashboard data error:', err);
    if (!_dashboardActive) return;
    if (typeof showToast === 'function') showToast('Dashboard failed to load: ' + err, 'error');
  }

  if (!_dashboardActive) return;

  _bindQuickActions();

  // Calendar
  _renderCalendar();
  document.getElementById('dash-cal-prev')?.addEventListener('click', _calPrev);
  document.getElementById('dash-cal-next')?.addEventListener('click', _calNext);
  document.getElementById('dash-cal-add-reminder')?.addEventListener('click', _addReminder);

  // Expose selDay for inline onclick generated by _renderCalendar
  window.selDay = function (d) { _selDay = d; _renderCalendar(); };
  bindKeyboardShortcuts();
};

window.refreshDashboardStats = async function() {
  if (!_dashboardActive) return;
  try {
    const students = await window.api.getAllStudents();
    const activeStudents = students.filter(s => String(s.status || '').trim().toLowerCase() !== 'inactive');
    _renderDashStats(activeStudents);
    _renderFeeDonut(activeStudents);
  } catch (err) {
    console.error('Failed to refresh dashboard stats:', err);
  }
};

window.destroyDashboard = function destroyDashboard() {
  _dashboardActive = false;
  document.getElementById('dash-cal-prev')?.removeEventListener('click', _calPrev);
  document.getElementById('dash-cal-next')?.removeEventListener('click', _calNext);
  document.getElementById('dash-cal-add-reminder')?.removeEventListener('click', _addReminder);
  document.removeEventListener('keydown', _dashboardKeyHandler);
  delete window.selDay;
};

// ── Stat Cards ───────────────────────────────────────────────
function _renderDashStats(students) {
  const el = document.getElementById('dash-stats');
  if (!el) return;

  const total = students.length;
  const paid = students.filter(s => s.feeStatus === 'paid').length;
  const pending = students.filter(s => s.feeStatus === 'pending').length;
  const rate = total > 0 ? Math.round((paid / total) * 100) : 0;

  // Count enrolled this month
  const now = new Date();
  const enrolledThisMonth = students.filter(s => {
    if (!s.createdAt) return false;
    const dt = new Date(s.createdAt);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;

  el.innerHTML = `
    <div class="stat-card sc-pu ag-entry">
      <div class="stat-label">Total Students</div>
      <div class="stat-ico si-pu"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
      <div class="stat-val" data-count-to="${total}" data-suffix="">0</div>
      <div class="stat-tag up"><svg class="tag-arr" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>${enrolledThisMonth} enrolled this month</div>
    </div>
    <div class="stat-card sc-tl ag-entry">
      <div class="stat-label">Fee Paid</div>
      <div class="stat-ico si-tl"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="stat-val" data-count-to="${paid}" data-suffix="">0</div>
      <div class="stat-tag up"><svg class="tag-arr" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>${rate}% collection rate</div>
    </div>
    <div class="stat-card sc-or ag-entry">
      <div class="stat-label">Fee Unpaid</div>
      <div class="stat-ico si-or"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
      <div class="stat-val" style="color:var(--or)" data-count-to="${pending}" data-suffix="">0</div>
      <div class="stat-tag dn"><svg class="tag-arr" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>${100 - rate}% still unpaid</div>
    </div>
    <div class="stat-card sc-pk ag-entry">
      <div class="stat-label">Collection Rate</div>
      <div class="stat-ico si-pk"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
      <div class="stat-val" data-count-to="${rate}" data-suffix="%">0%</div>
      <div class="stat-tag up"><svg class="tag-arr" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>Based on total enrolled</div>
    </div>
  `;
}

// ── Antigravity Sequence Orchestrator ────────────────────────
function _runAntigravitySequence() {
  if (_hasRunIntro) {
    // If already run once in this session, we can either skip or just show them
    document.querySelectorAll('.ag-entry').forEach(el => {
      el.classList.remove('ag-entry');
      const val = el.querySelector('.stat-val');
      if (val) {
        val.textContent = (val.dataset.countTo || '0') + (val.dataset.suffix || '');
        val.classList.add('counted');
      }
    });
    return;
  }
  _hasRunIntro = true;

  const t = (sel, delay, stagger = 0) => {
    const els = document.querySelectorAll(sel);
    els.forEach((el, i) => {
      setTimeout(() => {
        el.classList.remove('ag-entry');
        el.classList.add('ag-animate');
      }, delay + (i * stagger));
    });
  };

  // 1. Header (immediate)
  t('.header', 0);

  // 2. Stat Cards (100ms start, 100ms stagger)
  t('.stat-card', 100, 100);

  // Trigger count-up for each card after its float-up completes (duration 500ms)
  document.querySelectorAll('.stat-card').forEach((card, i) => {
    const val = card.querySelector('.stat-val');
    if (val) {
      setTimeout(() => _animateCountUpSingle(val), 100 + (i * 100) + 500);
    }
  });

  // 3. Charts / Widgets (400ms start, 150ms stagger)
  t('.donut-svg-wrap, .cal-outer, .split-left > .card, .split-right > .card', 400, 150);

  // 4. Table / List Rows (Waterfall cascade effect with 120ms stagger)
  t('.table-scroll tbody tr', 700, 120);
  t('.act-item', 750, 120);

  // 5. Quick Action Buttons (900ms start, 80ms stagger)
  t('.qa-primary, .qa-btn', 900, 80);

  // Cleanup: Remove will-change after all animations settle (~2.5s)
  setTimeout(() => {
    document.querySelectorAll('.ag-animate, .ag-entry, .stat-val, .donut-svg-wrap').forEach(el => {
      el.style.willChange = 'auto';
    });
  }, 3000);
}

// ── Count-Up Animation (Exponential easeOutExpo) ──────────────
function _animateCountUpSingle(el) {
  const target = parseInt(el.dataset.countTo, 10) || 0;
  const suffix = el.dataset.suffix || '';
  const duration = 800; // ms

  el.classList.add('counting');
  let start = null;

  function step(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    const progress = Math.min(elapsed / duration, 1);

    // easeOutExpo formula: value = finalValue * (1 - Math.pow(2, -10 * progress))
    const eased = progress === 1 ? 1 : (1 - Math.pow(2, -10 * progress));
    const current = Math.round(eased * target);

    el.textContent = current + suffix;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = target + suffix;
      el.classList.remove('counting');
      el.classList.add('counted');
    }
  }
  requestAnimationFrame(step);
}

// ── Animated Donut ───────────────────────────────────────────
function _renderFeeDonut(students) {
  const total = students.length;
  const paid = students.filter(s => s.feeStatus === 'paid').length;
  const unpaid = total - paid;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const unpaidPct = 100 - paidPct;

  // Legend
  const legend = document.getElementById('dash-fee-legend');
  if (legend) {
    legend.innerHTML = `
      <div class="dleg">
        <div class="dleg-dot" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"></div>
        <div class="dleg-info"><div class="name">Paid</div><div class="val">${paidPct}% of students</div></div>
        <div class="dleg-count" style="color:var(--pu)">${paid}</div>
      </div>
      <div class="dleg">
        <div class="dleg-dot" style="background:#f97316"></div>
        <div class="dleg-info"><div class="name">Unpaid</div><div class="val">${unpaidPct}% of students</div></div>
        <div class="dleg-count" style="color:var(--or)">${unpaid}</div>
      </div>
    `;
  }

  // Animate SVG arcs
  const circ = 2 * Math.PI * 58; // ~364.4
  const paidFrac = total > 0 ? paid / total : 0;

  const dPaid = document.getElementById('d-paid');
  const dUnpaid = document.getElementById('d-unpaid');
  const dPct = document.getElementById('dPct');
  if (!dPaid || !dUnpaid || !dPct) return;

  const dur = 1000; // ms
  let start = null;

  function animDonut(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / dur, 1);

    // easeInOutCubic: t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2
    const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const paidLen = circ * paidFrac * eased;
    const unpaidOffset = circ - (circ * paidFrac * eased);

    dPaid.style.strokeDashoffset = circ - paidLen;
    dUnpaid.style.strokeDashoffset = unpaidOffset;

    // Percent text sync
    dPct.textContent = Math.round(paidPct * eased) + '%';

    if (progress < 1) requestAnimationFrame(animDonut);
  }

  // Trigger donut animation
  const startDonutAnim = () => setTimeout(() => requestAnimationFrame(animDonut), 600);

  if (window.splashScreenActive) {
    window.addEventListener('splashScreenDone', () => {
      const lockScreen = document.getElementById('lock-screen');
      if (lockScreen && !lockScreen.classList.contains('hidden')) {
        window.addEventListener('appUnlocked', startDonutAnim, { once: true });
      } else {
        startDonutAnim();
      }
    }, { once: true });
  } else {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen && !lockScreen.classList.contains('hidden')) {
      window.addEventListener('appUnlocked', startDonutAnim, { once: true });
    } else {
      startDonutAnim();
    }
  }
}

// ── Recent Students Table ─────────────────────────────────────
function _renderRecentStudents(students) {
  const tbody = document.getElementById('dash-recent-tbody');
  const countEl = document.getElementById('dash-recent-count');
  if (countEl) countEl.textContent = `${students.length} students enrolled`;
  if (!tbody) return;

  const recent = students.slice(0, 9);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);">No students yet — add one from Quick Actions!</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map((s, idx) => {
    const firstName = s.firstName || '';
    const lastName = s.lastName || '';
    const studentId = s.studentId || '';
    const fullName = `${firstName} ${lastName}`.trim();

    // ── Standardized Initials Logic ────────────────────
    let initial = '??';
    if (firstName && lastName) {
      initial = (firstName[0] + lastName[0]).toUpperCase();
    } else if (firstName) {
      const parts = firstName.trim().split(/\s+/);
      if (parts.length > 1) initial = (parts[0][0] + parts[1][0]).toUpperCase();
      else initial = firstName.slice(0, 2).toUpperCase();
    } else if (lastName) {
      initial = lastName.slice(0, 2).toUpperCase();
    }

    // ── Standardized Color & Glow Logic ────────────────
    const palettes = [
      { bg: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)', glow: 'rgba(255, 107, 107, 0.4)' },
      { bg: 'linear-gradient(135deg, #6366F1 0%, #A855F7 100%)', glow: 'rgba(99, 102, 241, 0.4)' },
      { bg: 'linear-gradient(135deg, #3B82F6 0%, #2DD4BF 100%)', glow: 'rgba(59, 130, 246, 0.4)' },
      { bg: 'linear-gradient(135deg, #F97316 0%, #F59E0B 100%)', glow: 'rgba(249, 115, 22, 0.4)' },
      { bg: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)', glow: 'rgba(16, 185, 129, 0.4)' },
      { bg: 'linear-gradient(135deg, #EC4899 0%, #F43F5E 100%)', glow: 'rgba(236, 72, 153, 0.4)' },
      { bg: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)', glow: 'rgba(139, 92, 246, 0.4)' },
      { bg: 'linear-gradient(135deg, #06B6D4 0%, #3B82F6 100%)', glow: 'rgba(6, 182, 212, 0.4)' },
      { bg: 'linear-gradient(135deg, #F43F5E 0%, #FB923C 100%)', glow: 'rgba(244, 63, 94, 0.4)' },
      { bg: 'linear-gradient(135deg, #22C55E 0%, #84CC16 100%)', glow: 'rgba(34, 197, 94, 0.4)' },
    ];
    
    const seed = `${firstName} ${lastName} ${studentId}`.trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
    }
    const palette = palettes[Math.abs(hash) % palettes.length];

    const avatarHtml = s.photo_path 
      ? `<img src="file://${s.photo_path}" class="avatar" style="width:32px; height:32px; border-radius: 22%; object-fit: cover;" />`
      : `<span class="avatar" style="background:${palette.bg}; --avatar-glow:${palette.glow}; border-radius: 22%; color: #fff; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; font-size: 11px;">${initial}</span>`;

    let badgeCls, badgeTxt, badgeStyle = '';
    if (s.feeStatus === 'paid') {
      badgeCls = 'b-paid';
      badgeTxt = 'Paid';
    } else if (s.feeStatus === 'admission') {
      badgeCls = 'b-admission';
      badgeTxt = 'Admission';
      badgeStyle = 'background:#f3e8ff;color:#a855f7;border:1px solid #d8b4fe;padding-left:8px;';
    } else {
      badgeCls = 'b-unpaid';
      badgeTxt = 'Unpaid';
    }

    return `
      <tr class="ag-entry">
        <td class="hide-mobile"><span class="sid">${_esc(s.studentId)}</span></td>
        <td><div style="display:flex; align-items:center; gap:10px;">${avatarHtml}${_esc(fullName)}</div></td>
        <td>${_esc(s.class) || '—'}</td>
        <td style="color:var(--muted)">${_esc(s.phone) || '—'}</td>
        <td><span class="badge ${badgeCls}" style="${badgeStyle}">${badgeTxt}</span></td>
      </tr>`;
  }).join('');
}

// ── Activity Log ─────────────────────────────────────────────
function _renderActivityLog(activities) {
  const el = document.getElementById('activityList');
  if (!el) return;

  if (!activities || activities.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px 0;">No recent activity.</div>';
    return;
  }

  // Ensure exactly 5 items maximum are rendered as requested
  const items = activities.slice(0, 5).map(act => {
    const tAgo = _timeAgo(act.timestamp);

    // Pick correct SVG based on iconType stored in DB
    let svgIcon = '';
    if (act.iconType === 'ai-gr') {
      svgIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
    } else if (act.iconType === 'ai-tl') {
      svgIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (act.iconType === 'ai-or') {
      svgIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else if (act.iconType === 'ai-pk') {
      svgIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    } else {
      svgIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    }

    return `
      <div class="act-item ag-entry">
        <div class="act-icon ${act.iconType}">${svgIcon}</div>
        <div class="act-body">
          <div class="act-title">${act.title}</div>
          <div class="act-sub">${_esc(act.subtitle)}</div>
        </div>
        <div class="act-time">${tAgo}</div>
      </div>`;
  });

  el.innerHTML = items.join('');
}

// ── GitHub Sync Binding ───────────────────────────────────────
function _bindSyncAction() {
  const btn = document.getElementById('github-sync-btn');
  if (!btn) return;

  // Cleanup old listeners if any (re-binding prevention)
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async () => {
    if (newBtn.classList.contains('sync-active')) return;

    const textEl = document.getElementById('sync-btn-text');

    // Start animation & Update Text
    newBtn.classList.add('sync-active');
    if (textEl) textEl.textContent = 'Syncing...';
    
    try {
      const result = await window.api.syncFromGithub();
      
      // Artificial delay for visual satisfaction
      await new Promise(r => setTimeout(r, 1200));

      if (result.success) {
        showToast(`✓ Sync Successful: Fetched metadata for ${result.metadata.name}`, 'success');
        // Refresh activity log
        if (_dashboardActive) {
           const activities = await window.api.getRecentActivities();
           _renderActivityLog(activities);
        }
      } else {
        showToast(`Sync Failed: ${result.error}`, 'error');
      }
    } catch (err) {
      showToast(`Sync Error: ${err.message}`, 'error');
    } finally {
      // Stop animation & Restore text
      newBtn.classList.remove('sync-active');
      if (textEl) textEl.textContent = 'Sync Now';
    }
  });
}

// ── Quick Actions ────────────────────────────────────────────
function _bindQuickActions() {
  function navTo(page) {
    document.querySelector(`.nav-item[data-page="${page}"]`)
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  }

  document.getElementById('dash-add-student-btn')?.addEventListener('click', () => {
    navTo('students');
    setTimeout(() => {
      if (typeof window.openStudentModal === 'function') window.openStudentModal(null);
    }, 400);
  });

  document.getElementById('dash-go-courses-btn')?.addEventListener('click', () => navTo('courses'));
  document.getElementById('dash-go-fees-btn')?.addEventListener('click', () => navTo('fees'));
  document.getElementById('dash-go-slots-btn')?.addEventListener('click', () => navTo('slots'));
  document.getElementById('dash-view-all-students')?.addEventListener('click', () => navTo('students'));
}

// ── Calendar ─────────────────────────────────────────────────
function _calPrev() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  _selDay = 1;
  _renderCalendar();
}

function _calNext() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  _selDay = 1;
  _renderCalendar();
}

function _addReminder() {
  const modalHtml = `
    <div class="modal-overlay active" id="reminder-modal-overlay">
      <div class="modal edit-student-modal">
        <div class="modal-header edit-modal-header">
          <h3 class="modal-title edit-modal-title">
            <svg class="edit-title-icon" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Add Reminder
          </h3>
          <button class="modal-close" id="rem-modal-close-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body edit-modal-body">
          <div class="form-grid edit-form-grid">
            <div class="form-group form-full">
              <label class="form-label edit-form-label">REMINDER LABEL <span class="required-star">*</span></label>
              <input class="form-input edit-form-input" id="inp-rem-label" type="text" placeholder="e.g. Staff Meeting" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">DATE</label>
              <input class="form-input edit-form-input" id="inp-rem-date" type="date" value="${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(_selDay).padStart(2, '0')}" />
            </div>
            <div class="form-group">
              <label class="form-label edit-form-label">TIME / STATUS</label>
              <input class="form-input edit-form-input" id="inp-rem-time" type="text" placeholder="e.g. 10:00 AM or All Day" value="All Day" />
            </div>
            <div class="form-group form-full">
              <label class="form-label edit-form-label">TYPE</label>
              <select class="form-select edit-form-select" id="inp-rem-type">
                <option value="exam">Exam</option>
                <option value="assign">Assignment</option>
                <option value="meet">Meeting</option>
                <option value="fee">Fee Deadline</option>
                <option value="event">Event</option>
                <option value="other" selected>Other</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer edit-modal-footer">
          <button class="btn btn-save-changes" id="rem-modal-save-btn" style="background:#8b5cf6; border-color:#8b5cf6;">
            💾 Save Reminder
          </button>
          <button class="btn btn-cancel-outline" id="rem-modal-cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-root').innerHTML = modalHtml;

  const closeMod = () => {
    const modal = document.querySelector('.modal-overlay.active');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => {
        document.getElementById('modal-root').innerHTML = '';
      }, 300);
    } else {
      document.getElementById('modal-root').innerHTML = '';
    }
  };
  document.getElementById('rem-modal-close-btn').addEventListener('click', closeMod);
  document.getElementById('rem-modal-cancel-btn').addEventListener('click', closeMod);
  // ESC-only close - backdrop click disabled
  // document.getElementById('reminder-modal-overlay').addEventListener('click', (e) => {
  //   if (e.target === e.currentTarget) closeMod();
  // });

  document.getElementById('rem-modal-save-btn').addEventListener('click', () => {
    const lbl = document.getElementById('inp-rem-label').value.trim();
    const dt = document.getElementById('inp-rem-date').value;
    const tm = document.getElementById('inp-rem-time').value.trim();
    const tp = document.getElementById('inp-rem-type').value;

    if (!lbl || !dt) {
      if (typeof showToast === 'function') showToast('Label and Date are required.', 'error');
      return;
    }

    const [y, m, d] = dt.split('-').map(Number);
    const k = `${y}-${m - 1}-${d}`;

    if (!_rems[k]) _rems[k] = [];
    _rems[k].push({ t: tp, l: lbl, s: tm || 'All Day', d: false });

    // Switch view to the newly added date
    _selDay = d;
    _calMonth = m - 1;
    _calYear = y;
    _renderCalendar();

    closeMod();
    if (typeof showToast === 'function') showToast('Reminder added successfully.', 'success');
  });

  setTimeout(() => document.getElementById('inp-rem-label')?.focus(), 50);
}

function _renderCalendar() {
  const moEl = document.getElementById('calMo');
  const yrEl = document.getElementById('calYr');
  const dr = document.getElementById('dowRow');
  const dg = document.getElementById('daysG');
  if (!moEl || !yrEl || !dr || !dg) return;

  moEl.textContent = MOS[_calMonth];
  yrEl.textContent = _calYear;

  dr.innerHTML = DOWS.map(d => `<div class="dow">${d}</div>`).join('');

  const fd = new Date(_calYear, _calMonth, 1).getDay();
  const dim = new Date(_calYear, _calMonth + 1, 0).getDate();
  const pd = new Date(_calYear, _calMonth, 0).getDate();
  const today = new Date();

  let cells = [];
  for (let i = fd - 1; i >= 0; i--) cells.push({ d: pd - i, o: true });
  for (let d = 1; d <= dim; d++)     cells.push({ d, o: false });
  while (cells.length % 7) cells.push({ d: cells.length - fd - dim + 1, o: true });

  dg.innerHTML = cells.map((c, i) => {
    const it = !c.o && c.d === today.getDate() && _calMonth === today.getMonth() && _calYear === today.getFullYear();
    const is = !c.o && c.d === _selDay;
    const iw = (i % 7 === 0 || i % 7 === 6);
    const k = `${_calYear}-${_calMonth}-${c.d}`;
    const rs = (!c.o && _rems[k]) || [];
    const dots = rs.map(r => `<div class="d" style="background:${DC[r.t]}"></div>`).join('');

    const cls = ['dc', c.o ? 'oth' : '', it ? 'today' : '', is && !it ? 'sel' : '', iw && !c.o ? 'wk' : ''].filter(Boolean).join(' ');
    const onclick = c.o ? '' : `onclick="window.selDay(${c.d})"`;
    return `<div class="${cls}" ${onclick}><span class="dn2">${c.d}</span><div class="dot-r">${dots}</div></div>`;
  }).join('');

  _updCalDet();
}

function _updCalDet() {
  const detDate = document.getElementById('detDate');
  const detContent = document.getElementById('detContent');
  if (!detDate || !detContent) return;

  detDate.textContent = `${MOS[_calMonth]} ${_selDay}, ${_calYear}`;

  const k = `${_calYear}-${_calMonth}-${_selDay}`;
  const rs = _rems[k] || [];
  let html = '';

  if (rs.length) {
    html += rs.map((r, idx) => `
      <div class="rem-item" style="${r.d ? 'opacity:0.6; text-decoration:line-through; transition: 0.2s;' : 'transition: 0.2s;'}">
        <div class="rem-d" style="background:${DC[r.t]}"></div>
        <div style="flex:1;"><div class="rem-t">${_esc(r.l)}</div><div class="rem-s">${_esc(r.s)}</div></div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm btn-outline" style="border:1px solid ${r.d ? '#10b981' : '#e2e8f0'}; border-radius:6px; padding: 4px 8px; font-size:11px; background:${r.d ? 'rgba(16,185,129,0.1)' : 'transparent'}; color:${r.d ? '#10b981' : '#64748b'}" onclick="window.toggleRemDone('${k}', ${idx})">
            ${r.d ? '✓ Done' : 'Mark Done'}
          </button>
          <button class="btn btn-sm" style="background:transparent; border:1px solid #fee2e2; color:#ef4444; border-radius:6px; padding:4px 6px; font-size:11px;" onclick="window.deleteReminder('${k}', ${idx})" title="Delete Reminder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>`).join('');
  }

  if (!rs.length) {
    html = `
      <div class="empty-s">
        <div class="e-ico">📅</div>
        <div class="e-t">Nothing here yet</div>
        <div class="e-s">Click "+ Add Reminder"<br>to create one for this day.</div>
      </div>`;
  }

  detContent.innerHTML = html;
}

// ── Helpers ──────────────────────────────────────────────────
function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _timeAgo(dateStr) {
  if (!dateStr) return 'Just now';
  // Force SQLite format to be interpreted as UTC by swapping space to T and appending Z
  const isoStr = String(dateStr).replace(' ', 'T') + 'Z';
  let d = new Date(isoStr);

  if (isNaN(d.getTime())) d = new Date(dateStr);
  const diffSec = Math.floor((new Date() - d) / 1000);

  if (isNaN(diffSec) || diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

window.toggleRemDone = function (k, idx) {
  if (_rems[k] && _rems[k][idx]) {
    _rems[k][idx].d = !_rems[k][idx].d;
    _updCalDet();
  }
};

window.deleteReminder = function (k, idx) {
  if (_rems[k] && _rems[k][idx]) {
    _rems[k].splice(idx, 1);
    if (_rems[k].length === 0) delete _rems[k];
    _renderCalendar(); // Re-render to update dots
    _updCalDet();      // Update detail panel
    if (typeof showToast === 'function') showToast('Reminder removed.', 'info');
  }
};

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', _dashboardKeyHandler);
}

function _dashboardKeyHandler(e) {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('reminder-modal-overlay');
    if (overlay && overlay.classList.contains('active')) {
       document.getElementById('rem-modal-cancel-btn')?.click();
    }
  }
  if (e.key === 'Enter') {
    if (document.activeElement.tagName === 'TEXTAREA') return;
    const overlay = document.getElementById('reminder-modal-overlay');
    if (overlay && overlay.classList.contains('active')) {
       e.preventDefault();
       document.getElementById('rem-modal-save-btn')?.click();
    }
  }
}