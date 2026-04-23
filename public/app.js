// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  lang:               'en',
  fileType:           'allTypes',   // 'images' | 'videos' | 'allTypes' | 'files' | 'music'
  copyMode:           'allFiles',   // 'allFiles' | 'dateRange'
  dateFrom:           null,         // 'YYYY-MM-DD' | null
  dateTo:             null,         // 'YYYY-MM-DD' | null
  sourcePath:         null,         // selected phone path
  destPath:           null,         // selected local path
  browserMode:        null,         // 'phone' | 'local'  (while modal is open)
  browserPath:        null,         // currently viewed path in browser modal
  browserWarningShown: false,
  homeDir:            null,         // local user home directory (fetched from API)
  ws:                 null,         // active WebSocket during transfer
};

const PHONE_DEFAULT_PATH = {
  images:   '/storage/emulated/0/DCIM',
  videos:   '/storage/emulated/0/DCIM',
  files:    '/storage/emulated/0/Download',
  music:    '/storage/emulated/0/Music',
  allTypes: '/storage/emulated/0/DCIM',
};

const PHONE_SHORTCUTS = {
  images:   ['/storage/emulated/0/DCIM', '/storage/emulated/0/Pictures'],
  videos:   ['/storage/emulated/0/DCIM', '/storage/emulated/0/Movies'],
  files:    ['/storage/emulated/0/Download', '/storage/emulated/0/Documents'],
  music:    ['/storage/emulated/0/Music'],
  allTypes: ['/storage/emulated/0/DCIM', '/storage/emulated/0/Download', '/storage/emulated/0/Music'],
};

// ─── i18n ──────────────────────────────────────────────────────────────────────
let translations = {};

async function loadLanguage(lang) {
  const res = await fetch(`/i18n/${lang}.json`);
  translations = await res.json();
  state.lang = lang;
  document.documentElement.lang = lang;
  applyStaticTranslations();
  renderAdbSteps();
  renderBrandSteps();
  refreshPathDisplays();
}

/** Looks up a dot-delimited key, substituting {var} placeholders. */
function t(key, vars = {}) {
  const val = key.split('.').reduce((o, k) => o?.[k], translations);
  if (typeof val !== 'string') return key;
  return val.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

/** Returns a translation value that is expected to be an array. */
function tArr(key) {
  const val = key.split('.').reduce((o, k) => o?.[k], translations);
  return Array.isArray(val) ? val : [];
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

// ─── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadLanguage('en');

  // Resolve local home dir once so the browser can start there
  try {
    const r = await fetch('/api/filesystem/home');
    state.homeDir = (await r.json()).home;
  } catch { /* fall back to null — browser will start at root */ }

  // Language selector
  document.getElementById('lang-select').addEventListener('change', e => {
    loadLanguage(e.target.value);
  });

  // File type buttons
  document.querySelectorAll('[data-group="fileType"]').forEach(btn => {
    btn.addEventListener('click', () => selectFileType(btn.dataset.value));
  });

  // Copy mode buttons
  document.querySelectorAll('[data-group="copyMode"]').forEach(btn => {
    btn.addEventListener('click', () => selectCopyMode(btn.dataset.value));
  });

  // Date range inputs
  document.getElementById('date-from').addEventListener('change', e => {
    state.dateFrom = e.target.value || null;
    validateDateRange();
  });
  document.getElementById('date-to').addEventListener('change', e => {
    state.dateTo = e.target.value || null;
    validateDateRange();
  });

  // Setup browse buttons
  document.getElementById('btn-browse-phone').addEventListener('click', () => openBrowser('phone'));
  document.getElementById('btn-browse-local').addEventListener('click', () => openBrowser('local'));
  document.getElementById('btn-start').addEventListener('click', startTransfer);

  // Browser modal
  document.getElementById('btn-browser-close').addEventListener('click',  closeBrowser);
  document.getElementById('btn-browser-cancel').addEventListener('click', closeBrowser);
  document.getElementById('btn-browser-select').addEventListener('click', confirmBrowserSelection);

  // Conflict modal
  document.getElementById('btn-skip').addEventListener('click',          () => resolveConflict('skip'));
  document.getElementById('btn-skip-all').addEventListener('click',      () => resolveConflict('skip-all'));
  document.getElementById('btn-overwrite').addEventListener('click',     () => resolveConflict('overwrite'));
  document.getElementById('btn-overwrite-all').addEventListener('click', () => resolveConflict('overwrite-all'));

  // Scan button on connect screen
  document.getElementById('btn-scan').addEventListener('click', () => {
    updateConnectScreen('checking');
    checkDevice();
  });

  // Cancel button on transfer screen
  document.getElementById('btn-cancel').addEventListener('click', cancelTransfer);

  // Error screen OK button
  document.getElementById('btn-error-ok').addEventListener('click', () => {
    stopDeviceWatch();
    showScreen('connect');
    checkDevice();
  });

  // Summary OK button
  document.getElementById('btn-ok').addEventListener('click', resetToStart);

  showScreen('connect');
  startDevicePolling();
});

// Shut down the server when the tab is closed
window.addEventListener('beforeunload', () => {
  stopDeviceWatch(); // prevent interval requests from cancelling the shutdown timer
  navigator.sendBeacon('/api/shutdown');
});

// ─── Screen management ─────────────────────────────────────────────────────────
const STEPS = ['connect', 'setup', 'transfer', 'summary'];

function showScreen(name) {
  state.currentScreen = name;

  // Update step indicators only for screens that are part of the normal flow
  const activeIdx = STEPS.indexOf(name);
  if (activeIdx !== -1) {
    STEPS.forEach((step, i) => {
      const el = document.getElementById(`step-${step}`);
      el.classList.remove('active', 'done');
      if (i < activeIdx)        el.classList.add('done');
      else if (i === activeIdx) el.classList.add('active');
    });
  }

  // Show / hide screen sections
  document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
  document.getElementById(`screen-${name}`).hidden = false;
}

// ─── Device scanning ───────────────────────────────────────────────────────────
// One scan fires at startup (connect screen). After the device is confirmed,
// a background watch runs on every screen except Connect, Summary and Error
// so that unplugging the phone is caught and shown as an error.

function startDevicePolling() {
  checkDevice();
}

function stopDevicePolling() {
  // nothing to stop — initial scan has no interval
}

// ─── Background device watch ────────────────────────────────────────────────────
let deviceWatchTimer = null;

function startDeviceWatch() {
  stopDeviceWatch();
  deviceWatchTimer = setInterval(async () => {
    // Only watch when the user is on a screen where losing the device matters
    const screen = state.currentScreen;
    if (screen === 'connect' || screen === 'summary' || screen === 'error') return;

    try {
      const res = await fetch('/api/device/status');
      if (!res.ok) { onDeviceLost(); return; }
      const { status } = await res.json();
      if (status !== 'connected') onDeviceLost();
    } catch {
      // Server unreachable — treat as lost only if we were mid-flow
      if (screen === 'setup') onDeviceLost();
    }
  }, 2000);
}

function stopDeviceWatch() {
  clearInterval(deviceWatchTimer);
  deviceWatchTimer = null;
}

function onDeviceLost() {
  stopDeviceWatch();
  // Cancel any running transfer silently before showing the error
  fetch('/api/transfer/cancel', { method: 'POST' }).catch(() => {});
  showError(t('error.disconnected'));
}

async function checkDevice() {
  try {
    const res = await fetch('/api/device/status');
    if (!res.ok) { updateConnectScreen('disconnected'); return; }
    const { status } = await res.json();
    updateConnectScreen(status);

    if (status === 'connected' && state.currentScreen === 'connect') {
      // Brief pause so the user sees the "connected" confirmation
      setTimeout(() => {
        showScreen('setup');
        startDeviceWatch();
      }, 900);
    }
  } catch {
    // Server not yet ready — show disconnected so the scan button is actionable
    updateConnectScreen('disconnected');
  }
}

function updateConnectScreen(status) {
  const states = ['checking', 'disconnected', 'unauthorized', 'connected', 'adb-not-found'];
  states.forEach(s => {
    document.getElementById(`state-${s}`).hidden = (s !== status);
  });
}

// ─── ADB guide ─────────────────────────────────────────────────────────────────
function renderAdbSteps() {
  const list = document.getElementById('adb-steps');
  list.innerHTML = '';
  tArr('connect.guideSteps').forEach(step => {
    const li = document.createElement('li');
    li.textContent = step;
    list.appendChild(li);
  });
}

function renderBrandSteps() {
  const list = document.getElementById('adb-brands-list');
  list.innerHTML = '';
  tArr('connect.brands').forEach(brand => {
    const dt = document.createElement('dt');
    dt.textContent = brand.name;
    const dd = document.createElement('dd');
    dd.textContent = brand.path;
    list.appendChild(dt);
    list.appendChild(dd);
  });
}

// ─── Setup screen ──────────────────────────────────────────────────────────────
function selectFileType(type) {
  state.fileType = type;
  document.querySelectorAll('[data-group="fileType"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === type);
  });

  const isFiles = type === 'files' || type === 'music';
  document.querySelector('[data-group="copyMode"][data-value="allFiles"]').disabled = isFiles;
  document.querySelector('[data-group="copyMode"][data-value="dateRange"]').hidden  = isFiles;

  // If date range was active when switching to Files, reset to all files
  if (isFiles && state.copyMode === 'dateRange') {
    selectCopyMode('allFiles');
  }
}

function selectCopyMode(mode) {
  state.copyMode = mode;
  document.querySelectorAll('[data-group="copyMode"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === mode);
  });
  document.getElementById('date-range-row').hidden = (mode !== 'dateRange');
  if (mode !== 'dateRange') {
    document.getElementById('date-range-error').hidden = true;
  } else {
    validateDateRange();
  }
}

function validateDateRange() {
  const errEl = document.getElementById('date-range-error');
  if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
    errEl.textContent = t('setup.dateRangeError');
    errEl.hidden = false;
    return false;
  }
  errEl.hidden = true;
  return true;
}

function refreshPathDisplays() {
  setPathDisplay('source-path', state.sourcePath, t('setup.sourcePlaceholder'));
  setPathDisplay('dest-path',   state.destPath,   t('setup.destPlaceholder'));
}

function setPathDisplay(id, value, placeholder) {
  const el = document.getElementById(id);
  if (value) {
    el.textContent = value;
    el.classList.remove('empty');
  } else {
    el.textContent = placeholder;
    el.classList.add('empty');
  }
}

// ─── Browser modal ─────────────────────────────────────────────────────────────
async function openBrowser(mode) {
  state.browserMode = mode;
  state.browserWarningShown = false;
  document.getElementById('browser-title').textContent =
    t(mode === 'phone' ? 'browser.titlePhone' : 'browser.titleLocal');
  document.getElementById('modal-browser').hidden = false;
  document.getElementById('browser-warning').hidden = true;
  document.getElementById('browser-shortcuts').hidden = true;

  if (mode === 'phone') {
    const defaultPath = PHONE_DEFAULT_PATH[state.fileType] ?? '/storage/emulated/0';
    await navigatePhone(defaultPath);
  } else {
    await navigateLocal(state.homeDir ?? '/');
  }
}

function closeBrowser() {
  document.getElementById('modal-browser').hidden = true;
  state.browserMode = null;
  state.browserPath = null;
}

async function confirmBrowserSelection() {
  const path = state.browserPath;
  if (!path) return;

  if (state.browserMode === 'phone' && !state.browserWarningShown) {
    const res = await fetch(`/api/device/check?path=${encodeURIComponent(path)}`);
    const { accessible } = await res.json();
    if (!accessible) {
      const warn = document.getElementById('browser-warning');
      warn.textContent = t('browser.inaccessible');
      warn.hidden = false;
      state.browserWarningShown = true;
      return;
    }
  }

  state.browserWarningShown = false;
  if (state.browserMode === 'phone') {
    state.sourcePath = path;
  } else {
    state.destPath = path;
  }

  closeBrowser();
  refreshPathDisplays();
  document.getElementById('setup-hint').hidden = true;
}

// Android system folders that are not useful for photo/video selection
const ANDROID_SYSTEM_DIRS = new Set([
  'Android', 'lost+found', 'obb', '.trash', '.thumbnails',
]);

function isAndroidSystemDir(name) {
  return name.startsWith('.') || ANDROID_SYSTEM_DIRS.has(name);
}

function renderShortcuts() {
  const wrap = document.getElementById('browser-shortcuts');
  const paths = PHONE_SHORTCUTS[state.fileType] ?? [];
  wrap.hidden = paths.length === 0;
  wrap.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'shortcuts-label';
  label.textContent = t('browser.suggestedTitle');
  wrap.appendChild(label);

  paths.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'shortcut-btn';
    btn.textContent = p.split('/').pop();
    btn.onclick = () => navigatePhone(p);
    wrap.appendChild(btn);
  });
}

async function navigatePhone(path) {
  state.browserWarningShown = false;
  document.getElementById('browser-warning').hidden = true;
  renderShortcuts();
  state.browserPath = path;
  document.getElementById('browser-path-bar').textContent = path;
  showBrowserLoading();

  const res = await fetch(`/api/device/browse?path=${encodeURIComponent(path)}`);
  const { entries, parent } = await res.json();
  const dirs = entries.filter(e => e.type === 'dir' && !isAndroidSystemDir(e.name));
  renderBrowserEntries(dirs, parent, navigatePhone);
}

async function navigateLocal(path) {
  document.getElementById('browser-shortcuts').hidden = true;
  state.browserPath = path;
  document.getElementById('browser-path-bar').textContent = path;
  showBrowserLoading();

  const res = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(path)}`);
  const { entries, parent } = await res.json();

  // Don't allow navigating above the user's home directory
  const atHome = state.homeDir && path === state.homeDir;
  renderBrowserEntries(entries.filter(e => e.type === 'dir'), atHome ? null : parent, navigateLocal);
}

function showBrowserLoading() {
  const list = document.getElementById('browser-list');
  list.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'browser-empty';
  p.textContent = t('browser.loading');
  list.appendChild(p);
}

function renderBrowserEntries(dirs, parent, navigate) {
  const list = document.getElementById('browser-list');
  list.innerHTML = '';

  if (parent) {
    list.appendChild(makeBrowserItem('..', 'back', () => navigate(parent)));
  }

  if (dirs.length === 0 && !parent) {
    const p = document.createElement('p');
    p.className = 'browser-empty';
    p.textContent = t('browser.empty');
    list.appendChild(p);
    return;
  }

  dirs.forEach(entry => {
    // For phone entries, build path manually; local entries already have full path
    const fullPath = entry.path ?? joinPhonePath(state.browserPath, entry.name);
    list.appendChild(makeBrowserItem(entry.name, 'dir', () => navigate(fullPath)));
  });
}

function makeBrowserItem(label, type, onClick) {
  const div = document.createElement('div');
  div.className = `browser-item is-${type}`;
  div.textContent = label;
  div.addEventListener('click', onClick);
  return div;
}

function joinPhonePath(base, name) {
  return base.endsWith('/') ? base + name : `${base}/${name}`;
}

// ─── Transfer ──────────────────────────────────────────────────────────────────
async function startTransfer() {
  if (!state.sourcePath || !state.destPath) {
    document.getElementById('setup-hint').hidden = false;
    return;
  }
  if (state.copyMode === 'dateRange') {
    if (!state.dateFrom || !state.dateTo) {
      const errEl = document.getElementById('date-range-error');
      errEl.textContent = t('setup.dateRangeRequired');
      errEl.hidden = false;
      return;
    }
    if (!validateDateRange()) return;
  }
  document.getElementById('setup-hint').hidden = true;

  // Open WebSocket before starting — ensures events are not missed
  await openWebSocket();
  // Reset transfer screen to "scanning" state
  document.getElementById('transfer-title').textContent = t('transfer.scanning');
  document.getElementById('transfer-found').hidden = true;
  document.getElementById('transfer-count').textContent = '';
  document.getElementById('transfer-filename').textContent = '';
  document.getElementById('progress-fill').style.width = '0%';
  showScreen('transfer');

  const body = {
    sourceDir: state.sourcePath,
    destDir:   state.destPath,
    fileType:  state.fileType,
  };
  if (state.copyMode === 'dateRange') {
    body.dateFrom = state.dateFrom;
    body.dateTo   = state.dateTo;
  }

  await fetch('/api/transfer/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function openWebSocket() {
  return new Promise(resolve => {
    state.ws = new WebSocket(`ws://${location.host}`);
    state.ws.addEventListener('open', resolve, { once: true });
    state.ws.addEventListener('message', e => handleWsMessage(JSON.parse(e.data)));
  });
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'scan':       showScanResult(msg);               break;
    case 'progress':   updateProgress(msg);               break;
    case 'conflict':   showConflict(msg);                 break;
    case 'complete':   showSummary(msg);                  break;
    case 'disconnect': showError(t('error.disconnected')); break;
    case 'noFiles':    showError(t('transfer.noFiles'));   break;
  }
}

function showScanResult({ total }) {
  document.getElementById('transfer-title').textContent = t('transfer.title');
  const foundEl = document.getElementById('transfer-found');
  foundEl.textContent = t('transfer.found', { total });
  foundEl.hidden = false;
}

function updateProgress({ current, total, filename }) {
  document.getElementById('transfer-count').textContent =
    t('transfer.fileOf', { current, total });
  document.getElementById('transfer-filename').textContent = filename;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

async function cancelTransfer() {
  await fetch('/api/transfer/cancel', { method: 'POST' });
}

// ─── Error screen ──────────────────────────────────────────────────────────────
function showError(message) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  document.getElementById('error-message').textContent = message;
  showScreen('error');
}

// ─── Conflict modal ────────────────────────────────────────────────────────────
function showConflict({ filename }) {
  document.getElementById('conflict-message').textContent =
    t('transfer.conflict.message', { filename });
  document.getElementById('modal-conflict').hidden = false;
}

async function resolveConflict(action) {
  document.getElementById('modal-conflict').hidden = true;
  await fetch('/api/transfer/resolve', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action }),
  });
}

// ─── Summary ───────────────────────────────────────────────────────────────────
function showSummary({ copied, skipped, errors }) {
  document.getElementById('sum-copied').textContent  = copied;
  document.getElementById('sum-skipped').textContent = skipped;
  document.getElementById('sum-errors').textContent  = errors;

  stopDeviceWatch();
  if (state.ws) { state.ws.close(); state.ws = null; }

  showScreen('summary');
}

// ─── Reset ─────────────────────────────────────────────────────────────────────
function resetToStart() {
  state.sourcePath = null;
  state.destPath   = null;
  state.fileType   = 'allTypes';
  state.copyMode   = 'allFiles';
  state.dateFrom   = null;
  state.dateTo     = null;

  refreshPathDisplays();

  document.querySelectorAll('[data-group="fileType"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'allTypes');
  });
  document.querySelectorAll('[data-group="copyMode"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'allFiles');
  });
  document.querySelector('[data-group="copyMode"][data-value="allFiles"]').disabled = false;
  document.querySelector('[data-group="copyMode"][data-value="dateRange"]').hidden  = false;
  document.getElementById('date-range-row').hidden = true;
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value   = '';
  document.getElementById('date-range-error').hidden = true;

  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('transfer-count').textContent    = '';
  document.getElementById('transfer-filename').textContent = '';
  document.getElementById('setup-hint').hidden = true;

  stopDeviceWatch();
  showScreen('connect');
  startDevicePolling();
}
