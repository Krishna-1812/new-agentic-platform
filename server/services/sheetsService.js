const { google } = require('googleapis');

// ── Client name normalization ─────────────────────────────────────────────────
const CLIENT_NORM = {
  '42 ND': '42ND', '42ND': '42ND', '42 North Dental': '42ND', '42 north': '42ND',
  'RI': 'Riccobene', 'Riccobene': 'Riccobene',
  'YBH': 'YBH',
  'GD': 'Gentle Dental', 'Gentle Dental': 'Gentle Dental',
  'DF': 'Datafoundry', 'Datafoundry': 'Datafoundry',
  'GL': 'Great Lakes', 'Great Lakes': 'Great Lakes',
};

const VALID_STATUSES = ['Backlog', 'This Week', 'Today', 'In Progress', 'In Review', 'Blocked', 'Deferred', 'Done'];

const SHEET_TABS = {
  taskBoard:         '📋 Task Board',
  archive:           '🗃️ Archive',
  recurringSchedule: '🔁 Recurring Schedule',
  weeklyPlanner:     '📅 Weekly Planner',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheTs = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeClient(raw) {
  if (!raw) return '';
  const t = raw.trim();
  return CLIENT_NORM[t] || t;
}

function normalizeEffort(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).replace(/~/g, '').trim();
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function normalizeStatus(raw) {
  if (!raw) return '';
  const t = raw.trim();
  const match = VALID_STATUSES.find(s => s.toLowerCase() === t.toLowerCase());
  return match || t;
}

function normalizeDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Excel serial number fallback
  const num = Number(raw);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    return new Date((num - 25569) * 86400 * 1000);
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function colIdx(headers, ...patterns) {
  for (const pat of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(pat.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Find the first row where any individual cell exactly matches one of the markers (case-insensitive).
// Exact-cell matching avoids false positives like "All Clients" matching "client"
// or "Populate during Monday planning session" matching "monday".
function findHeaderRowIndex(rows, ...markers) {
  const lower = markers.map(m => m.toLowerCase());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    for (const cell of row) {
      if (lower.includes(String(cell || '').trim().toLowerCase())) return i;
    }
  }
  return 0;
}

// ── Task Board / Archive parser ───────────────────────────────────────────────

function parseTaskBoard(rows, archiveMode = false) {
  if (!rows || rows.length < 2) return { tasks: [], issues: [] };

  const headerIdx = findHeaderRowIndex(rows, 'task id', 'work type', 'task name');
  const headers = (rows[headerIdx] || []).map(h => String(h || ''));
  const dataRows = rows.slice(headerIdx + 1);

  const C = {
    id:          colIdx(headers, 'task id', 'id'),
    workType:    colIdx(headers, 'work type', 'type'),
    name:        colIdx(headers, 'task name', 'name'),
    client:      colIdx(headers, 'client'),
    assignedTo:  colIdx(headers, 'assigned to', 'assignee'),
    priority:    colIdx(headers, 'priority'),
    effortHours: colIdx(headers, 'effort', 'hours'),
    status:      colIdx(headers, 'status'),
    dueDate:     colIdx(headers, 'due date', 'due'),
    week:        colIdx(headers, 'week'),
    // "Notes/Docs" combined col or separate Notes + Docs
    notes:       colIdx(headers, 'notes'),
    docs:        colIdx(headers, 'docs', 'doc link', 'documentation'),
  };

  // If Notes/Docs is combined into one column, both will resolve to the same index — that's fine
  const tasks = [];
  const issues = [];
  const seenIds = new Map();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  dataRows.forEach((row, i) => {
    if (!row || row.every(c => !c)) return;

    const get = idx => idx === -1 ? '' : String(row[idx] || '').trim();
    const rowNum = headerIdx + i + 2; // 1-based sheet row number
    const rawId = get(C.id);
    const rawStatus = get(C.status);
    const rawEffort = get(C.effortHours);

    if (!rawStatus && !archiveMode) {
      issues.push({ type: 'blank_status', row: rowNum, taskId: rawId || `row ${rowNum}` });
    }

    let effortHours = null;
    const effortStripped = String(rawEffort).replace(/~/g, '').trim();
    if (effortStripped !== '') {
      effortHours = normalizeEffort(rawEffort);
      if (effortHours === null && !archiveMode) {
        issues.push({ type: 'unparseable_effort', row: rowNum, taskId: rawId, value: rawEffort });
      }
    }

    // Deduplication
    let taskId = rawId;
    if (rawId) {
      if (seenIds.has(rawId)) {
        const count = seenIds.get(rawId);
        seenIds.set(rawId, count + 1);
        taskId = `${rawId}-${String.fromCharCode(97 + count)}`;
        if (!archiveMode) issues.push({ type: 'duplicate_id', row: rowNum, taskId: rawId });
      } else {
        seenIds.set(rawId, 0);
      }
    }

    const dueDate = normalizeDate(get(C.dueDate));
    const status = normalizeStatus(rawStatus);
    const isOverdue = !!(dueDate && status !== 'Done' && dueDate < today);
    const daysOverdue = isOverdue ? Math.floor((today - dueDate) / 86400000) : null;

    // Notes and Docs: if same column index, split on newline or use full value for notes
    const rawNotesDocs = get(C.notes);
    let notes = rawNotesDocs;
    let docs = C.docs !== C.notes ? get(C.docs) : '';

    tasks.push({
      id: taskId || `row-${rowNum}`,
      workType: get(C.workType) || 'Adhoc',
      name: get(C.name),
      client: normalizeClient(get(C.client)),
      assignedTo: get(C.assignedTo),
      priority: get(C.priority),
      effortHours,
      status,
      dueDate: dueDate ? dueDate.toISOString() : null,
      week: get(C.week),
      notes,
      docs,
      isOverdue,
      daysOverdue,
      daysInCurrentStatus: null, // TODO: implement when Date Entered Status column is added
    });
  });

  return { tasks, issues };
}

// ── Recurring Schedule parser (pivot format) ──────────────────────────────────
// Each row = one client; columns 2+ are task types with frequency values

function parseRecurringSchedule(rows) {
  if (!rows || rows.length < 2) return [];

  const headerIdx = findHeaderRowIndex(rows, 'account owner', 'client');
  const headers = (rows[headerIdx] || []).map(h => String(h || '').trim());
  const dataRows = rows.slice(headerIdx + 1);

  // First col = Client, second = Account Owner, rest = task type columns
  const clientCol = 0;
  const ownerCol  = 1;
  const notesCol  = headers.findIndex(h => h.toLowerCase() === 'notes');
  const taskTypeCols = headers
    .map((h, i) => ({ i, h }))
    .filter(({ i, h }) => i >= 2 && h && h.toLowerCase() !== 'notes');

  const entries = [];

  dataRows.forEach(row => {
    if (!row || !row[clientCol]) return;
    const client = normalizeClient(String(row[clientCol] || '').trim());
    const owner  = String(row[ownerCol] || '').trim();
    if (!client) return;

    taskTypeCols.forEach(({ i, h }) => {
      const freq = String(row[i] || '').trim();
      if (!freq || freq.toLowerCase() === 'n/a') return;
      entries.push({
        person:      owner,
        client,
        taskName:    h,
        frequency:   freq,
        effortHours: null, // Recurring schedule doesn't have effort hours
      });
    });
  });

  return entries;
}

// ── Weekly Planner parser ─────────────────────────────────────────────────────
// Rows per person, columns per day. Person name only appears in first row of their block.

function parseWeeklyPlanner(rows) {
  if (!rows || rows.length < 2) return [];

  const headerIdx = findHeaderRowIndex(rows, 'monday', 'team member');
  const headers = (rows[headerIdx] || []).map(h => String(h || '').trim());
  const dateRow  = rows[headerIdx + 1] || [];
  const dataRows = rows.slice(headerIdx + 2);

  // Map column index → day label (use date row values if header says Mon/Tue etc.)
  const dayHeaders = headers.slice(1).map((h, i) => {
    const dateCell = String(dateRow[i + 1] || '').trim();
    return dateCell || h;
  });

  const entries = [];
  let currentPerson = '';

  dataRows.forEach(row => {
    if (!row || row.every(c => !c)) return;
    const personCell = String(row[0] || '').trim();

    // If first cell contains a date-like value (e.g. "w/c 01 Apr 2026"), skip it
    if (personCell.toLowerCase().startsWith('w/c') || /^\d{1,2}\/\d{1,2}/.test(personCell)) return;

    if (personCell) currentPerson = personCell;
    if (!currentPerson) return;

    row.slice(1).forEach((cell, i) => {
      const val = String(cell || '').trim();
      if (!val) return;
      entries.push({
        person:      currentPerson,
        day:         dayHeaders[i] || `Col${i + 2}`,
        taskName:    val,
        client:      null,
        effortHours: null,
      });
    });
  });

  return entries;
}

// ── Auth builder ──────────────────────────────────────────────────────────────

function buildAuth() {
  const saJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey   = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  let credentials;
  if (saJson) {
    try { credentials = JSON.parse(saJson); } catch {
      credentials = JSON.parse(Buffer.from(saJson, 'base64').toString());
    }
  } else if (saEmail && saKey) {
    credentials = {
      client_email: saEmail,
      private_key:  saKey.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
    };
  } else {
    throw new Error(
      'Google Sheets credentials not configured. ' +
      'Set GOOGLE_SERVICE_ACCOUNT_JSON or (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) in .env'
    );
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

// ── Main fetch ────────────────────────────────────────────────────────────────

async function fetchAllSheetData(forceRefresh = false) {
  if (!forceRefresh && _cache && _cacheTs && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
    return { ..._cache, fromCache: true };
  }

  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEETS_ID not configured in .env');

  const auth   = buildAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const fetches = await Promise.allSettled(
    Object.entries(SHEET_TABS).map(([key, tabName]) =>
      sheets.spreadsheets.values
        .get({ spreadsheetId: sheetId, range: tabName })
        .then(r => ({ key, rows: r.data.values || [] }))
    )
  );

  const raw = {};
  for (const f of fetches) {
    if (f.status === 'fulfilled') raw[f.value.key] = f.value.rows;
    else console.warn('[sheetsService] tab fetch error:', f.reason?.message);
  }

  const { tasks, issues }         = parseTaskBoard(raw.taskBoard || []);
  const { tasks: archiveTasks }   = parseTaskBoard(raw.archive || [], true);
  const recurringSchedule         = parseRecurringSchedule(raw.recurringSchedule || []);
  const weeklyPlanner             = parseWeeklyPlanner(raw.weeklyPlanner || []);

  const result = {
    tasks,
    archiveTasks,
    recurringSchedule,
    weeklyPlanner,
    dataQualityIssues: issues,
    lastSynced: new Date().toISOString(),
    config: {
      workWeekHours:       Number(process.env.WORK_WEEK_HOURS)       || 35,
      wipLimit:            Number(process.env.WIP_LIMIT)            || 3,
      staleBacklogWeeks:   Number(process.env.STALE_BACKLOG_WEEKS)   || 4,
      deferredWarningDays: Number(process.env.DEFERRED_WARNING_DAYS) || 21,
      overCapacityHours:   Number(process.env.OVER_CAPACITY_HOURS)   || 30,
    },
  };

  _cache   = result;
  _cacheTs = Date.now();
  return result;
}

function clearCache()    { _cache = null; _cacheTs = null; }
function getCachedData() { return _cache; }

module.exports = { fetchAllSheetData, clearCache, getCachedData };
