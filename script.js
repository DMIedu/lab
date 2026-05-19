/* ============================================================
   COMPUTER LAB BOOKING SYSTEM — SCRIPT
   ============================================================ */

/* ─── CONFIG ────────────────────────────────────────────────── */

// ▼ STEP 1: Deployed Apps Script Web App URL
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyD487lZpqR6QFx2LVeyoFt_CIWc5PwffCAG4akPPq8yStDzO1IuOS_uBShVgm5Qfc/exec';

// ▼ STEP 2: Google Sheet ID (DMI Student Register - Google Sheets version)
const GOOGLE_SHEET_ID = '1uniA9VlGp_8UDtxMZBe9mpjLRIdrWtBTGMa3O1zM8lo';

// Matches the 8 time slots in the Excel sheet exactly
const TIME_SLOTS = [
  '8:00 – 9:30',
  '9:30 – 11:00',
  '11:00 – 12:30',
  '12:30 – 1:30',
  '1:30 – 2:30',
  '2:30 – 3:30',
  '3:30 – 4:30',
  '4:30 – 5:30'
];

/* Branch → PC count
   Jaffna 25, Chavakachcheri 10, Chunnakam 8,
   Nelliady 12, Sandilipay 8, Kilinochchi 10 */
const BRANCH_PC_COUNT = {
  jaffna:         25,
  chavakachcheri: 10,
  chunnakam:       8,
  nelliady:       12,
  sandilipay:      8,
  kilinochchi:    10,
};

/* ─── JAFFNA LAB GROUPING ─────────────────────────────────────
   PC 01–06 → Lab A
   PC 07–17 → Lab B
   PC 18–25 → Lab A
   Only applied when the current branch is "jaffna". */
function getJaffnaLabForPC(pcIdx /* 0-based */) {
  const pcNo = pcIdx + 1;
  if (pcNo >= 1 && pcNo <= 6)   return 'A';
  if (pcNo >= 7 && pcNo <= 17)  return 'B';
  if (pcNo >= 18 && pcNo <= 25) return 'A';
  return '';
}

/* ─── SLOT TIME HELPERS ───────────────────────────────────────
   Used to auto-mark a booking as "absent" once a slot's full 60 min
   (slot start → slot end) has elapsed without a check-in, AND to render
   per-slot header stats (booked count / present %). */
function parseSlotTimes(slotText) {
  // slotText looks like "8:00 – 9:30" or "12:30 – 1:30"
  // Convert each side to a 24h minutes-from-midnight number.
  if (!slotText) return null;
  const parts = String(slotText).split('–').map(s => s.trim());
  if (parts.length !== 2) return null;

  function to24hMin(t, isPM_Hint) {
    const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    // Schedule runs 8:00 AM → 5:30 PM. Anything 1..7 is PM.
    if (h >= 1 && h <= 7) h += 12;
    return h * 60 + mm;
  }
  const startMin = to24hMin(parts[0]);
  const endMin   = to24hMin(parts[1]);
  if (startMin == null || endMin == null) return null;
  return { startMin, endMin };
}

/* Convert a minutes-from-midnight number into a Date object pinned to
   the date currently showing in the date picker (so the "absent" check
   only uses the wall-clock for today — past days are always final). */
function minutesToDateForPickedDay(minutes) {
  const dateStr = document.getElementById('datePicker')?.value;
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  d.setMinutes(minutes);
  return d;
}

/* Return the state a cell should render in, based on its booking
   (or absence of one) and the current wall-clock time.
   States: 'available' | 'booked' | 'present' | 'absent' | 'blocked' */
function computeSlotState(booking, slotText) {
  if (booking && booking.isBlocked) return 'blocked';
  if (!booking) return 'available';
  if (booking.status === 'present') return 'present';

  // Booked but not yet attended → may auto-flip to absent
  const t = parseSlotTimes(slotText);
  if (!t) return 'booked';
  const slotEnd = minutesToDateForPickedDay(t.endMin);
  if (!slotEnd) return 'booked';
  const now = new Date();
  // Only treat as absent for the picked day if the slot's full 60 min has passed.
  // (For past dates, slotEnd < now is always true, so it flips to absent — correct.)
  if (now.getTime() >= slotEnd.getTime()) return 'absent';
  return 'booked';
}

function getPCs(branch) {
  const count = BRANCH_PC_COUNT[branch] || 15;
  return Array.from({ length: count }, (_, i) => `PC${String(i + 1).padStart(2, '0')}`);
}

// Keep a top-level PCS for any legacy references (will be overridden in renderGrid)
let PCS = getPCs('jaffna');

/* ─── STUDENT DATABASE ──────────────────────────────────────── */
// This is the fallback list used when offline or before sheet loads.
// Once connected, students are loaded live from the Google Sheet.
let STUDENTS = {
  'BC001': { name: 'Aisha Patel',       course: 'Software Engineering',  subModule: 'Web Development',        feeStatus: 'Paid',    balance: 0 },
  'BC002': { name: 'Rahul Sharma',      course: 'Data Science',          subModule: 'Machine Learning Basics', feeStatus: 'Pending', balance: 1500 },
  'BC003': { name: 'Priya Nair',        course: 'Cybersecurity',         subModule: 'Network Security',        feeStatus: 'Overdue', balance: 3200 },
  'BC004': { name: 'Daniel Lim',        course: 'Computer Networks',     subModule: 'Routing & Switching',     feeStatus: 'Paid',    balance: 0 },
  'BC005': { name: 'Kavitha Menon',     course: 'Database Systems',      subModule: 'SQL Advanced',            feeStatus: 'Pending', balance: 800 },
  'BC006': { name: 'Jason Wong',        course: 'Cloud Computing',       subModule: 'AWS Fundamentals',        feeStatus: 'Paid',    balance: 0 },
  'BC007': { name: 'Siti Aminah',       course: 'IT Management',         subModule: 'Project Planning',        feeStatus: 'Paid',    balance: 0 },
  'BC008': { name: 'Mohammed Ali',      course: 'Software Engineering',  subModule: 'Mobile App Development',  feeStatus: 'Overdue', balance: 2750 },
  'BC009': { name: 'Lena Huang',        course: 'Artificial Intelligence', subModule: 'Neural Networks',       feeStatus: 'Paid',    balance: 0 },
  'BC010': { name: 'Arjun Krishnan',    course: 'Computer Science',      subModule: 'Data Structures',         feeStatus: 'Pending', balance: 600 },
  // Quick scan aliases
  'S001': { name: 'Aisha Patel',        course: 'Software Engineering',  subModule: 'Web Development',        feeStatus: 'Paid',    balance: 0 },
  'S002': { name: 'Rahul Sharma',       course: 'Data Science',          subModule: 'Machine Learning Basics', feeStatus: 'Pending', balance: 1500 },
};

/* ─── BLOCKED SLOTS TEMPLATE ───────────────────────────────── */
// All blocking is now MANUAL and reversible (created by users via the
// "Block this slot?" dialog and stored in the Bookings Log).
// The legacy hard-coded "maintenance" blocks have been removed so the
// entire grid starts fully available, and any block a user creates can
// later be cleared by another click.
function getBlockedPattern(/* branch */) {
  return {};
}

/* ─── PERSISTENT STORAGE (offline cache only) ───────────────── */
/* IMPORTANT: Google Sheet is the source of truth.
   localStorage is kept only as a short offline fallback so the
   grid has something to show while loadBookingsFromSheet() runs. */
const STORAGE_KEY = 'labBookings_v2';   // bumped to invalidate old v1 cache

function saveBookingsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  } catch (e) {
    console.warn('Could not save bookings:', e);
  }
}

function loadBookingsFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      Object.assign(bookings, parsed);
    }
    // Nuke the legacy demo-seeded cache on upgrade so stale demo
    // bookings don't keep reappearing on machines that had v1.
    if (localStorage.getItem('labBookings_v1')) {
      localStorage.removeItem('labBookings_v1');
    }
  } catch (e) {
    console.warn('Could not load bookings:', e);
  }
}

/* ─── BOOKING STATE ─────────────────────────────────────────── */
// bookings[dateKey][branch][pcIndex][slotIndex] = { student, bookedAt }
const bookings = {};

function getDateKey(date, branch) {
  return `${date}_${branch}`;
}

function getBooking(date, branch, pcIdx, slotIdx) {
  const key = getDateKey(date, branch);
  return bookings[key]?.[pcIdx]?.[slotIdx] || null;
}

function setBooking(date, branch, pcIdx, slotIdx, studentData) {
  const key = getDateKey(date, branch);
  if (!bookings[key]) bookings[key] = {};
  if (!bookings[key][pcIdx]) bookings[key][pcIdx] = {};
  bookings[key][pcIdx][slotIdx] = studentData;
  saveBookingsToStorage();
}

function clearBookingEntry(date, branch, pcIdx, slotIdx) {
  const key = getDateKey(date, branch);
  if (bookings[key]?.[pcIdx]) delete bookings[key][pcIdx][slotIdx];
  saveBookingsToStorage();
}

/* ─── CURRENT STATE ─────────────────────────────────────────── */
let currentStudent = null;
let pendingCell    = null; // { pcIdx, slotIdx, pcLabel, slot }
let viewingCell    = null; // { pcIdx, slotIdx, pcLabel, slot, booking }
let attendingCell  = null; // { pcIdx, slotIdx, pcLabel, slot, booking }

/* ─── GLOBAL SAFETY NET ──────────────────────────────────────
   The Apps Script JSONP loader injects a <script> tag whose response
   gets evaluated as JS. If Apps Script is misconfigured (e.g. "Execute
   as: User accessing" or "Who has access: Only me"), it returns a
   login/error page instead of a callback wrapped JSON. The browser
   then throws an uncaught ReferenceError ("script is not defined", or
   "Unexpected token <") that can scare users in the console.
   This filter silences those specific errors so they don't pollute
   the console while still surfacing real bugs. */
window.addEventListener('error', function(ev) {
  const msg = String(ev.message || '');
  const looksLikeJsonpResponse =
    ev.filename === '' || /script\.google\.com|googleusercontent/i.test(ev.filename || '');
  const knownJsonpParseErrors = /script is not defined|Unexpected token|Unexpected identifier|<!DOCTYPE/i;
  if (looksLikeJsonpResponse && knownJsonpParseErrors.test(msg)) {
    // Swallow — this is a backend deployment problem, not a frontend bug
    ev.preventDefault();
    console.warn('⚠️ Apps Script returned non-JSONP response (check deployment access settings).');
    return true;
  }
}, true);

/* ─── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  try {
    // Set today's date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const datePicker = document.getElementById('datePicker');
    if (datePicker) datePicker.value = dateStr;

    // ── Read branch from URL param (set by home.html) ──────────
    const urlParams = new URLSearchParams(window.location.search);
    const urlBranch = urlParams.get('branch');
    const branchSel = document.getElementById('branchSelector');
    if (urlBranch && branchSel && branchSel.querySelector(`option[value="${urlBranch}"]`)) {
      branchSel.value = urlBranch;
    }

    // ── Offline cache first (instant paint), then authoritative refresh from sheet
    try { loadBookingsFromStorage(); } catch (e) { console.warn('storage load failed', e); }

    // ── PAINT GRID FIRST (synchronous) so users see the schedule
    //    immediately, regardless of whether the backend is reachable.
    try { renderGrid(); } catch (e) { console.error('renderGrid failed:', e); }

    // ── Then attempt to enrich with live data from Google Sheet (async).
    //    Errors here never block the UI — JSONP responses that fail to
    //    parse are caught by the global error handler above.
    try { loadStudentsFromSheet(); } catch (e) { console.warn('students load failed', e); }
    try {
      if (branchSel) loadBookingsFromSheet(dateStr, branchSel.value);
    } catch (e) { console.warn('bookings load failed', e); }

    // Barcode auto-focus
    try { focusBarcodeInput(); } catch (e) {}

    // Barcode Enter key
    const barcodeInput = document.getElementById('barcodeInput');
    if (barcodeInput) {
      barcodeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleBarcodeScan();
      });
    }

    // Date / branch change → re-fetch from sheet for the new scope, then render
    if (datePicker) {
      datePicker.addEventListener('change', () => {
        const d = datePicker.value;
        const b = branchSel ? branchSel.value : '';
        renderGrid();                  // immediate paint with whatever we have
        loadBookingsFromSheet(d, b);   // then authoritative refresh
      });
    }
    if (branchSel) {
      branchSel.addEventListener('change', () => {
        const d = datePicker ? datePicker.value : '';
        const b = branchSel.value;
        renderGrid();
        loadBookingsFromSheet(d, b);
      });
    }

    // Lightweight background refresh so Browser B sees Browser A's bookings
    // without requiring a manual page reload. 20 s is plenty for a booking UI.
    setInterval(() => {
      try {
        const d = datePicker ? datePicker.value : '';
        const b = branchSel ? branchSel.value : '';
        if (d && b) loadBookingsFromSheet(d, b);
      } catch (e) { /* ignore */ }
    }, 20000);

    // Minute-heartbeat: re-render so booked → absent auto-flips once a slot
    // finishes, and so the live "Attendance %" strip stays current even if
    // nobody clicks anything.
    setInterval(() => {
      try { renderGrid(); } catch (e) { /* ignore */ }
    }, 60000);
  } catch (err) {
    console.error('Init failed — attempting bare-bones grid render:', err);
    try { renderGrid(); } catch (e) { /* nothing more we can do */ }
  }
});

/* ─── SEED DEMO DATA ────────────────────────────────────────── */
function seedDemoBookings(date, branch) {
  const demos = [
    { pc: 0, slot: 0, barcode: 'BC001', present: true  },
    { pc: 2, slot: 1, barcode: 'BC003', present: false },
    { pc: 4, slot: 2, barcode: 'BC005', present: true  },
    { pc: 6, slot: 0, barcode: 'BC007', present: false },
    { pc: 8, slot: 4, barcode: 'BC009', present: false },
    { pc: 11,slot: 1, barcode: 'BC002', present: false },
    { pc: 15,slot: 2, barcode: 'BC004', present: true  },
    { pc: 17,slot: 3, barcode: 'BC006', present: false },
  ];
  demos.forEach(d => {
    const student = STUDENTS[d.barcode];
    if (student) {
      const bookedAt = new Date(Date.now() - Math.random() * 3600000).toLocaleTimeString();
      setBooking(date, branch, d.pc, d.slot, {
        ...student,
        barcode:   d.barcode,
        bookedAt,
        status:    d.present ? 'present' : 'booked',
        arrivedAt: d.present ? new Date(Date.now() - Math.random() * 1800000).toLocaleTimeString() : null,
      });
    }
  });
}

/* ─── GRID RENDER ───────────────────────────────────────────── */
function renderGrid() {
  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const staticBlocked = getBlockedPattern(branch); // legacy static blocks
  const isJaffna = String(branch).toLowerCase() === 'jaffna';

  // Update PCS dynamically based on selected branch
  PCS = getPCs(branch);

  // ── Pass 1: compute states so we can build the slot-stats header ──
  // states[pcIdx][slotIdx] = { state, booking } where state ∈ available|booked|present|absent|blocked
  const states = [];
  PCS.forEach((pcLabel, pcIdx) => {
    states[pcIdx] = [];
    TIME_SLOTS.forEach((slot, slotIdx) => {
      const serverBooking = getBooking(date, branch, pcIdx, slotIdx);
      // legacy hard-coded maintenance blocks stay as "blocked"
      const isLegacyBlocked = !serverBooking && !!staticBlocked[pcIdx]?.[slotIdx];
      const effective = isLegacyBlocked
        ? { isBlocked: true, status: 'blocked' }
        : serverBooking;
      const state = computeSlotState(effective, slot);
      states[pcIdx][slotIdx] = { state, booking: effective };
    });
  });

  // ── Head ──
  const thead = document.getElementById('gridHead');
  thead.innerHTML = '';

  // Row 1: time slot labels
  const headerRow = document.createElement('tr');
  const thPC = document.createElement('th');
  thPC.textContent = isJaffna ? 'Lab / Computer' : 'Computer';
  headerRow.appendChild(thPC);
  TIME_SLOTS.forEach(slot => {
    const th = document.createElement('th');
    th.className = 'slot-header';
    th.textContent = slot;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Row 2: per-slot stats (Booked count always, Present % once slot ends)
  const statsRow = document.createElement('tr');
  statsRow.className = 'slot-stats-row';
  const thStatsLabel = document.createElement('th');
  thStatsLabel.className = 'slot-stats-label';
  thStatsLabel.textContent = '📊 Slot totals';
  statsRow.appendChild(thStatsLabel);

  TIME_SLOTS.forEach((slot, slotIdx) => {
    let booked = 0, present = 0, absent = 0, blocked = 0;
    for (let p = 0; p < PCS.length; p++) {
      const s = states[p][slotIdx].state;
      if (s === 'booked')  booked++;
      if (s === 'present') present++;
      if (s === 'absent')  absent++;
      if (s === 'blocked') blocked++;
    }
    const totalBooked = booked + present + absent; // slots that had a student assigned
    const slotEndedPercent = totalBooked > 0 ? Math.round((present / totalBooked) * 100) : 0;
    const slotEnded = slotHasEnded(slot);

    const th = document.createElement('th');
    th.className = 'slot-stats-cell';
    th.innerHTML = `
      <div class="stat-booked">📖 ${totalBooked} booked</div>
      ${slotEnded && totalBooked > 0
        ? `<div class="stat-present">✅ ${slotEndedPercent}% present</div>`
        : (slotEnded
            ? `<div class="stat-present muted">— no bookings —</div>`
            : `<div class="stat-present muted">live</div>`)
      }
    `;
    statsRow.appendChild(th);
  });
  thead.appendChild(statsRow);

  // ── Body ──
  const tbody = document.getElementById('gridBody');
  tbody.innerHTML = '';

  // Track Jaffna lab section headers so they're only rendered once per group.
  let lastLabBand = null;

  PCS.forEach((pcLabel, pcIdx) => {
    // Jaffna lab divider row — shown above the first PC of each Lab group
    if (isJaffna) {
      const labBand = getJaffnaLabForPC(pcIdx);
      if (labBand !== lastLabBand) {
        const divider = document.createElement('tr');
        divider.className = 'lab-divider lab-' + labBand.toLowerCase();
        const labCells = pcsInLabBand(pcIdx);
        const divTd = document.createElement('td');
        divTd.className = 'lab-divider-cell';
        divTd.colSpan = TIME_SLOTS.length + 1;
        divTd.innerHTML = `
          <span class="lab-chip lab-chip-${labBand.toLowerCase()}">Lab ${labBand}</span>
          <span class="lab-range">PC ${String(labCells.start).padStart(2,'0')} – PC ${String(labCells.end).padStart(2,'0')}</span>
        `;
        divider.appendChild(divTd);
        tbody.appendChild(divider);
        lastLabBand = labBand;
      }
    }

    const tr = document.createElement('tr');
    if (isJaffna) tr.classList.add('lab-row-' + getJaffnaLabForPC(pcIdx).toLowerCase());

    // PC label cell (with Lab A/B chip when Jaffna)
    const tdPC = document.createElement('td');
    if (isJaffna) {
      const band = getJaffnaLabForPC(pcIdx);
      tdPC.innerHTML = `<span class="pc-lab-chip pc-lab-chip-${band.toLowerCase()}">${band}</span> ${pcLabel}`;
    } else {
      tdPC.textContent = pcLabel;
    }
    tr.appendChild(tdPC);

    // Slot cells
    TIME_SLOTS.forEach((slot, slotIdx) => {
      const td = document.createElement('td');
      const cell = document.createElement('div');
      cell.classList.add('cell');

      const { state, booking } = states[pcIdx][slotIdx];
      cell.classList.add(state);

      if (state === 'blocked') {
        // Every block is now user-created (manual) and therefore unblockable.
        cell.innerHTML = `<span class="cell-label">🚫 Blocked</span>`;
        cell.addEventListener('click', () => {
          openBlockManageModal(pcIdx, slotIdx, pcLabel, slot, booking || { blockedAt: '' });
        });
      } else if (state === 'available') {
        cell.textContent = '+ Available';
        cell.addEventListener('click', () => {
          // If no student is scanned, offer to Block the slot instead.
          if (!currentStudent) {
            openBlockPromptModal(pcIdx, slotIdx, pcLabel, slot);
            return;
          }
          openBookingModal(pcIdx, slotIdx, pcLabel, slot);
        });
      } else {
        // booked | present | absent — all show student info
        const firstName  = (booking.name || '').split(' ')[0];
        const subModule  = escapeHtml(booking.subModule || '');
        let label = '✓ Booked';
        if (state === 'present') label = '✅ Present';
        if (state === 'absent')  label = '⛔ Absent';
        const subLine = subModule
          ? `<span class="cell-sub" title="${subModule}">${subModule}</span>`
          : '';
        cell.innerHTML =
          `${label}<br><span class="cell-name">${escapeHtml(firstName)}</span>${subLine}`;
        cell.addEventListener('click', () => openViewModal(pcIdx, slotIdx, pcLabel, slot, booking));
      }

      td.appendChild(cell);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  // ── Daily summary strip ──
  renderDailySummary(states);
}

/* Return the PC index range of a Jaffna lab band, given any PC inside it. */
function pcsInLabBand(pcIdx) {
  const band = getJaffnaLabForPC(pcIdx);
  const pcNo = pcIdx + 1;
  if (band === 'A' && pcNo <= 6)  return { start: 1,  end: 6 };
  if (band === 'A' && pcNo >= 18) return { start: 18, end: 25 };
  if (band === 'B')               return { start: 7,  end: 17 };
  return { start: pcNo, end: pcNo };
}

/* True once the slot's full 60-minute window (slot START → slot END)
   has elapsed on the currently-picked day. */
function slotHasEnded(slotText) {
  const t = parseSlotTimes(slotText);
  if (!t) return false;
  const end = minutesToDateForPickedDay(t.endMin);
  if (!end) return false;
  return Date.now() >= end.getTime();
}

/* Live rolling daily summary — total bookings today, present %, absent %.
   Updates every render (and there is a 20s re-render interval already). */
function renderDailySummary(states) {
  let booked = 0, present = 0, absent = 0, blocked = 0;
  for (let p = 0; p < states.length; p++) {
    for (let s = 0; s < TIME_SLOTS.length; s++) {
      const st = states[p][s].state;
      if (st === 'booked')  booked++;
      if (st === 'present') present++;
      if (st === 'absent')  absent++;
      if (st === 'blocked') blocked++;
    }
  }
  const totalCapacity   = states.length * TIME_SLOTS.length;
  const totalAssigned   = booked + present + absent; // slots that had a student assigned
  const utilizationPct  = totalCapacity > 0 ? Math.round(((totalAssigned + blocked) / totalCapacity) * 100) : 0;
  const attendancePct   = totalAssigned > 0 ? Math.round((present / totalAssigned) * 100) : 0;

  let strip = document.getElementById('dailySummaryStrip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'dailySummaryStrip';
    strip.className = 'daily-summary-strip';
    const gridSection = document.querySelector('.grid-section');
    if (gridSection && gridSection.parentNode) {
      gridSection.parentNode.insertBefore(strip, gridSection.nextSibling);
    }
  }
  strip.innerHTML = `
    <div class="sum-item sum-booked">
      <span class="sum-label">📖 Booked</span>
      <span class="sum-value">${totalAssigned}</span>
    </div>
    <div class="sum-item sum-present">
      <span class="sum-label">✅ Present</span>
      <span class="sum-value">${present}</span>
    </div>
    <div class="sum-item sum-absent">
      <span class="sum-label">⛔ Absent</span>
      <span class="sum-value">${absent}</span>
    </div>
    <div class="sum-item sum-blocked">
      <span class="sum-label">🚫 Blocked</span>
      <span class="sum-value">${blocked}</span>
    </div>
    <div class="sum-sep"></div>
    <div class="sum-item sum-pct-attendance">
      <span class="sum-label">Attendance %</span>
      <span class="sum-value big">${attendancePct}%</span>
    </div>
    <div class="sum-item sum-pct-util">
      <span class="sum-label">Utilization %</span>
      <span class="sum-value big">${utilizationPct}%</span>
    </div>
  `;
}

/* ─── FIND STUDENT BOOKINGS ─────────────────────────────────── */
function findStudentBookings(barcode, date, branch) {
  const results = [];
  const key = getDateKey(date, branch);
  if (!bookings[key]) return results;
  for (let pcIdx = 0; pcIdx < PCS.length; pcIdx++) {
    if (!bookings[key][pcIdx]) continue;
    for (let slotIdx = 0; slotIdx < TIME_SLOTS.length; slotIdx++) {
      const b = bookings[key][pcIdx][slotIdx];
      if (b && b.barcode === barcode) {
        results.push({ pcIdx, slotIdx, pcLabel: PCS[pcIdx], slot: TIME_SLOTS[slotIdx], booking: b });
      }
    }
  }
  return results;
}

/* ─── BARCODE SCAN ──────────────────────────────────────────── */
function handleBarcodeScan() {
  const input = document.getElementById('barcodeInput');
  const barcode = input.value.trim().toUpperCase();

  if (!barcode) {
    showToast('Please enter a barcode or student ID.', 'error');
    return;
  }

  showLoading(true);

  setTimeout(() => {
    showLoading(false);
    const student = STUDENTS[barcode];

    if (student) {
      const date   = document.getElementById('datePicker').value;
      const branch = document.getElementById('branchSelector').value;

      // ── Branch lock: student can only book in their home branch
      if (student.branch && String(student.branch).toLowerCase() !== String(branch).toLowerCase()) {
        showToast(
          `⚠️ ${student.name} is registered at ${student.branch} — not ${branch}. ` +
          `Please open the ${student.branch} booking page.`,
          'error', 5000
        );
        input.value = '';
        focusBarcodeInput();
        return;
      }

      const matches = findStudentBookings(barcode, date, branch);

      // ── Student has a booking today ────────────────────────────
      if (matches.length > 0) {
        const unattended = matches.filter(m => m.booking.status !== 'present');
        if (unattended.length > 0) {
          // Open attendance modal for the first unattended booking
          input.value = '';
          openAttendanceModal(unattended[0]);
          return;
        } else {
          // All slots already marked present
          const slots = matches.map(m => m.slot).join(', ');
          showToast(`✅ ${student.name} already marked Present (${slots})`, 'info');
          input.value = '';
          focusBarcodeInput();
          return;
        }
      }

      // ── No booking — normal booking flow ───────────────────────
      currentStudent = { ...student, barcode };
      displayStudentCard(currentStudent);
      showToast(`Student found: ${student.name} — select a PC slot to book`, 'success');
      input.value = '';
    } else {
      showToast(`No student found for barcode: ${barcode}`, 'error');
      input.value = '';
    }
    focusBarcodeInput();
  }, 900);
}

/* ─── STUDENT CARD ──────────────────────────────────────────── */
function displayStudentCard(student) {
  document.getElementById('studentAvatar').textContent = student.name.charAt(0).toUpperCase();
  document.getElementById('studentName').textContent    = student.name;
  document.getElementById('studentCourse').textContent  = student.course;
  document.getElementById('studentSubModule').textContent = `📖 ${student.subModule}`;
  document.getElementById('balanceAmount').textContent  =
    student.balance > 0 ? `RM ${student.balance.toFixed(2)}` : 'RM 0.00';

  const badge = document.getElementById('feeBadge');
  badge.textContent = student.feeStatus;
  badge.className   = `fee-badge ${student.feeStatus.toLowerCase()}`;

  document.getElementById('studentCard').classList.remove('hidden');
}

function clearStudent() {
  currentStudent = null;
  document.getElementById('studentCard').classList.add('hidden');
  document.getElementById('barcodeInput').value = '';
  focusBarcodeInput();
  showToast('Student cleared.', 'info');
}

/* ─── COURSE / SUB-MODULE DATALISTS ─────────────────────────── */
/**
 * Populate <datalist id="coursesList"> and <datalist id="submodulesList">
 * with every distinct course and sub-module across STUDENTS in the
 * current branch. Called whenever the booking modal opens, so values
 * are always fresh if new students are loaded.
 */
function populateCourseDatalists() {
  const currentBranch = String(document.getElementById('branchSelector').value || '').toLowerCase();
  const courses = new Set();
  const subs    = new Set();
  Object.values(STUDENTS).forEach(s => {
    if (s.branch && String(s.branch).toLowerCase() !== currentBranch) return;
    if (s.course)    courses.add(String(s.course).trim());
    if (s.subModule) subs.add(String(s.subModule).trim());
  });

  function fill(datalistId, values) {
    const dl = document.getElementById(datalistId);
    if (!dl) return;
    dl.innerHTML = '';
    Array.from(values).sort().forEach(v => {
      if (!v) return;
      const opt = document.createElement('option');
      opt.value = v;
      dl.appendChild(opt);
    });
  }
  fill('coursesList',    courses);
  fill('submodulesList', subs);
}

/* ─── BOOKING MODAL ─────────────────────────────────────────── */
function openBookingModal(pcIdx, slotIdx, pcLabel, slot) {
  if (!currentStudent) {
    showToast('Please scan a student barcode first.', 'error');
    focusBarcodeInput();
    return;
  }

  const date   = document.getElementById('datePicker').value;
  pendingCell  = { pcIdx, slotIdx, pcLabel, slot };

  document.getElementById('modalPC').textContent      = pcLabel;
  document.getElementById('modalSlot').textContent    = slot;
  document.getElementById('modalDate').textContent    = formatDate(date);
  document.getElementById('modalStudentName').textContent   = currentStudent.name;

  // Course + Sub-Module are editable now. Seed with this student's values
  // and populate the datalists with every distinct course/submodule seen
  // in the current branch's student list, so the teacher can pick another.
  populateCourseDatalists();
  document.getElementById('modalStudentCourse').value = currentStudent.course || '';
  document.getElementById('modalStudentModule').value = currentStudent.subModule || '';

  const feeEl = document.getElementById('modalFeeStatus');
  feeEl.textContent = currentStudent.feeStatus;
  feeEl.className   = `fee-badge ${currentStudent.feeStatus.toLowerCase()}`;

  const warningEl = document.getElementById('modalFeeWarning');
  warningEl.classList.toggle('hidden', currentStudent.feeStatus === 'Paid');

  document.getElementById('bookingModal').classList.remove('hidden');
}

function closeBookingModal() {
  document.getElementById('bookingModal').classList.add('hidden');
  pendingCell = null;
  focusBarcodeInput();
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('bookingModal')) closeBookingModal();
}

async function confirmBooking() {
  if (!pendingCell || !currentStudent) return;

  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const { pcIdx, slotIdx, pcLabel, slot } = pendingCell;
  const bookedAt = new Date().toLocaleTimeString();

  // Read the (possibly edited) course + sub-module from the modal inputs.
  const chosenCourse    = (document.getElementById('modalStudentCourse').value || '').trim() || currentStudent.course;
  const chosenSubModule = (document.getElementById('modalStudentModule').value || '').trim() || currentStudent.subModule;

  const bookingData = {
    ...currentStudent,
    course:    chosenCourse,
    subModule: chosenSubModule,
    bookedAt,
    status: 'booked',
    arrivedAt: null,
  };

  // Optimistic local update so the UI feels instant
  setBooking(date, branch, pcIdx, slotIdx, bookingData);
  closeBookingModal();
  renderGrid();
  showToast(`✅ ${pcLabel} booked for ${currentStudent.name} at ${slot}`, 'success');

  // ── Write to Google Sheet, then re-fetch so the UI reflects the
  //    sheet's truth (handles race conditions with other browsers)
  const ack = await syncToGoogleSheet({
    action:      'book',
    sheetId:     GOOGLE_SHEET_ID,
    date,
    branch,
    pcIdx,
    slotIdx,
    pcLabel,
    slot,
    barcode:     currentStudent.barcode,
    studentName: currentStudent.name,
    course:      chosenCourse,
    subModule:   chosenSubModule,
    feeStatus:   currentStudent.feeStatus,
    balance:     currentStudent.balance,
    bookedAt
  });

  // Server may reject the booking (e.g. branch mismatch). Roll back.
  if (ack && ack.status === 'error') {
    clearBookingEntry(date, branch, pcIdx, slotIdx);
    renderGrid();
    showToast(`❌ ${ack.message || 'Booking refused by server'}`, 'error', 6000);
  }
  loadBookingsFromSheet(date, branch);
}

/* ─── VIEW / CANCEL MODAL ───────────────────────────────────── */
function openViewModal(pcIdx, slotIdx, pcLabel, slot, booking) {
  const date = document.getElementById('datePicker').value;
  viewingCell = { pcIdx, slotIdx, pcLabel, slot, booking };

  document.getElementById('viewPC').textContent      = pcLabel;
  document.getElementById('viewSlot').textContent    = slot;
  document.getElementById('viewDate').textContent    = formatDate(date);
  document.getElementById('viewStudentName').textContent   = booking.name;
  document.getElementById('viewStudentCourse').textContent = booking.course;
  document.getElementById('viewStudentModule').textContent = booking.subModule;
  document.getElementById('viewBookedAt').textContent = booking.bookedAt || '—';

  // ── Phone + WhatsApp button ────────────────────────────────
  const phoneRow = document.getElementById('viewPhoneRow');
  const phoneEl  = document.getElementById('viewPhone');
  const waBtn    = document.getElementById('viewWhatsAppBtn');
  let phone = (booking.phone || '').trim();
  if (!phone && booking.barcode && STUDENTS[booking.barcode]) {
    phone = (STUDENTS[booking.barcode].phone || '').trim();
  }
  if (phoneRow && phoneEl) {
    if (phone) {
      phoneRow.style.display = '';
      phoneEl.textContent = phone;
    } else {
      phoneRow.style.display = 'none';
      phoneEl.textContent = '—';
    }
  }
  if (waBtn) {
    if (phone) {
      const intl = toIntlPhone(phone);
      const statusWord = booking.status === 'present' ? 'recorded as PRESENT' : 'confirmed';
      const msg = encodeURIComponent(
        `Hi ${booking.name || 'there'}, this is DMI Computer Education.\n\n` +
        `Your computer lab booking is ${statusWord}:\n` +
        `• PC: ${pcLabel}\n` +
        `• Time: ${slot}\n` +
        `• Date: ${formatDate(date)}\n\n` +
        `See you at the lab!`
      );
      waBtn.href = `https://wa.me/${intl}?text=${msg}`;
      waBtn.style.display = '';
    } else {
      waBtn.style.display = 'none';
    }
  }

  // Arrived-at row — show only when present
  const arrivedRow = document.getElementById('viewArrivedAtRow');
  if (arrivedRow) {
    arrivedRow.style.display = booking.arrivedAt ? '' : 'none';
    document.getElementById('viewArrivedAt').textContent = booking.arrivedAt || '—';
  }

  // "Mark Present" button — hide when already present
  const markBtn = document.getElementById('viewMarkPresentBtn');
  if (markBtn) markBtn.style.display = booking.status === 'present' ? 'none' : '';

  // Modal icon reflects status
  const modalIcon = document.querySelector('#viewModalBox .modal-icon');
  if (modalIcon) modalIcon.textContent = booking.status === 'present' ? '✅' : '🟢';

  const feeEl = document.getElementById('viewFeeStatus');
  feeEl.textContent = booking.feeStatus;
  feeEl.className   = `fee-badge ${booking.feeStatus.toLowerCase()}`;

  document.getElementById('viewModal').classList.remove('hidden');
}

function closeViewModal() {
  document.getElementById('viewModal').classList.add('hidden');
  viewingCell = null;
  focusBarcodeInput();
}

function closeViewModalOnOverlay(e) {
  if (e.target === document.getElementById('viewModal')) closeViewModal();
}

function markPresentFromView() {
  if (!viewingCell) return;
  if (viewingCell.booking.status === 'present') {
    showToast('Already marked as Present.', 'info');
    return;
  }
  const match = { ...viewingCell };
  closeViewModal();
  openAttendanceModal(match);
}

/* ─── ATTENDANCE MODAL ───────────────────────────────────────── */
function openAttendanceModal(match) {
  attendingCell = match;
  const date = document.getElementById('datePicker').value;

  document.getElementById('attendStudentName').textContent   = match.booking.name;
  document.getElementById('attendStudentCourse').textContent = match.booking.course;
  document.getElementById('attendPC').textContent            = match.pcLabel;
  document.getElementById('attendSlot').textContent         = match.slot;
  document.getElementById('attendDate').textContent         = formatDate(date);
  document.getElementById('attendBookedAt').textContent     = match.booking.bookedAt || '—';

  document.getElementById('attendanceModal').classList.remove('hidden');
}

function closeAttendanceModal() {
  document.getElementById('attendanceModal').classList.add('hidden');
  attendingCell = null;
  focusBarcodeInput();
}

function closeAttendanceModalOnOverlay(e) {
  if (e.target === document.getElementById('attendanceModal')) closeAttendanceModal();
}

async function confirmAttendance() {
  if (!attendingCell) return;

  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const { pcIdx, slotIdx, pcLabel, slot, booking } = attendingCell;
  const arrivedAt = new Date().toLocaleTimeString();

  // Optimistic local update
  booking.status    = 'present';
  booking.arrivedAt = arrivedAt;
  saveBookingsToStorage();
  closeAttendanceModal();
  renderGrid();
  showToast(`✅ ${booking.name} marked Present at ${pcLabel} – ${slot}`, 'success');

  await syncToGoogleSheet({
    action:      'attend',
    sheetId:     GOOGLE_SHEET_ID,
    date,
    branch,
    pcIdx,
    slotIdx,
    pcLabel,
    slot,
    barcode:     booking.barcode   || '',
    studentName: booking.name      || '',
    course:      booking.course    || '',
    subModule:   booking.subModule || '',
    feeStatus:   booking.feeStatus || '',
    balance:     booking.balance   || 0,
    bookedAt:    booking.bookedAt  || '',
    arrivedAt,
  });
  loadBookingsFromSheet(date, branch);
}

async function cancelBooking() {
  if (!viewingCell) return;

  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const { pcIdx, slotIdx, pcLabel, slot, booking } = viewingCell;

  // Optimistic local update
  clearBookingEntry(date, branch, pcIdx, slotIdx);
  closeViewModal();
  renderGrid();
  showToast(`🗑 Booking cancelled: ${pcLabel} – ${booking.name} (${slot})`, 'info');

  await syncToGoogleSheet({
    action:      'cancel',
    sheetId:     GOOGLE_SHEET_ID,
    date,
    branch,
    pcIdx,
    slotIdx,
    pcLabel,
    slot,
    barcode:     booking.barcode   || '',
    studentName: booking.name      || '',
    course:      booking.course    || '',
    subModule:   booking.subModule || '',
    feeStatus:   booking.feeStatus || '',
    balance:     booking.balance   || 0,
    bookedAt:    booking.bookedAt  || '',
  });
  loadBookingsFromSheet(date, branch);
}

/* ─── MANUAL BLOCK / UNBLOCK ────────────────────────────────── */
/* Ask-first modal when clicking a free cell WITHOUT a scanned student. */
function openBlockPromptModal(pcIdx, slotIdx, pcLabel, slot) {
  pendingCell = { pcIdx, slotIdx, pcLabel, slot };
  const modal = document.getElementById('blockPromptModal');
  document.getElementById('blockPromptPC').textContent   = pcLabel;
  document.getElementById('blockPromptSlot').textContent = slot;
  document.getElementById('blockPromptDate').textContent = formatDate(document.getElementById('datePicker').value);
  modal.classList.remove('hidden');
}

function closeBlockPromptModal() {
  document.getElementById('blockPromptModal').classList.add('hidden');
  pendingCell = null;
  focusBarcodeInput();
}

function closeBlockPromptOnOverlay(e) {
  if (e.target === document.getElementById('blockPromptModal')) closeBlockPromptModal();
}

async function confirmBlock() {
  if (!pendingCell) return;
  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const { pcIdx, slotIdx, pcLabel, slot } = pendingCell;
  const blockedAt = new Date().toLocaleTimeString();

  // Optimistic local update so the cell flips to "Blocked" instantly
  setBooking(date, branch, pcIdx, slotIdx, {
    isBlocked: true,
    blockedAt,
    status: 'blocked',
    name: '',
  });
  closeBlockPromptModal();
  renderGrid();
  showToast(`🚫 ${pcLabel} blocked for ${slot}`, 'info');

  await syncToGoogleSheet({
    action:   'block',
    sheetId:  GOOGLE_SHEET_ID,
    date,
    branch,
    pcIdx,
    slotIdx,
    pcLabel,
    slot,
    bookedAt: blockedAt,
  });
  loadBookingsFromSheet(date, branch);
}

/* Clicking an already-blocked cell that has blockedAt metadata opens this. */
function openBlockManageModal(pcIdx, slotIdx, pcLabel, slot, booking) {
  viewingCell = { pcIdx, slotIdx, pcLabel, slot, booking };
  const modal = document.getElementById('blockManageModal');
  document.getElementById('blockMgrPC').textContent      = pcLabel;
  document.getElementById('blockMgrSlot').textContent    = slot;
  document.getElementById('blockMgrDate').textContent    = formatDate(document.getElementById('datePicker').value);
  document.getElementById('blockMgrBlockedAt').textContent = booking.blockedAt || '—';
  modal.classList.remove('hidden');
}

function closeBlockManageModal() {
  document.getElementById('blockManageModal').classList.add('hidden');
  viewingCell = null;
  focusBarcodeInput();
}

function closeBlockManageOnOverlay(e) {
  if (e.target === document.getElementById('blockManageModal')) closeBlockManageModal();
}

async function confirmUnblock() {
  if (!viewingCell) return;
  const date   = document.getElementById('datePicker').value;
  const branch = document.getElementById('branchSelector').value;
  const { pcIdx, slotIdx, pcLabel, slot } = viewingCell;

  clearBookingEntry(date, branch, pcIdx, slotIdx);
  closeBlockManageModal();
  renderGrid();
  showToast(`✅ ${pcLabel} unblocked for ${slot}`, 'success');

  await syncToGoogleSheet({
    action:  'unblock',
    sheetId: GOOGLE_SHEET_ID,
    date,
    branch,
    pcIdx,
    slotIdx,
    pcLabel,
    slot,
  });
  loadBookingsFromSheet(date, branch);
}

/* ─── HELPERS ───────────────────────────────────────────────── */
/* Convert a local Sri Lankan phone number to international (94…) digits. */
function toIntlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) {
    d = '94' + d.slice(1);
  } else if (d.length === 9 && !d.startsWith('94')) {
    d = '94' + d;
  } else if (d.startsWith('094')) {
    d = d.slice(1);
  }
  return d;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function focusBarcodeInput() {
  requestAnimationFrame(() => {
    document.getElementById('barcodeInput')?.focus();
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function showLoading(visible) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !visible);
}

/* ─── TOAST ─────────────────────────────────────────────────── */
const TOAST_ICONS = { success: '✅', error: '❌', info: 'ℹ️' };

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || 'ℹ️'}</span>
    <span class="toast-msg">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

/* ─── LOAD STUDENTS FROM GOOGLE SHEET ──────────────────────── */
/**
 * Fetches the Students List from the connected Google Sheet via JSONP.
 * Called on page load. Overwrites the built-in STUDENTS object.
 */
function loadStudentsFromSheet() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') return;

  const callbackName = 'labStudentsCB_' + Date.now();
  const script       = document.createElement('script');
  const params       = new URLSearchParams({
    data:     JSON.stringify({ action: 'getStudents' }),
    callback: callbackName,
  });

  // Timeout — if sheet doesn't respond in 8s, keep using built-in list
  const timeout = setTimeout(() => {
    cleanup();
    showToast('⚠️ Could not load students from sheet — using built-in list', 'info');
  }, 8000);

  function cleanup() {
    clearTimeout(timeout);
    delete window[callbackName];
    if (script.parentNode) script.parentNode.removeChild(script);
  }

  window[callbackName] = function(response) {
    cleanup();
    if (response.status === 'success' && response.count > 0) {
      STUDENTS = response.students;  // replace with live sheet data
      updateStudentCountBadge(response.count);
      showToast(`✅ ${response.count} students loaded from Google Sheet`, 'success');
      console.log('Students loaded from sheet:', response.count);
    } else if (response.status === 'error') {
      showToast(`⚠️ ${response.message}`, 'info');
    }
  };

  script.onerror = function() {
    cleanup();
    showToast('⚠️ Offline — using built-in student list', 'info');
  };

  script.src = `${APPS_SCRIPT_URL}?${params}`;
  document.head.appendChild(script);
}

function updateStudentCountBadge(count) {
  const badge = document.getElementById('studentCountBadge');
  if (badge) {
    badge.textContent = `👥 ${count} students`;
    badge.style.display = '';
  }
}

/* ─── LOAD BOOKINGS FROM GOOGLE SHEET ───────────────────────── */
/**
 * Fetches the current bookings for a given date + branch from the
 * Google Sheet via JSONP. Replaces the local `bookings` state for
 * that (date, branch) scope with what the sheet says is true, then
 * re-renders the grid.
 *
 * This is THE function that makes bookings sync across browsers.
 */
function loadBookingsFromSheet(date, branch, onDone) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    if (onDone) onDone();
    return;
  }
  if (!date || !branch) {
    if (onDone) onDone();
    return;
  }

  const callbackName = 'labBookingsCB_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  const script = document.createElement('script');
  const params = new URLSearchParams({
    data: JSON.stringify({ action: 'getBookings', date: date, branch: branch }),
    callback: callbackName,
    _: Date.now().toString(),  // cache-buster (defeats Apps Script / proxy caching)
  });

  const timeout = setTimeout(() => {
    cleanup();
    console.warn('loadBookingsFromSheet timeout', date, branch);
    if (onDone) onDone();
  }, 10000);

  function cleanup() {
    clearTimeout(timeout);
    delete window[callbackName];
    if (script.parentNode) script.parentNode.removeChild(script);
  }

  window[callbackName] = function(response) {
    cleanup();
    try {
      if (response && response.status === 'success') {
        const key = getDateKey(date, branch);
        bookings[key] = {};   // reset this scope only; other dates/branches are untouched

        const serverBookings = response.bookings || {};
        const pcList   = getPCs(branch);
        // Case-insensitive lookup by PC label, just in case capitalisation differs
        const pcIndex  = {};
        pcList.forEach((p, i) => { pcIndex[p.toLowerCase()] = i; });

        Object.keys(serverBookings).forEach(pcLabel => {
          const pIdx = pcIndex[String(pcLabel).toLowerCase()];
          if (pIdx === undefined) return;
          bookings[key][pIdx] = bookings[key][pIdx] || {};
          Object.keys(serverBookings[pcLabel]).forEach(slot => {
            const sIdx = TIME_SLOTS.indexOf(slot);
            if (sIdx === -1) return;
            bookings[key][pIdx][sIdx] = serverBookings[pcLabel][slot];
          });
        });

        saveBookingsToStorage(); // refresh offline cache

        // Only re-render if the user is still looking at this (date, branch)
        const curDate   = document.getElementById('datePicker').value;
        const curBranch = document.getElementById('branchSelector').value;
        if (curDate === date && curBranch === branch) {
          renderGrid();
        }

        console.log('Bookings loaded from sheet:', response.count, 'for', date, branch);
      } else if (response && response.status === 'error') {
        console.warn('getBookings error:', response.message);
      }
    } finally {
      if (onDone) onDone();
    }
  };

  script.onerror = function() {
    cleanup();
    console.warn('loadBookingsFromSheet network error', date, branch);
    if (onDone) onDone();
  };

  script.src = `${APPS_SCRIPT_URL}?${params.toString()}`;
  document.head.appendChild(script);
}

/* ─── GOOGLE SHEETS SYNC ────────────────────────────────────── */
/**
 * Sends a booking/cancel/attend action to the Apps Script Web App
 * via JSONP so we can (a) confirm the server accepted the write and
 * (b) trigger a fresh re-fetch of bookings for this date+branch, so
 * the UI is rebuilt from the sheet — never from local-only state.
 *
 * Returns a Promise that resolves when the server has acknowledged.
 */
function syncToGoogleSheet(payload) {
  return new Promise((resolve) => {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
      console.warn('Google Sheets sync not configured — skipping.');
      resolve({ status: 'skipped' });
      return;
    }

    const callbackName = 'labSyncCB_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    const params = new URLSearchParams({
      data: JSON.stringify(payload),
      callback: callbackName,
      _: Date.now().toString(),
    });

    const timeout = setTimeout(() => {
      cleanup();
      console.warn('syncToGoogleSheet timeout for', payload.action);
      resolve({ status: 'timeout' });
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function(response) {
      cleanup();
      console.log('Sheet sync ack:', payload.action, payload.pcLabel, payload.slot, response && response.status);
      resolve(response || { status: 'empty' });
    };

    script.onerror = function() {
      cleanup();
      console.warn('Sheet sync network error for', payload.action);
      resolve({ status: 'network_error' });
    };

    script.src = `${APPS_SCRIPT_URL}?${params.toString()}`;
    document.head.appendChild(script);
  });
}

/* ─── KEYBOARD SHORTCUTS ────────────────────────────────────── */
document.addEventListener('keydown', e => {
  // Escape closes modals
  if (e.key === 'Escape') {
    if (!document.getElementById('bookingModal').classList.contains('hidden'))    closeBookingModal();
    if (!document.getElementById('viewModal').classList.contains('hidden'))       closeViewModal();
    if (!document.getElementById('attendanceModal').classList.contains('hidden')) closeAttendanceModal();
    const bp = document.getElementById('blockPromptModal');
    if (bp && !bp.classList.contains('hidden')) closeBlockPromptModal();
    const bm = document.getElementById('blockManageModal');
    if (bm && !bm.classList.contains('hidden')) closeBlockManageModal();
  }
  // Ctrl/Cmd + K focuses barcode input
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    focusBarcodeInput();
  }
});

/* ─── NAME SEARCH ────────────────────────────────────────────── */
let nameDropActiveIdx = -1;

function handleNameSearch() {
  const input = document.getElementById('nameSearchInput');
  const query = input.value.trim().toLowerCase();
  const dropdown = document.getElementById('nameDropdown');
  nameDropActiveIdx = -1;

  if (query.length < 1) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  // Search STUDENTS by name (deduplicate by name)
  // Only show students from the currently-selected branch so a teacher
  // can't accidentally pick someone from another campus.
  const currentBranch = String(document.getElementById('branchSelector').value || '').toLowerCase();
  const seen = new Set();
  const results = [];
  for (const [id, s] of Object.entries(STUDENTS)) {
    if (s.branch && String(s.branch).toLowerCase() !== currentBranch) continue;
    const key = s.name.toLowerCase();
    if (key.includes(query) && !seen.has(key)) {
      seen.add(key);
      results.push({ id, ...s });
    }
  }

  if (results.length === 0) {
    dropdown.innerHTML = '<div class="name-drop-empty">No student found</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = results.slice(0, 8).map((s, i) => `
    <div class="name-drop-item" data-idx="${i}" data-id="${s.id}"
         onclick="selectNameResult('${s.id}')"
         onmouseenter="setNameActive(${i})">
      <div class="name-drop-avatar">${s.name.charAt(0).toUpperCase()}</div>
      <div class="name-drop-info">
        <div class="name-drop-name">${s.name}</div>
        <div class="name-drop-meta">${s.course} · ${s.subModule}</div>
      </div>
      <div class="name-drop-id">${s.id}</div>
    </div>
  `).join('');
  dropdown.classList.remove('hidden');
}

function setNameActive(idx) {
  nameDropActiveIdx = idx;
  document.querySelectorAll('.name-drop-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

function handleNameKey(e) {
  const items = document.querySelectorAll('.name-drop-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    nameDropActiveIdx = Math.min(nameDropActiveIdx + 1, items.length - 1);
    setNameActive(nameDropActiveIdx);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nameDropActiveIdx = Math.max(nameDropActiveIdx - 1, 0);
    setNameActive(nameDropActiveIdx);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (nameDropActiveIdx >= 0 && items[nameDropActiveIdx]) {
      const id = items[nameDropActiveIdx].dataset.id;
      selectNameResult(id);
    }
  } else if (e.key === 'Escape') {
    clearNameSearch();
  }
}

function selectNameResult(studentId) {
  const student = STUDENTS[studentId];
  if (!student) return;

  const branch = document.getElementById('branchSelector').value;
  // ── Branch lock: student can only book in their home branch
  if (student.branch && String(student.branch).toLowerCase() !== String(branch).toLowerCase()) {
    showToast(
      `⚠️ ${student.name} is registered at ${student.branch} — not ${branch}. ` +
      `Please open the ${student.branch} booking page.`,
      'error', 5000
    );
    clearNameSearch();
    return;
  }

  clearNameSearch();
  currentStudent = { ...student, barcode: studentId };
  displayStudentCard(currentStudent);
  showToast(`Student found: ${student.name} — select a PC slot to book`, 'success');
}

function clearNameSearch() {
  document.getElementById('nameSearchInput').value = '';
  const dropdown = document.getElementById('nameDropdown');
  dropdown.classList.add('hidden');
  dropdown.innerHTML = '';
  nameDropActiveIdx = -1;
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const group = document.querySelector('.name-search-group');
  if (group && !group.contains(e.target)) {
    const dropdown = document.getElementById('nameDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
});
