// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  lang:        'en',
  fileType:    'both',   // 'images' | 'videos' | 'both'
  sourcePath:  null,     // selected phone path
  destPath:    null,     // selected local path
  browserMode: null,     // 'phone' | 'local'  (while modal is open)
  browserPath: null,     // currently viewed path in browser modal
  ws:          null,     // active WebSocket during transfer
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

  // Language selector
  document.getElementById('lang-select').addEventListener('change', e => {
    loadLanguage(e.target.value);
  });

  // File type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => selectFileType(btn.dataset.value));
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

  // Summary OK button
  document.getElementById('btn-ok').addEventListener('click', resetToStart);

  showScreen('connect');
  startDevicePolling();
});

// Shut down the server when the tab is closed
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/api/shutdown');
});

// ─── Screen management ─────────────────────────────────────────────────────────
const STEPS = ['connect', 'setup', 'transfer', 'summary'];

function showScreen(name) {
  state.currentScreen = name;

  // Update step indicators
  const activeIdx = STEPS.indexOf(name);
  STEPS.forEach((step, i) => {
    const el = document.getElementById(`step-${step}`);
    el.classList.remove('active', 'done');
    if (i < activeIdx)      el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });

  // Show / hide screen sections
  document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
  document.getElementById(`screen-${name}`).hidden = false;
}

// ─── Device polling ────────────────────────────────────────────────────────────
let pollTimer = null;

function startDevicePolling() {
  checkDevice();
  pollTimer = setInterval(checkDevice, 1000);
}

function stopDevicePolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function checkDevice() {
  try {
    const res = await fetch('/api/device/status');
    if (!res.ok) { updateConnectScreen('disconnected'); return; }
    const { status } = await res.json();
    updateConnectScreen(status);

    if (status === 'connected' && state.currentScreen === 'connect') {
      stopDevicePolling();
      // Brief pause so the user sees the "connected" confirmation
      setTimeout(() => showScreen('setup'), 900);
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

// ─── Setup screen ──────────────────────────────────────────────────────────────
function selectFileType(type) {
  state.fileType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === type);
  });
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
  document.getElementById('browser-title').textContent =
    t(mode === 'phone' ? 'browser.titlePhone' : 'browser.titleLocal');
  document.getElementById('modal-browser').hidden = false;

  if (mode === 'phone') {
    await navigatePhone('/sdcard');
  } else {
    const res = await fetch('/api/filesystem/roots');
    const { roots } = await res.json();
    await navigateLocal(roots[0]);
  }
}

function closeBrowser() {
  document.getElementById('modal-browser').hidden = true;
  state.browserMode = null;
  state.browserPath = null;
}

function confirmBrowserSelection() {
  const path = state.browserPath;
  if (!path) return;

  if (state.browserMode === 'phone') {
    state.sourcePath = path;
  } else {
    state.destPath = path;
  }

  closeBrowser();
  refreshPathDisplays();
  document.getElementById('setup-hint').hidden = true;
}

async function navigatePhone(path) {
  state.browserPath = path;
  document.getElementById('browser-path-bar').textContent = path;
  showBrowserLoading();

  const res = await fetch(`/api/device/browse?path=${encodeURIComponent(path)}`);
  const { entries, parent } = await res.json();
  renderBrowserEntries(entries.filter(e => e.type === 'dir'), parent, navigatePhone);
}

async function navigateLocal(path) {
  state.browserPath = path;
  document.getElementById('browser-path-bar').textContent = path;
  showBrowserLoading();

  const res = await fetch(`/api/filesystem/browse?path=${encodeURIComponent(path)}`);
  const { entries, parent } = await res.json();
  renderBrowserEntries(entries.filter(e => e.type === 'dir'), parent, navigateLocal);
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
  document.getElementById('setup-hint').hidden = true;

  // Open WebSocket before starting — ensures events are not missed
  await openWebSocket();
  showScreen('transfer');

  await fetch('/api/transfer/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceDir: state.sourcePath,
      destDir:   state.destPath,
      fileType:  state.fileType,
    }),
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
    case 'progress': updateProgress(msg);    break;
    case 'conflict': showConflict(msg);      break;
    case 'complete': showSummary(msg);       break;
  }
}

function updateProgress({ current, total, filename }) {
  document.getElementById('transfer-count').textContent =
    t('transfer.fileOf', { current, total });
  document.getElementById('transfer-filename').textContent = filename;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
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

  if (state.ws) { state.ws.close(); state.ws = null; }

  showScreen('summary');
}

// ─── Reset ─────────────────────────────────────────────────────────────────────
function resetToStart() {
  state.sourcePath = null;
  state.destPath   = null;
  state.fileType   = 'both';

  refreshPathDisplays();

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'both');
  });

  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('transfer-count').textContent    = '';
  document.getElementById('transfer-filename').textContent = '';
  document.getElementById('setup-hint').hidden = true;

  showScreen('connect');
  startDevicePolling();
}
