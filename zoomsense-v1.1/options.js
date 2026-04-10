/**
 * options.js — ZoomSense settings page
 */

'use strict';

const DEFAULTS = { enabled: true, externalDisplayId: null, laptopZoom: 1.0, externalZoom: 1.5 };

let cfg      = { ...DEFAULTS };
let displays = [];

const $ = (id) => document.getElementById(id);

const enabledToggle  = $('enabledToggle');
const toggleTrack    = document.querySelector('.toggle-track');
const statusBar      = $('statusBar');
const statusText     = $('statusText');
const laptopRange    = $('laptopRange');
const laptopZoomEl   = $('laptopZoom');
const externalRange  = $('externalRange');
const externalZoomEl = $('externalZoom');
const displayList    = $('displayList');
const refreshBtn     = $('refreshDisplays');
const saveBtn        = $('saveBtn');
const forceApplyBtn  = $('forceApplyBtn');
const saveMsg        = $('saveMsg');
const diagOutput     = $('diagOutput');
const refreshDiagBtn = $('refreshDiag');

function fmt(v)   { return parseFloat(v).toFixed(2) + '×'; }
function clamp(v) { return Math.max(0.25, Math.min(5.0, v)); }
function esc(s)   { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function loadCfg()  { return new Promise((r) => chrome.storage.local.get(DEFAULTS, r)); }
function saveCfg(s) { return new Promise((r) => chrome.storage.local.set(s, r)); }
function sendMsg(type) {
  return new Promise((r) => chrome.runtime.sendMessage({ type }, (resp) => {
    chrome.runtime.lastError; r(resp ?? null);
  }));
}

// ── Status ────────────────────────────────────────────────────────────────────

function updateStatus() {
  if (!cfg.enabled) {
    statusBar.className = 'status-bar s-disabled';
    statusText.textContent = 'Extension disabled — no zoom changes will be made';
  } else if (!cfg.externalDisplayId) {
    statusBar.className = 'status-bar s-warn';
    statusText.textContent = 'Active — select an external monitor below';
  } else {
    const d = displays.find((x) => x.id === cfg.externalDisplayId);
    const name = d ? (d.name || cfg.externalDisplayId) : cfg.externalDisplayId;
    statusBar.className = 'status-bar s-ext';
    statusText.textContent = `Active — "${esc(name)}" is external (${fmt(cfg.externalZoom)})`;
  }
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function syncToggle() {
  enabledToggle.checked = cfg.enabled;
  toggleTrack.classList.toggle('on', cfg.enabled);
  updateStatus();
}

enabledToggle.addEventListener('change', async () => {
  cfg.enabled = enabledToggle.checked;
  syncToggle();
  await saveCfg(cfg);
});

toggleTrack.addEventListener('click', () => {
  enabledToggle.checked = !enabledToggle.checked;
  enabledToggle.dispatchEvent(new Event('change'));
});

// ── Zoom controls ─────────────────────────────────────────────────────────────

function syncZoomUI() {
  laptopRange.value    = cfg.laptopZoom;
  laptopZoomEl.value   = cfg.laptopZoom.toFixed(2);
  externalRange.value  = cfg.externalZoom;
  externalZoomEl.value = cfg.externalZoom.toFixed(2);
  highlightZoomPresets();
}

function highlightZoomPresets() {
  document.querySelectorAll('.zpbtn').forEach((b) => {
    const v   = parseFloat(b.dataset.zoom);
    const key = b.dataset.for === 'external' ? cfg.externalZoom : cfg.laptopZoom;
    b.classList.toggle('on', Math.abs(v - key) < 0.01);
  });
}

function linkSliderNum(rangeEl, numEl, key) {
  rangeEl.addEventListener('input', () => {
    cfg[key] = clamp(parseFloat(rangeEl.value));
    numEl.value = cfg[key].toFixed(2);
    highlightZoomPresets();
  });
  numEl.addEventListener('input', () => {
    const v = parseFloat(numEl.value);
    if (!isNaN(v) && v >= 0.25 && v <= 5.0) { cfg[key] = v; rangeEl.value = v; highlightZoomPresets(); }
  });
  numEl.addEventListener('blur', () => {
    let v = parseFloat(numEl.value);
    if (isNaN(v)) v = cfg[key];
    cfg[key] = clamp(v);
    numEl.value = cfg[key].toFixed(2);
    rangeEl.value = cfg[key];
    highlightZoomPresets();
  });
}

document.querySelectorAll('.zpbtn').forEach((b) => {
  b.addEventListener('click', () => {
    const v = parseFloat(b.dataset.zoom);
    if (b.dataset.for === 'laptop') cfg.laptopZoom = v;
    else cfg.externalZoom = v;
    syncZoomUI();
  });
});

// ── Display list ──────────────────────────────────────────────────────────────

function renderDisplayList() {
  if (!displays.length) {
    displayList.innerHTML = '<p class="diag-idle">No displays detected. Click Refresh.</p>';
    return;
  }
  displayList.innerHTML = '';

  displays.forEach((d) => {
    const b     = d.bounds;
    const isSel = d.id === cfg.externalDisplayId;
    const card  = document.createElement('div');
    card.className = 'disp-card' + (isSel ? ' ext-sel' : '');

    card.innerHTML = `
      <div class="disp-thumb">
        <svg width="48" height="36" viewBox="0 0 48 36" fill="none">
          <rect x="2" y="2" width="44" height="28" rx="3"
            stroke="${isSel ? 'var(--blue)' : 'var(--border)'}" stroke-width="2"
            fill="${isSel ? 'rgba(134,168,207,0.12)' : 'rgba(255,255,255,0.25)'}"/>
          <line x1="16" y1="30" x2="16" y2="33" stroke="${isSel?'var(--blue)':'var(--border)'}" stroke-width="2" stroke-linecap="round"/>
          <line x1="32" y1="30" x2="32" y2="33" stroke="${isSel?'var(--blue)':'var(--border)'}" stroke-width="2" stroke-linecap="round"/>
          <line x1="10" y1="33" x2="38" y2="33" stroke="${isSel?'var(--blue)':'var(--border)'}" stroke-width="2" stroke-linecap="round"/>
          <text x="24" y="19" font-family="inherit" font-size="7" font-weight="700"
            fill="${isSel?'var(--blue)':'var(--txt-3)'}" text-anchor="middle">
            ${isSel ? fmt(cfg.externalZoom) : fmt(cfg.laptopZoom)}
          </text>
        </svg>
      </div>
      <div>
        <div class="disp-name-row">
          <span class="disp-name">${esc(d.name || 'Display')}</span>
          ${d.isPrimary ? '<span class="badge badge-primary">Primary</span>' : ''}
          ${isSel       ? '<span class="badge badge-external">External</span>' : ''}
        </div>
        <div class="disp-meta">
          <span>${b.width} × ${b.height}</span>
          <span>(${b.left}, ${b.top})</span>
          <span>Scale ${d.deviceScaleFactor || 1}×</span>
          <span class="mono">${esc(d.id)}</span>
        </div>
      </div>
      <button class="btn-ext${isSel?' sel':''}" data-id="${esc(d.id)}">
        ${isSel ? '✓ External' : 'Set External'}
      </button>`;

    displayList.appendChild(card);
  });

  displayList.querySelectorAll('.btn-ext').forEach((btn) => {
    btn.addEventListener('click', () => {
      cfg.externalDisplayId = cfg.externalDisplayId === btn.dataset.id ? null : btn.dataset.id;
      renderDisplayList();
      syncZoomUI();
      updateStatus();
    });
  });
}

// ── Save / Force ──────────────────────────────────────────────────────────────

let saveMsgTimer;
function showSaveMsg(txt) {
  saveMsg.textContent = txt;
  saveMsg.classList.add('show');
  clearTimeout(saveMsgTimer);
  saveMsgTimer = setTimeout(() => saveMsg.classList.remove('show'), 2500);
}

async function handleSave() {
  saveBtn.disabled = true;
  await saveCfg(cfg);
  renderDisplayList();
  showSaveMsg('✓ Saved');
  setTimeout(() => saveBtn.disabled = false, 2500);
}

async function handleForceApply() {
  forceApplyBtn.disabled = true;
  await saveCfg(cfg);
  await sendMsg('FORCE_CHECK');
  showSaveMsg('✓ Applied to all windows');
  setTimeout(() => forceApplyBtn.disabled = false, 2500);
  await runDiag();
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

async function runDiag() {
  diagOutput.innerHTML = `<div class="disp-loading"><div class="spin"></div>Querying…</div>`;
  const data = await sendMsg('GET_DIAGNOSTICS');

  if (!data) {
    diagOutput.innerHTML = `<div class="diag-err">⚠ Could not reach service worker. Reload the extension at chrome://extensions then reopen this page.</div>`;
    return;
  }

  const { settings: sw, displays: dps, windows: wins } = data;
  let h = '';

  h += `<div class="diag-sl">Settings in service worker</div>`;
  h += row('Enabled', sw.enabled ? 'Yes' : 'No (zoom suspended)', sw.enabled ? 'ok' : 'warn');
  h += row('External Display ID', sw.externalDisplayId || 'None', sw.externalDisplayId ? '' : 'warn');
  h += row('Laptop Zoom', fmt(sw.laptopZoom));
  h += row('External Zoom', fmt(sw.externalZoom));

  h += `<div class="diag-sl">Connected Displays (${dps.length})</div>`;
  dps.forEach((d) => {
    const isExt = d.id === sw.externalDisplayId;
    h += row(
      `<span class="mono">${esc(d.id)}</span>`,
      `${esc(d.name||'?')} — ${d.bounds.width}×${d.bounds.height} @ (${d.bounds.left},${d.bounds.top}) ×${d.deviceScaleFactor||1}`
      + (isExt ? ' <span class="tag tag-ext">EXTERNAL</span>' : '')
      + (d.isPrimary ? ' <span class="tag" style="background:rgba(255,255,255,0.4);color:var(--txt-3)">PRIMARY</span>' : '')
    );
  });

  h += `<div class="diag-sl">Chrome Windows (${wins.length})</div>`;
  if (!wins.length) h += `<p class="diag-idle">No normal Chrome windows found.</p>`;

  wins.forEach((w) => {
    const zok = w.desiredZoom !== null && w.actualZoom !== null
      ? Math.abs(w.actualZoom - w.desiredZoom) < 0.001 : null;
    const zstat = w.desiredZoom === null
      ? `<span class="dv warn">N/A</span>`
      : zok === null ? `<span class="dv warn">Could not read</span>`
      : zok ? `<span class="dv ok">✓ ${fmt(w.actualZoom)} correct</span>`
      : `<span class="dv err">✗ Mismatch — desired ${fmt(w.desiredZoom)}, actual ${fmt(w.actualZoom)}</span>`;

    h += `<div class="diag-win${w.isFocused?' focused':''}">
      <div class="diag-win-title">
        Window ${w.windowId}
        ${w.isFocused ? '<span class="tag tag-foc">FOCUSED</span>' : ''}
        <span style="font-size:10px;color:var(--txt-3);font-weight:600">${w.state}</span>
      </div>
      ${row('Bounds', `<span class="mono">${w.bounds.left},${w.bounds.top} — ${w.bounds.width}×${w.bounds.height}</span>`)}
      ${row('Display', w.displayId ? `<span class="mono">${esc(w.displayId)}</span> ${esc(w.displayName||'')}` : '<span class="dv warn">Not detected</span>')}
      ${row('Tab URL', `<span class="mono" style="font-size:10px">${esc((w.activeTabUrl||'').slice(0,72))}</span>`)}
      ${row('Zoom', zstat)}
    </div>`;
  });

  diagOutput.innerHTML = h;
}

function row(k, v, cls = '') {
  return `<div class="diag-row"><span class="dk">${k}</span><span class="dv${cls?' '+cls:''}">${v}</span></div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function fetchDisplays() {
  return new Promise((r) => chrome.system.display.getInfo({}, r));
}

async function init() {
  [cfg, displays] = await Promise.all([loadCfg(), fetchDisplays()]);
  syncToggle();
  syncZoomUI();
  renderDisplayList();
  linkSliderNum(laptopRange, laptopZoomEl, 'laptopZoom');
  linkSliderNum(externalRange, externalZoomEl, 'externalZoom');
  saveBtn.addEventListener('click', handleSave);
  forceApplyBtn.addEventListener('click', handleForceApply);
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    displays = await fetchDisplays();
    renderDisplayList();
    refreshBtn.disabled = false;
  });
  refreshDiagBtn.addEventListener('click', runDiag);
  runDiag();
}

init();
