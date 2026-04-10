/**
 * popup.js — ZoomSense popup controller
 */

'use strict';

const DEFAULTS = { enabled: true, externalDisplayId: null, laptopZoom: 1.0, externalZoom: 1.5 };
const STEP = 0.25, MIN = 0.25, MAX = 5.0;

let cfg  = { ...DEFAULTS };
let diag = null;

const $  = (id) => document.getElementById(id);
const enabledToggle    = $('enabledToggle');
const toggleTrack      = document.querySelector('.toggle-track');
const statusBar        = $('statusBar');
const statusText       = $('statusText');
const laptopCard       = $('laptopCard');
const externalCard     = $('externalCard');
const laptopCardZoom   = $('laptopCardZoom');
const externalCardZoom = $('externalCardZoom');
const externalCardName = $('externalCardName');
const laptopVal        = $('laptopVal');
const externalVal      = $('externalVal');
const laptopMinus      = $('laptopMinus');
const laptopPlus       = $('laptopPlus');
const externalMinus    = $('externalMinus');
const externalPlus     = $('externalPlus');
const presets          = $('presets');
const applyBtn         = $('applyBtn');
const settingsBtn      = $('settingsBtn');
const diagBtn          = $('diagBtn');
const toast            = $('toast');

function fmt(v) { return parseFloat(v).toFixed(2) + '×'; }
function clamp(v) { return Math.max(MIN, Math.min(MAX, Math.round(v * 100) / 100)); }

let toastTimer;
function showToast(msg, type = 'ok') {
  toast.textContent = msg;
  toast.className   = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function loadCfg() { return new Promise((r) => chrome.storage.local.get(DEFAULTS, r)); }
function saveCfg(s) { return new Promise((r) => chrome.storage.local.set(s, r)); }
function sendMsg(type) {
  return new Promise((r) => chrome.runtime.sendMessage({ type }, (resp) => {
    chrome.runtime.lastError; r(resp ?? null);
  }));
}

function render() {
  enabledToggle.checked = cfg.enabled;
  toggleTrack.classList.toggle('on', cfg.enabled);

  laptopVal.textContent        = fmt(cfg.laptopZoom);
  externalVal.textContent      = fmt(cfg.externalZoom);
  laptopCardZoom.textContent   = fmt(cfg.laptopZoom);
  externalCardZoom.textContent = cfg.externalDisplayId ? fmt(cfg.externalZoom) : 'Not set';

  laptopMinus.disabled   = cfg.laptopZoom   <= MIN;
  laptopPlus.disabled    = cfg.laptopZoom   >= MAX;
  externalMinus.disabled = cfg.externalZoom <= MIN;
  externalPlus.disabled  = cfg.externalZoom >= MAX;

  if (diag && cfg.externalDisplayId) {
    const d = diag.displays.find((x) => x.id === cfg.externalDisplayId);
    if (d) {
      const n = (d.name || 'External').replace(/\(.*?\)/g, '').trim();
      externalCardName.textContent = n.length > 11 ? n.slice(0, 10) + '…' : n;
    }
  } else {
    externalCardName.textContent = 'External';
  }

  let activeDisplayId = null;
  if (diag) {
    const focused = diag.windows.find((w) => w.windowId === diag.lastFocusedWindowId)
                 || diag.windows.find((w) => w.isFocused);
    if (focused) activeDisplayId = focused.displayId;
  }

  const onExt    = cfg.externalDisplayId && activeDisplayId === cfg.externalDisplayId;
  const onLaptop = !onExt && activeDisplayId !== null;

  laptopCard.className   = 'dcard' + (onLaptop ? ' active' : '');
  externalCard.className = 'dcard dcard-ext' + (onExt ? ' active' : '') + (!cfg.externalDisplayId ? ' unset' : '');

  if (!cfg.enabled) {
    statusBar.className = 'status-bar s-disabled';
    statusText.textContent = 'Extension disabled';
  } else if (!diag) {
    statusBar.className = 'status-bar s-loading';
    statusText.textContent = 'Detecting…';
  } else if (!cfg.externalDisplayId) {
    statusBar.className = 'status-bar s-warn';
    statusText.textContent = 'No external display set — open Full Settings';
  } else if (onExt) {
    statusBar.className = 'status-bar s-ext';
    statusText.textContent = `External monitor → ${fmt(cfg.externalZoom)} zoom active`;
  } else if (onLaptop) {
    statusBar.className = 'status-bar s-laptop';
    statusText.textContent = `Laptop display → ${fmt(cfg.laptopZoom)} zoom active`;
  } else {
    statusBar.className = 'status-bar';
    statusText.textContent = 'Window not detected';
  }

  presets.querySelectorAll('.pbtn').forEach((b) => {
    b.classList.toggle('on', Math.abs(parseFloat(b.dataset.zoom) - cfg.externalZoom) < 0.01);
  });
}

async function applyNow() {
  applyBtn.classList.add('pressing');
  await saveCfg(cfg);
  await sendMsg('FORCE_CHECK');
  setTimeout(() => applyBtn.classList.remove('pressing'), 180);
  showToast('✓ Zoom applied to all windows');
  diag = await sendMsg('GET_DIAGNOSTICS');
  render();
}

enabledToggle.addEventListener('change', async () => {
  cfg.enabled = enabledToggle.checked;
  render();
  await saveCfg(cfg);
});

toggleTrack.addEventListener('click', () => {
  enabledToggle.checked = !enabledToggle.checked;
  enabledToggle.dispatchEvent(new Event('change'));
});

laptopMinus.addEventListener('click',   () => { cfg.laptopZoom   = clamp(cfg.laptopZoom   - STEP); render(); });
laptopPlus.addEventListener('click',    () => { cfg.laptopZoom   = clamp(cfg.laptopZoom   + STEP); render(); });
externalMinus.addEventListener('click', () => { cfg.externalZoom = clamp(cfg.externalZoom - STEP); render(); });
externalPlus.addEventListener('click',  () => { cfg.externalZoom = clamp(cfg.externalZoom + STEP); render(); });

presets.addEventListener('click', (e) => {
  const b = e.target.closest('.pbtn');
  if (b) { cfg.externalZoom = parseFloat(b.dataset.zoom); render(); }
});

applyBtn.addEventListener('click', applyNow);
settingsBtn.addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
diagBtn.addEventListener('click',     () => { chrome.runtime.openOptionsPage(); window.close(); });

async function init() {
  [cfg, diag] = await Promise.all([loadCfg(), sendMsg('GET_DIAGNOSTICS')]);
  render();
}

init();
