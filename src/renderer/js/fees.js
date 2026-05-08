window.feesObj = {};

window.initFees = function () {
  const AVS = ['#4f46e5', '#22c55e', '#ef4444', '#f97316', '#7c3aed', '#06b6d4', '#ec4899', '#f59e0b', '#3b82f6', '#10b981', '#6366f1', '#14b8a6'];

  let fees = [], sflt = 'all', srtF = 'recent', srtA = false, detId = null, editId = null, cfCb = null;
  let currentPage = 1;
  const PAGE_SIZE = 10;

  const fmt = n => '₹' + Number(n).toLocaleString('en-IN');
  const avc = n => AVS[n.charCodeAt(0) % AVS.length];
  const ini = n => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const td = () => new Date().toISOString().slice(0, 10);

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 1 — ANCHOR CLAMP
  // Always offsets from the ORIGINAL admissionDate anchor day.
  // Never chains setMonth(). Handles short months & leap years correctly.
  //   Jan 31 + 2m = Mar 31  (snap-back, not Mar 28)
  //   Jan 31 + 1m = Feb 28  (clamped)
  // ─────────────────────────────────────────────────────────────────────────────
  const addMonthsClamped = (admDateStr, monthsToAdd) => {
    const adm = new Date(admDateStr);
    const anchorDay = adm.getDate();
    const targetMonth = adm.getMonth() + monthsToAdd;
    const targetYear = adm.getFullYear();
    // Normalize by creating a date on the 1st, then set the day
    const normalized = new Date(targetYear, targetMonth, 1);
    const lastDay = new Date(
      normalized.getFullYear(), normalized.getMonth() + 1, 0
    ).getDate();
    normalized.setDate(Math.min(anchorDay, lastDay));
    return normalized.toISOString().slice(0, 10);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 2 — PERIODS ELAPSED
  // A period is elapsed only when its DUE DATE has passed.
  // Period N due = admissionDate + N months.
  // Minimum 0 — a student inside their first window owes nothing yet.
  // ─────────────────────────────────────────────────────────────────────────────
  const getPeriodsElapsed = (admDateStr) => {
    if (!admDateStr) return 0;
    const adm = new Date(admDateStr);
    if (isNaN(adm.getTime())) return 0;
    const now = new Date();

    let months =
      (now.getFullYear() - adm.getFullYear()) * 12 +
      (now.getMonth() - adm.getMonth());

    // Clamp anchor to handle short months
    const anchorDay = adm.getDate();
    const lastDayOfCurrentMonth = new Date(
      now.getFullYear(), now.getMonth() + 1, 0
    ).getDate();
    const effectiveAnchor = Math.min(anchorDay, lastDayOfCurrentMonth);

    // If today hasn't reached the anchor day this month,
    // the current period's due date has NOT passed yet
    if (now.getDate() < effectiveAnchor) months--;

    // Minimum 0 — student may be inside their first window with nothing due yet
    return Math.max(0, months);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 3 — PERIOD BOUNDARY HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  // Start of the window the student is currently inside
  const getCurrentPeriodStart = (admDateStr) => {
    const periods = getPeriodsElapsed(admDateStr);
    return addMonthsClamped(admDateStr, periods);
  };

  // Due date of the current or most recently elapsed period
  // = admissionDate + (periodsElapsed + 1) months
  const getCurrentPeriodDue = (f) => {
    const periods = getPeriodsElapsed(f.admissionDate);
    return addMonthsClamped(f.admissionDate, periods + 1);
  };

  // For PAID students — when is the next payment due
  const getNextDue = (f) => {
    const periods = getPeriodsElapsed(f.admissionDate);
    return addMonthsClamped(f.admissionDate, periods + 1);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 4 — BALANCE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  const allPaid = (f) =>
    f.payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  // Total owed = monthlyFee × elapsed periods
  // 0 periods elapsed → nothing is due yet → totalOwed = 0
  const totalOwed = (f) =>
    Number(f.total) * getPeriodsElapsed(f.admissionDate);

  // Outstanding balance (never negative)
  const bal = (f) => Math.max(0, totalOwed(f) - allPaid(f));

  // How many full months are completely missed (integer floors)
  const missedPeriods = (f) => {
    const periods = getPeriodsElapsed(f.admissionDate);
    if (periods === 0) return 0;
    const totalDue = Number(f.total) * periods;
    const paid = allPaid(f);
    const unpaidAmt = Math.max(0, totalDue - paid);
    return Math.floor(unpaidAmt / Number(f.total));
  };

  // Carry-over = debt from more than 1 missed period
  // (used to distinguish UNPAID from OVERDUE)
  const carryOver = (f) => {
    const missed = missedPeriods(f);
    if (missed <= 1) return 0;
    return Number(f.total) * (missed - 1);
  };

  // Lifetime percentage: allPaid / totalOwed (accumulated debt)
  // Never exceeds 100, never goes below 0
  const pct = (f) => {
    const owed = totalOwed(f);
    if (owed <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(allPaid(f) / owed * 100)));
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 5 — STATUS LOGIC (4 states, strict priority)
  //
  //   due-soon  → periods === 0 (inside first window, nothing owed yet)
  //   paid      → balance === 0 AND periods > 0
  //   overdue   → missed > 1 (more than one month of fees owed)
  //   unpaid    → missed === 1 (exactly one month unpaid)
  // ─────────────────────────────────────────────────────────────────────────────
  const gst = (f) => {
    if (Number(f.total) <= 0) return 'paid';

    const periods = getPeriodsElapsed(f.admissionDate);
    const balance = bal(f);
    const missed = missedPeriods(f);

    if (periods === 0) return 'due-soon';
    if (balance <= 0) return 'paid';
    if (missed > 1) return 'overdue';
    return 'unpaid';
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA LOAD
  // ─────────────────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const dbFees = await window.api.getFees();
      let courses = [];
      try { courses = await window.api.getCourses(); } catch (e) { }

      if (dbFees && dbFees.length > 0) {
        const cMap = new Map((courses || []).map(c => [String(c.id), c]));
        fees = dbFees.map(f => {
          const c = cMap.get(String(f.courseId));
          return {
            id: String(f.id),
            studentId: f.studentId,
            name: `${f.firstName || ''} ${f.lastName || ''}`.trim() || 'Unknown',
            sid: f.s_studentId || `STU-${f.studentId}`,
            course: c ? (c.code || String(c.id)) : (f.courseId ? String(f.courseId) : 'Unassigned'),
            grade: f.class || '',
            phone: f.phone || '',
            total: f.totalAmount || 0,
            admissionDate: f.admissionDate || (f.createdAt ? f.createdAt.slice(0, 10) : td()),
            due: f.dueDate || '',
            payments: f.payments || [],
            notes: f.notes || '',
            status: f.status,
            studentStatus: f.studentStatus || 'Active',
            rawCreatedAt: f.studentCreatedAt || f.createdAt || '0'
          };
        });

        // Initial sort: inactive at bottom, then most recent on top
        fees.sort((a, b) => {
          const aInact = (String(a.studentStatus).toLowerCase() === 'inactive') ? 1 : 0;
          const bInact = (String(b.studentStatus).toLowerCase() === 'inactive') ? 1 : 0;
          if (aInact !== bInact) return aInact - bInact;
          return new Date(b.rawCreatedAt) - new Date(a.rawCreatedAt);
        });
      } else {
        fees = [];
      }
    } catch (e) {
      console.warn('DB load failed in fees:', e);
      fees = [];
    }
    render();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  function render() { rStats(); rt(); updFilters(); }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATS CARDS
  // Only count ACTIVE students (studentStatus !== 'Inactive')
  // ─────────────────────────────────────────────────────────────────────────────
  function rStats() {
    const active = fees.filter(f => String(f.studentStatus).toLowerCase() !== 'inactive');

    const monthlyTotal = active.reduce((s, f) => s + f.total, 0);
    const totalCollected = active.reduce((s, f) => s + allPaid(f), 0);
    const totalOwedAll = active.reduce((s, f) => s + totalOwed(f), 0);
    const totalOutstanding = active.reduce((s, f) => s + bal(f), 0);

    const fpCount = active.filter(f => gst(f) === 'paid').length;
    const unpCount = active.filter(f => gst(f) === 'unpaid' || gst(f) === 'overdue').length;
    const dsCount = active.filter(f => gst(f) === 'due-soon').length;

    const p = totalOwedAll > 0 ? Math.round(totalCollected / totalOwedAll * 100) : 0;

    document.getElementById('ca').textContent = active.length;
    document.getElementById('cp2').textContent = fpCount;
    document.getElementById('cu').textContent = unpCount;

    document.getElementById('sg').innerHTML = `
      <div class="sc cb" onclick="window.feesObj.setSF('all')">
        <div>
          <div class="sl">Monthly Fees</div>
          <div class="sv">${fmt(monthlyTotal)}</div>
          <div class="ss">${active.length} active students</div>
        </div>
        <div class="si sib">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
      </div>
      <div class="sc cg" onclick="window.feesObj.setSF('paid')">
        <div>
          <div class="sl">Collected</div>
          <div class="sv">${fmt(totalCollected)}</div>
          <div class="ss">${p}% of total owed</div>
        </div>
        <div class="si sig">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
      </div>
      <div class="sc cp" onclick="window.feesObj.setSF('paid')">
        <div>
          <div class="sl">Up to Date</div>
          <div class="sv">${fpCount}</div>
          <div class="ss">students fully paid</div>
        </div>
        <div class="si sip">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          </svg>
        </div>
      </div>
      <div class="sc co" onclick="window.feesObj.setSF('unpaid')">
        <div>
          <div class="sl">Unpaid / Overdue</div>
          <div class="sv">${unpCount}</div>
          <div class="ss">${fmt(totalOutstanding)} outstanding</div>
        </div>
        <div class="si sio">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
        </div>
      </div>
      ${dsCount > 0 ? `
      <div class="sc" style="border-color:var(--blue,#3b82f6);" onclick="window.feesObj.setSF('due-soon')">
        <div>
          <div class="sl">Due Soon</div>
          <div class="sv" style="color:var(--blue,#3b82f6);">${dsCount}</div>
          <div class="ss">inside first billing window</div>
        </div>
        <div class="si" style="color:var(--blue,#3b82f6);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
      </div>` : ''}
    `;

    document.getElementById('cp').textContent = p + '%';
    document.getElementById('cm').textContent = fmt(totalOwedAll);
    requestAnimationFrame(() => { document.getElementById('cf').style.width = p + '%'; });
  }

  function updFilters() {
    const sel2 = document.getElementById('cf2'), c2 = sel2.value;
    const cs = [...new Set(fees.map(f => f.course))].sort();
    sel2.innerHTML = '<option value="">All Courses</option>' + cs.map(c => `<option value="${c}"${c === c2 ? ' selected' : ''}>${c}</option>`).join('');
    document.getElementById('clist').innerHTML = [...cs].map(c => `<option value="${c}">`).join('');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FILTER / SORT
  // ─────────────────────────────────────────────────────────────────────────────
  function setSF(f) {
    sflt = f; currentPage = 1;
    document.querySelectorAll('.ftab').forEach(t => t.classList.toggle('on', t.dataset.f === f));
    rt();
  }
  function sf(btn) {
    document.querySelectorAll('.ftab').forEach(x => x.classList.remove('on'));
    btn.classList.add('on');
    sflt = btn.dataset.f;
    currentPage = 1;
    rt();
  }
  function srt(f) {
    if (srtF === f) srtA = !srtA; else { srtF = f; srtA = true; }
    ['name', 'course', 'total', 'paid', 'balance', 'due', 'status'].forEach(x => {
      const e = document.getElementById('a' + x[0]);
      if (e) e.textContent = '';
    });
    const e = document.getElementById('a' + f[0]);
    if (e) e.textContent = srtA ? '↑' : '↓';
    document.getElementById('sind')?.remove();
    rt();
  }

  function gfr() {
    const q = document.getElementById('qi').value.toLowerCase();
    const co = document.getElementById('cf2').value;
    return fees.filter(f => {
      const mq = !q || (f.name.toLowerCase().includes(q) || f.course.toLowerCase().includes(q) || f.sid.toLowerCase().includes(q) || f.grade.toLowerCase().includes(q));
      return mq && (!co || f.course === co) && (sflt === 'all' || gst(f) === sflt);
    }).sort((a, b) => {
      // Inactive always sink to bottom
      const aInact = (String(a.studentStatus).toLowerCase() === 'inactive') ? 1 : 0;
      const bInact = (String(b.studentStatus).toLowerCase() === 'inactive') ? 1 : 0;
      if (aInact !== bInact) return aInact - bInact;

      let va, vb;
      if (srtF === 'name') { va = a.name; vb = b.name; }
      else if (srtF === 'course') { va = a.course; vb = b.course; }
      else if (srtF === 'total') { va = a.total; vb = b.total; }
      else if (srtF === 'paid') { va = allPaid(a); vb = allPaid(b); }
      else if (srtF === 'balance') { va = bal(a); vb = bal(b); }
      else if (srtF === 'due') { va = getCurrentPeriodDue(a); vb = getCurrentPeriodDue(b); }
      else if (srtF === 'status') { va = gst(a); vb = gst(b); }
      else { va = a.rawCreatedAt; vb = b.rawCreatedAt; }

      if (va < vb) return srtA ? -1 : 1;
      if (va > vb) return srtA ? 1 : -1;
      return 0;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PAGINATION
  // ─────────────────────────────────────────────────────────────────────────────
  function goPage(p) {
    currentPage = p;
    rt();
    const tcard = document.querySelector('#main-content[data-page="fees"] .tcard');
    if (tcard) tcard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildPagination(totalRows) {
    const pgn = document.getElementById('pgn');
    if (!pgn) return;
    const totalPages = Math.ceil(totalRows / PAGE_SIZE);
    if (totalPages <= 1) {
      pgn.innerHTML = `<span class="table-count">Showing ${totalRows} of ${totalRows} records</span>`;
      return;
    }
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalRows);
    let html = `<span class="table-count">Showing ${start}–${end} of ${totalRows} records</span>`;
    html += `<div class="pagination">`;
    html += `<button class="pg-btn ${currentPage === 1 ? 'disabled' : ''}" ${currentPage === 1 ? 'disabled' : ''} onclick="window.feesObj.goPage(${currentPage - 1})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>`;
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
    if (startPage > 1) {
      html += `<button class="pg-btn" onclick="window.feesObj.goPage(1)">1</button>`;
      if (startPage > 2) html += `<span class="pgn-dots">…</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="pg-btn ${i === currentPage ? 'active' : ''}" onclick="window.feesObj.goPage(${i})">${i}</button>`;
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="pgn-dots">…</span>`;
      html += `<button class="pg-btn" onclick="window.feesObj.goPage(${totalPages})">${totalPages}</button>`;
    }
    html += `<button class="pg-btn ${currentPage === totalPages ? 'disabled' : ''}" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.feesObj.goPage(${currentPage + 1})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </button>`;
    html += '</div>';
    pgn.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TABLE RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  function rt() {
    const allRows = gfr();
    const totalRows = allRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const rows = allRows.slice(start, start + PAGE_SIZE);

    document.getElementById('ts').textContent = `${totalRows} record${totalRows !== 1 ? 's' : ''} total`;
    const tbody = document.getElementById('tb');

    if (!totalRows) {
      tbody.innerHTML = `<tr class="er"><td colspan="9"><span style="font-size:36px;display:block;margin-bottom:10px;">📋</span>No records match your filters. <a href="#" onclick="window.feesObj.clrAll()" style="color:var(--blue)">Clear filters</a></td></tr>`;
      buildPagination(0);
      return;
    }

    tbody.innerHTML = rows.map(f => {
      const lifetimePaid = allPaid(f);
      const lifetimeOwed = totalOwed(f);
      const b = bal(f);
      const pc = pct(f);
      const st = gst(f);
      const co = carryOver(f);
      const periodDue = getCurrentPeriodDue(f);
      const missed = missedPeriods(f);
      const today = td();
      const daysLeft = Math.round((new Date(periodDue) - new Date(today)) / (1000 * 60 * 60 * 24));

      const bc = pc >= 100 ? 'full' : pc === 0 ? 'zero' : pc < 30 ? 'low' : '';
      const blc = b > 0 ? (co > 0 ? 'b-ov' : 'b-du') : 'b-cl';
      const av = avc(f.name);
      const isInactive = String(f.studentStatus).toLowerCase() === 'inactive';
      const delay = 0.5 + (rows.indexOf(f) * 0.05);

      // Status-driven sub-text + row highlight + badge class
      let subText, subColor, isWarningRow = false, badgeClass;
      switch (st) {
        case 'due-soon':
          subText = `⏳ Due in ${daysLeft} days — ${periodDue}`;
          subColor = 'color:var(--blue,#3b82f6)';
          badgeClass = 'b-due-soon';
          break;
        case 'paid':
          subText = `✅ Next due: ${getNextDue(f)}`;
          subColor = 'color:var(--green,#22c55e)';
          badgeClass = 'b-paid';
          break;
        case 'unpaid':
          subText = `⚠️ Unpaid — was due ${periodDue}`;
          subColor = 'color:var(--orange,#f97316)';
          badgeClass = 'b-unpaid';
          isWarningRow = true;
          break;
        case 'overdue':
          subText = `🔴 ${missed} month${missed !== 1 ? 's' : ''} overdue — ${fmt(b)} outstanding`;
          subColor = 'color:var(--red,#ef4444)';
          badgeClass = 'b-overdue';
          isWarningRow = true;
          break;
        default:
          subText = ''; subColor = ''; badgeClass = 'b-unpaid';
      }

      const dateDisplay = `<span class="dd ${isWarningRow ? 'd-ov' : 'd-ok'}">${periodDue}<br><span style="font-size:10px;font-weight:700;${subColor}">${subText}</span></span>`;
      const statusLabel = st.charAt(0).toUpperCase() + st.slice(1).replace('-', ' ');

      // Action buttons depend on status
      const needsPayment = st === 'unpaid' || st === 'overdue' || st === 'due-soon';
      const actionBtns = `
        ${needsPayment ? `
          <button class="ab pa" style="padding:5px 8px;" onclick="window.feesObj.openDetPay('${f.id}')" title="Record Payment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </button>` : ''}
        ${(st === 'unpaid' || st === 'overdue') ? `
          <button class="ab rm" style="padding:5px 8px; font-size:13px;" onclick="window.feesObj.qRem('${f.id}')" title="Send Reminder">🔔</button>` : ''}
        <button class="ab ed" style="padding:5px 8px;" onclick="window.feesObj.openEd('${f.id}')" title="Edit Fee Record">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="ab dl" style="padding:5px 8px; font-size:13px; color:var(--red);" onclick="window.feesObj.delRec('${f.id}')" title="Delete Record">🗑</button>
      `;

      return `<tr class="${isWarningRow ? 'rov' : ''} ant-f" id="r-${f.id}" style="animation-delay:${delay}s; ${isInactive ? 'filter:grayscale(100%) opacity(0.6); pointer-events:none;' : ''}">
        <td><div class="stc"><div class="av" style="background:${av}">${ini(f.name)}</div><div><div class="stn">${f.name}</div><div class="stg">${f.grade || ''}</div></div></div></td>
        <td><span class="course-badge">${f.course}</span></td>
        <td><span class="famt">${fmt(f.total)}</span></td>
        <td class="paid-cell"><div class="pc"><span class="pv">${fmt(lifetimePaid)}</span><span class="pp ${bc}">${pc === 100 ? '100% Cleared' : pc + '% Paid'}</span><div class="pb"><div class="pf ${bc}" style="width:${pc}%"></div></div></div></td>
        <td class="balance-cell"><div class="balance-container"><span class="amount ba ${blc}">${b > 0 ? fmt(b) : '₹0'}</span><span class="bdg ${b === 0 ? 'b-paid' : badgeClass}">${b === 0 ? '100% Cleared' : statusLabel}</span></div></td>
        <td>${dateDisplay}</td>
        <td class="hide-mobile"><span class="bdg ${badgeClass}">${statusLabel}</span></td>
        <td>
          <button class="ab hi" style="border-color:#bfdbfe; color:#1d4ed8; background:#eff6ff; padding:5px 12px;" onclick="window.feesObj.openHist('${f.id}')">📜 Record</button>
        </td>
        <td><div class="ac" style="display:flex; gap:6px;">${actionBtns}</div></td>
      </tr>`;
    }).join('');

    buildPagination(totalRows);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SEARCH / FILTER CONTROLS
  // ─────────────────────────────────────────────────────────────────────────────
  function onSrch(i) { document.getElementById('qclr').style.display = i.value ? 'block' : 'none'; currentPage = 1; rt(); }
  function clrSrch() { document.getElementById('qi').value = ''; document.getElementById('qclr').style.display = 'none'; currentPage = 1; rt(); }
  function clrAll() { clrSrch(); document.getElementById('cf2').value = ''; currentPage = 1; setSF('all'); }

  // ─────────────────────────────────────────────────────────────────────────────
  // EDIT FEE RECORD MODAL
  // ─────────────────────────────────────────────────────────────────────────────
  function vld() {
    let ok = true;
    [['fn-fi', document.getElementById('fn').value.trim()],
    ['fc-fi', document.getElementById('fc').value.trim()],
    ['ft-fi', parseFloat(document.getElementById('ftot').value) > 0],
    ['fd-fi', document.getElementById('fdu').value]
    ].forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (!v) { el.classList.add('err'); ok = false; } else el.classList.remove('err');
    });
    return ok;
  }
  function cfe(id) { document.getElementById(id).classList.remove('err'); }

  function openEd(id) {
    editId = id;
    const f = fees.find(x => x.id === id);
    if (!f) return;
    document.getElementById('amt').textContent = 'Edit Fee Record';
    document.getElementById('ams').textContent = `Editing: ${f.name}`;
    document.getElementById('fn').value = f.name;
    document.getElementById('fc').value = f.course;
    document.getElementById('fg').value = f.grade;
    document.getElementById('fph').value = f.phone;
    document.getElementById('ftot').value = f.total;
    document.getElementById('fdu').value = f.due || getCurrentPeriodDue(f);
    document.getElementById('fno').value = f.notes || '';
    ['fn-fi', 'fc-fi', 'ft-fi', 'fd-fi'].forEach(id => document.getElementById(id).classList.remove('err'));
    document.getElementById('addMd').classList.add('on');
  }

  function closeAdd() { document.getElementById('addMd').classList.remove('on'); editId = null; }

  async function saveRec() {
    if (!vld()) return;
    const name = document.getElementById('fn').value.trim();
    const total = parseFloat(document.getElementById('ftot').value);
    const due = document.getElementById('fdu').value;
    const notes = document.getElementById('fno').value.trim();
    const phone = document.getElementById('fph').value.trim();
    const grade = document.getElementById('fg').value.trim();

    if (editId) {
      const fObj = fees.find(x => x.id === editId);
      if (!fObj) return;

      // ── SECTION 10 guard: warn if fee amount is changing ──────────────────
      if (total !== fObj.total) {
        const confirmed = await showFeeChangeWarning(fObj.total, total, fObj.name);
        if (!confirmed) return;
        // Log change to notes
        const logEntry = `Fee changed from ${fmt(fObj.total)} to ${fmt(total)} on ${td()}`;
        notes && (notes + ' | ' + logEntry);
      }

      try {
        await window.api.updateFee(fObj.studentId, { totalAmount: total, dueDate: due, notes: notes });
        const st = await window.api.getStudentById(fObj.studentId);
        if (st) {
          const nameParts = name.split(/\s+/);
          st.firstName = nameParts[0] || '';
          st.lastName = nameParts.slice(1).join(' ');
          st.phone = phone;
          st.class = grade;
          await window.api.updateStudent(st.id, st);
        }
        await load();
        toast(`Record updated for ${name}`, 'b');
      } catch (e) {
        console.error('DB update failed:', e);
        toast('Failed to save changes', 'r');
      }
    } else {
      toast('Fee records must be generated via the Students tab', 'r');
    }
    closeAdd();
  }

  // ── Fee change warning modal (Section 10) ───────────────────────────────────
  function showFeeChangeWarning(oldAmt, newAmt, studentName) {
    return new Promise(resolve => {
      showCf(
        '⚠️ Fee Amount Change',
        `Changing the monthly fee from <strong>${fmt(oldAmt)}</strong> to <strong>${fmt(newAmt)}</strong> will recalculate ALL past balances for <strong>${studentName}</strong> at the new rate.<br><br>This cannot be undone. Are you sure?`,
        () => resolve(true)
      );
      // If user cancels, closeCf sets cfCb = null, resolve never fires → returns undefined
      // We need to capture the cancel too
      const original = cfCb;
      const cancelBtn = document.querySelector('#cfMd .btn-cancel, #cfMd [data-cancel]');
      if (cancelBtn) {
        const oldClick = cancelBtn.onclick;
        cancelBtn.onclick = (e) => { oldClick && oldClick(e); resolve(false); };
      }
      // Fallback: override closeCf for this one call
      const _origCloseCf = closeCf;
      window._feeChangeResolve = resolve;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BILLING HISTORY MODAL  (Section 9 — waterfall FIFO)
  // ─────────────────────────────────────────────────────────────────────────────
  let histId = null;

  function openHist(id) { histId = id; bldHist(); document.getElementById('histMd').classList.add('on'); }
  function closeHist() { document.getElementById('histMd').classList.remove('on'); histId = null; }

  function bldHist() {
    const f = fees.find(x => x.id === histId);
    if (!f) return;

    document.getElementById('hmt').textContent = f.name + ' — Billing History';
    document.getElementById('hms').textContent = f.course + (f.grade ? ' · ' + f.grade : '');

    const adm = new Date(f.admissionDate || td());
    if (isNaN(adm.getTime())) return;

    const periodsCount = getPeriodsElapsed(f.admissionDate);

    // Waterfall FIFO — oldest payments fill earliest periods first
    let pool = [...f.payments]
      .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate))
      .map(p => ({ ...p, remaining: Number(p.amount) }));

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let html = '';

    // ── Elapsed periods ──────────────────────────────────────────────────────
    for (let i = 0; i < periodsCount; i++) {
      // Period boundaries: start = adm + i months, due = adm + (i+1) months
      const periodStart = addMonthsClamped(f.admissionDate, i);
      const periodDue = addMonthsClamped(f.admissionDate, i + 1);

      let owed = Number(f.total);
      let applied = [];

      while (owed > 0 && pool.length > 0 && pool[0].remaining > 0) {
        const use = Math.min(owed, pool[0].remaining);
        owed -= use;
        pool[0].remaining -= use;
        applied.push({
          date: pool[0].paymentDate,
          amount: use,
          method: pool[0].method,
          note: pool[0].note
        });
        if (pool[0].remaining <= 0) pool.shift();
      }

      const ds = new Date(periodStart), de = new Date(periodDue);
      const label = `Month ${i + 1} · ${MONTHS[ds.getMonth()]} ${ds.getDate()}, ${ds.getFullYear()} – ${MONTHS[de.getMonth()]} ${de.getDate()}, ${de.getFullYear()}`;

      let periodStatus, stClass;
      if (owed === 0 && f.total > 0) { periodStatus = 'Paid'; stClass = 'b-paid'; }
      else if (owed === 0) { periodStatus = 'N/A'; stClass = 'b-paid'; }
      else if (owed < Number(f.total)) { periodStatus = 'Partial'; stClass = 'b-partial'; }
      else { periodStatus = 'Unpaid'; stClass = 'b-unpaid'; }

      const paymentsHtml = applied.length > 0
        ? applied.map(p =>
          `<div style="font-size:12px; color:var(--text); margin-top:4px; display:flex; justify-content:space-between; border-bottom:1px dotted var(--border); padding-bottom:3px;">
               <span>${p.date} · <strong>${p.method}</strong>${p.note ? ' · ' + p.note : ''}</span>
               <span style="font-weight:600;">+ ${fmt(p.amount)}</span>
             </div>`
        ).join('')
        : `<div style="font-size:12px; color:var(--t3); margin-top:4px;">No payments recorded for this period</div>`;

      html += `
        <div style="background:var(--bg); border:1px solid var(--border); border-radius:var(--rs); padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
            <div style="font-weight:700; font-size:13px;">${label}</div>
            <span class="bdg ${stClass}">${periodStatus}</span>
          </div>
          <div style="font-size:12px; color:var(--t2); margin-bottom:8px;">
            Due: ${periodDue} · Monthly Fee: ${fmt(f.total)}
            ${owed > 0 && owed < f.total ? `· Remaining: <span style="color:var(--orange,#f97316)">${fmt(owed)}</span>` : ''}
          </div>
          <div style="background:#fff; padding:8px; border-radius:6px;">${paymentsHtml}</div>
        </div>`;
    }

    // ── Current open window (not yet due) ───────────────────────────────────
    const currentStart = addMonthsClamped(f.admissionDate, periodsCount);
    const currentDue = addMonthsClamped(f.admissionDate, periodsCount + 1);
    const cs = new Date(currentStart), cd = new Date(currentDue);
    const currentLabel = periodsCount === 0
      ? `Month 1 — First billing period`
      : `Month ${periodsCount + 1} — Current period`;

    const daysLeft = Math.round((cd - new Date()) / (1000 * 60 * 60 * 24));
    html += `
      <div style="background:var(--blue-l,#eff6ff); border:1px solid #bfdbfe; border-radius:var(--rs); padding:12px 16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
          <div style="font-weight:700; font-size:13px; color:#1d4ed8;">
            ${currentLabel}
            · ${MONTHS[cs.getMonth()]} ${cs.getDate()}, ${cs.getFullYear()} – ${MONTHS[cd.getMonth()]} ${cd.getDate()}, ${cd.getFullYear()}
          </div>
          <span class="bdg" style="background:#dbeafe; color:#1d4ed8; border-color:#93c5fd;">Upcoming</span>
        </div>
        <div style="font-size:12px; color:#1d4ed8; margin-bottom:4px;">
          Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — ${currentDue}
        </div>
        ${periodsCount === 0
        ? `<div style="font-size:11px; color:#3b82f6; margin-top:4px;">No fee is due yet. The first payment is due on ${currentDue}.</div>`
        : ''}
      </div>`;

    // ── Surplus credit ───────────────────────────────────────────────────────
    const surplus = pool.reduce((sum, p) => sum + p.remaining, 0);
    if (surplus > 0) {
      html += `
        <div style="background:var(--green-l,#f0fdf4); border:1px solid #bbf7d0; border-radius:var(--rs); padding:12px 16px;">
          <div style="font-weight:700; font-size:13px; color:var(--green-d,#15803d);">✅ Credit Balance</div>
          <div style="font-size:12px; color:var(--green-d,#15803d); margin-top:6px;">
            Unused credit of <strong>${fmt(surplus)}</strong> will be applied to future billing periods.
          </div>
        </div>`;
    }

    document.getElementById('hgrid').innerHTML = html || '<div style="color:var(--t3); font-size:13px;">No billing history yet.</div>';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PAYMENT DETAIL MODAL
  // ─────────────────────────────────────────────────────────────────────────────
  function openDetPay(id) {
    detId = id;
    bldDet();
    document.getElementById('detMd').classList.add('on');
    setTimeout(() => document.getElementById('na')?.focus(), 200);
  }
  function closeDet() { document.getElementById('detMd').classList.remove('on'); detId = null; }

  function bldDet() {
    const f = fees.find(x => x.id === detId);
    if (!f) return;

    const totalP = allPaid(f);
    const lifetimeOwed = totalOwed(f);
    const b = bal(f);
    const pc2 = pct(f);
    const st = gst(f);
    const co = carryOver(f);
    const periodDue = getCurrentPeriodDue(f);
    const missed = missedPeriods(f);
    const daysLeft = Math.round((new Date(periodDue) - new Date()) / (1000 * 60 * 60 * 24));

    document.getElementById('dmt').textContent = f.name;
    document.getElementById('dms').textContent = `${f.course} · ${f.grade}`;
    document.getElementById('dppct').textContent = pc2 + '%';
    document.getElementById('dpbar').style.width = pc2 + '%';
    document.getElementById('dplbl').textContent = `Overall — ${fmt(totalP)} of ${fmt(lifetimeOwed)} paid`;

    let subText, subColor;
    switch (st) {
      case 'due-soon': subText = `⏳ Due in ${daysLeft} days — ${periodDue}`; subColor = 'color:var(--blue,#3b82f6)'; break;
      case 'paid': subText = `✅ Next due: ${getNextDue(f)}`; subColor = 'color:var(--green,#22c55e)'; break;
      case 'unpaid': subText = `⚠️ Unpaid — was due ${periodDue}`; subColor = 'color:var(--orange,#f97316)'; break;
      case 'overdue': subText = `🔴 ${missed} months overdue — ${fmt(b)} outstanding`; subColor = 'color:var(--red,#ef4444)'; break;
      default: subText = ''; subColor = '';
    }

    document.getElementById('dgrid').innerHTML = `
      <div class="di"><div class="dil">Monthly Fee</div><div class="div">${fmt(f.total)}</div></div>
      <div class="di"><div class="dil">Total Accrued Due</div><div class="div">${fmt(lifetimeOwed)}</div></div>
      <div class="di"><div class="dil">Lifetime Paid</div><div class="div" style="color:var(--green)">${fmt(totalP)}</div></div>
      <div class="di"><div class="dil">Outstanding Balance</div><div class="div" style="color:${b > 0 ? 'var(--orange)' : 'var(--green)'}">${b > 0 ? fmt(b) : '✓ Cleared'}</div></div>
      <div class="di" style="grid-column:1/-1"><div class="dil">Status</div><div class="div"><span style="font-weight:700; ${subColor}">${subText}</span></div></div>
      <div class="di"><div class="dil">Admission Date</div><div class="div">${f.admissionDate || '—'}</div></div>
      <div class="di"><div class="dil">Phone</div><div class="div">${f.phone || '—'}</div></div>
      <div class="di"><div class="dil">Current Status</div><div class="div"><span class="bdg b-${st}">${st.charAt(0).toUpperCase() + st.slice(1).replace('-', ' ')}</span></div></div>
      ${f.notes ? `<div class="di" style="grid-column:1/-1"><div class="dil">Notes</div><div class="div" style="font-size:12px;color:var(--t2)">${f.notes}</div></div>` : ''}
    `;

    const pl = document.getElementById('dpl');
    pl.innerHTML = !f.payments.length
      ? `<div style="color:var(--t3);font-size:13px;padding:8px 0 12px;">No payments recorded yet. Use the form below to add the first payment.</div>`
      : f.payments.map((p2, i) =>
        `<div class="pr">
            <div><div class="pd">${p2.paymentDate} · <strong>${p2.method}</strong>${p2.note ? ' · ' + p2.note : ''}</div></div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="pra">${fmt(p2.amount)}</div>
              <button class="prd" onclick="window.feesObj.delPay(${i})">✕</button>
            </div>
          </div>`
      ).join('');

    // Pre-fill amount to the outstanding balance (capped at one month)
    document.getElementById('na').value = b > 0 ? Math.min(b, f.total) : '';
    document.getElementById('nd').value = td();
    document.getElementById('nn').value = '';

    // ── Section 12 guard: lock future dates ──────────────────────────────────
    document.getElementById('nd').max = td();

    document.getElementById('dsum').innerHTML = `
      <div class="sumr"><span class="suml">Monthly Fee</span><span class="sumv">${fmt(f.total)}</span></div>
      <div class="sumr"><span class="suml">Total Payments</span><span class="sumv">${f.payments.length}</span></div>
      <div class="sumr"><span class="suml">Lifetime Paid</span><span class="sumv" style="color:var(--green)">${fmt(totalP)}</span></div>
      ${co > 0 ? `<div class="sumr"><span class="suml" style="color:var(--red);">Carry-over</span><span class="sumv" style="color:var(--red);">${fmt(co)}</span></div>` : ''}
      <div class="sumr"><span class="suml" style="font-weight:700;">Balance Due</span><span class="sumv" style="color:${b > 0 ? 'var(--orange)' : 'var(--green)'};font-size:15px;">${b > 0 ? fmt(b) : '✓ Fully Cleared'}</span></div>
    `;
  }

  async function addPay() {
    const f = fees.find(x => x.id === detId);
    const amt = parseFloat(document.getElementById('na').value);
    const dt = document.getElementById('nd').value;
    const mt = document.getElementById('nm').value;
    const nt = document.getElementById('nn').value.trim();

    if (!amt || amt <= 0) { toast('Enter a valid payment amount', 'r'); return; }
    if (!dt) { toast('Enter payment date', 'r'); return; }

    // ── Section 12 guard: no future dates ───────────────────────────────────
    if (dt > td()) { toast('Payment date cannot be in the future', 'r'); return; }

    if (amt > bal(f)) { toast(`Amount exceeds balance of ${fmt(bal(f))}`, 'r'); return; }

    try {
      await window.api.addPayment(f.id, { amount: amt, method: mt, paymentDate: dt, note: nt });
      await load();
      bldDet();
      toast(`Payment of ${fmt(amt)} recorded for ${f.name}`, 'g');
      const updated = fees.find(x => x.id === detId);
      if (updated && bal(updated) === 0) {
        setTimeout(() => toast(`🎉 ${f.name} has cleared all outstanding fees!`, 'g'), 500);
      }
    } catch (e) {
      toast('Failed to add payment', 'r');
    }
  }

  function delPay(i) {
    const f = fees.find(x => x.id === detId);
    const payment = f.payments[i];

    // ── Section 12 guard: warn about waterfall consequences ─────────────────
    // Check if this payment's period was previously "Paid"
    const wasFullyPaid = bal(f) <= 0;

    showCf(
      '⚠️ Delete Payment?',
      `Deleting this payment may reopen previously settled billing periods. The waterfall will be recalculated from this point.<br><br><strong>This cannot be undone.</strong>`,
      async () => {
        if (!payment || !payment.id) return;
        await window.api.deletePayment(payment.id);
        await load();
        bldDet();
        const updated = fees.find(x => x.id === detId);
        toast('Payment deleted', 'b');
        // Warn if a settled period has been reopened
        if (wasFullyPaid && updated && bal(updated) > 0) {
          setTimeout(() => toast('⚠️ A previously paid period is now unpaid.', 'w'), 400);
        }
      }
    );
  }

  function delFromDet() { toast('To delete a student\'s fee record, remove the student from the Students section.', 'w'); }
  function delRec(id) { toast('To delete a student\'s fee record, remove the student from the Students section.', 'w'); }

  // ─────────────────────────────────────────────────────────────────────────────
  // REMINDER MODAL
  // ─────────────────────────────────────────────────────────────────────────────
  let remId2 = null;

  function qRem(id) { remId2 = id; bldRem(); document.getElementById('remMd').classList.add('on'); }
  function openRem() { remId2 = detId; bldRem(); document.getElementById('remMd').classList.add('on'); }
  function closeRem() { document.getElementById('remMd').classList.remove('on'); remId2 = null; }

  function bldRem() {
    const f = fees.find(x => x.id === remId2);
    if (!f) return;
    const phone = (f.phone || '').replace(/\D/g, '');
    const hasPhone = phone.length >= 10;
    document.getElementById('rsub2').textContent = `To: ${f.name} · ${hasPhone ? '+91' + phone.slice(-10) : '⚠️ No phone number'}`;
    document.getElementById('rex').value = '';
    updRem();
  }

  function updRem() {
    const f = fees.find(x => x.id === remId2);
    if (!f) return;
    const b = bal(f);
    const missed = missedPeriods(f);
    const ug = document.getElementById('rug').value;
    const via = document.getElementById('rv').value;
    const ex = document.getElementById('rex').value.trim();
    const nextDue = getCurrentPeriodDue(f);
    const st = gst(f);

    const overdueNote = st === 'overdue'
      ? `\n\nThis account is ${missed} month${missed !== 1 ? 's' : ''} overdue with ${fmt(b)} outstanding.`
      : '';

    const msgs = {
      friendly: `Dear ${f.name},\n\nThis is a friendly reminder that your fee payment of ${fmt(b)} for ${f.course} is due on ${nextDue}.${overdueNote}\n\nKindly arrange payment at your earliest convenience.`,
      firm: `Dear ${f.name},\n\nYour outstanding fee balance of ${fmt(b)} for ${f.course} is due ${nextDue}. Please clear this amount immediately to avoid further delays.${overdueNote}`,
      final: `Dear ${f.name},\n\nFINAL NOTICE: Your fee of ${fmt(b)} for ${f.course} (due: ${nextDue}) is significantly overdue. Immediate payment is required.${overdueNote}`
    };

    const msg = (msgs[ug] || msgs.friendly)
      + (ex ? '\n\n' + ex : '')
      + '\n\nRegards,\nDATAFLOW Teacher Portal';

    document.getElementById('rprev').innerHTML = msg.replace(/\n/g, '<br>');
    const btn = document.querySelector('#remMd .btn-pp');
    if (btn) btn.textContent = via === 'whatsapp-web' ? '🌐 Open WhatsApp Web' : '💬 Open WhatsApp';
  }

  async function sendRem() {
    const f = fees.find(x => x.id === remId2);
    if (!f) return;

    const via = document.getElementById('rv').value;
    const previewEl = document.getElementById('rprev');
    const msg = previewEl ? previewEl.innerText.trim() : '';

    let phone = (f.phone || '').replace(/\D/g, '');
    if (phone.length === 10) phone = '91' + phone;
    else if (phone.length === 11 && phone.startsWith('0')) phone = '91' + phone.slice(1);

    if (phone.length < 11) {
      toast('⚠️ No valid phone number for this student. Edit the record first.', 'r');
      return;
    }

    const encoded = encodeURIComponent(msg);
    const url = via === 'whatsapp-web'
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`
      : `https://wa.me/${phone}?text=${encoded}`;

    try {
      await window.api.openExternal(url);
      const n = `WhatsApp reminder sent on ${td()}`;
      f.notes = f.notes ? f.notes + ' | ' + n : n;
      try { await window.api.updateFee(f.studentId, { notes: f.notes }); } catch (e) { }
      rt();
      closeRem();
      toast(`✅ WhatsApp opened for ${f.name} — press Send in WhatsApp!`, 'g');
    } catch (e) {
      toast('❌ Could not open WhatsApp. Make sure it is installed.', 'r');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIRM DIALOG
  // ─────────────────────────────────────────────────────────────────────────────
  function showCf(title, msg, cb) {
    document.getElementById('cft').textContent = title;
    document.getElementById('cfm').innerHTML = msg;
    document.getElementById('cfMd').classList.add('on');
    cfCb = cb;
    document.getElementById('cfok').onclick = () => { closeCf(); cfCb && cfCb(); };
  }
  function closeCf() {
    document.getElementById('cfMd').classList.remove('on');
    cfCb = null;
    if (window._feeChangeResolve) {
      window._feeChangeResolve(false);
      window._feeChangeResolve = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────────────────────────────────────────
  function toast(msg, type = 'g') {
    const c = document.getElementById('tw'), t = document.createElement('div');
    if (!c) return;
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${{ g: '✅', r: '❌', b: 'ℹ️', w: '⚠️' }[type] || '✅'}</span>${msg}`;
    c.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'all .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateX(18px)';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEYBOARD HANDLER
  // ─────────────────────────────────────────────────────────────────────────────
  function _feesKeyHandler(e) {
    if (e.key === 'Escape') {
      const open = [...document.querySelectorAll('.ov.on')];
      if (open.length) {
        const last = open[open.length - 1];
        if (last.id === 'addMd') closeAdd();
        else if (last.id === 'detMd') closeDet();
        else if (last.id === 'remMd') closeRem();
        else if (last.id === 'cfMd') closeCf();
        else if (last.id === 'histMd') closeHist();
        else last.classList.remove('on');
      }
    }

    if (e.key === 'Enter') {
      if (document.activeElement.tagName === 'TEXTAREA') return;
      const open = [...document.querySelectorAll('.ov.on')];
      if (open.length) {
        const last = open[open.length - 1];
        if (last.id === 'addMd') { e.preventDefault(); saveRec(); }
        else if (last.id === 'detMd') { e.preventDefault(); addPay(); }
        else if (last.id === 'remMd') { e.preventDefault(); sendRem(); }
        else if (last.id === 'cfMd') { const btn = document.getElementById('cfok'); if (btn) { e.preventDefault(); btn.click(); } }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODAL BACKDROP CLICK TO CLOSE
  // ─────────────────────────────────────────────────────────────────────────────
  // ESC-only close - backdrop click disabled
  // ['addMd', 'detMd', 'remMd', 'cfMd', 'histMd'].forEach(id => {
  //   document.getElementById(id)?.addEventListener('click', function (e) {
  //     if (e.target !== this) return;
  //     if (id === 'addMd') closeAdd();
  //     else if (id === 'detMd') closeDet();
  //     else if (id === 'remMd') closeRem();
  //     else if (id === 'cfMd') closeCf();
  //     else if (id === 'histMd') closeHist();
  //     else this.classList.remove('on');
  //   });
  // });

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  Object.assign(window.feesObj, {
    setSF, sf, srt, onSrch, clrSrch, clrAll, cfe, goPage,
    openEd, closeAdd, saveRec,
    openDetPay, closeDet, addPay, delPay, delFromDet, delRec,
    qRem, openRem, closeRem, updRem, sendRem,
    closeCf, rt, openHist, closeHist
  });

  document.addEventListener('keydown', _feesKeyHandler);

  window.destroyFees = function () {
    document.removeEventListener('keydown', _feesKeyHandler);
  };

  load();
};