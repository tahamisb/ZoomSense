/**
 * background.js — ZoomSense Service Worker v1.1.0
 *
 * v1.1.0 changes:
 *  NEW  — Content script integration: handles WINDOW_MOVED messages from
 *         content.js which polls screenX/screenY at 500ms intervals. This
 *         replaces the 60-second alarm as the primary display-change detector
 *         for window dragging. The alarm is kept as a final fallback.
 *
 *  NEW  — Faster new-tab zoom: applies zoom at THREE points instead of one:
 *         1. Immediately on tabs.onCreated (attempt with no delay)
 *         2. At tabs.onUpdated status:'loading' (page is initialising)
 *         3. At tabs.onUpdated status:'complete' (guaranteed final apply)
 *         This eliminates the visible jump for most pages. Chrome may silently
 *         fail attempt 1 for very new tabs; attempts 2+3 are the safety net.
 *
 *  FIX  — settingsReady gate (v1.0 FIX 1): no zoom until storage loaded.
 *  FIX  — Per-window lock (v1.0 FIX 2): no concurrent processing per window.
 *  FIX  — appliedZoom in cache (v1.0 FIX 3): detects settings-value changes.
 */

'use strict';

const POLL_ALARM_NAME = 'zoomSense_poll';

const DEFAULT_SETTINGS = {
  enabled:           true,
  externalDisplayId: null,
  laptopZoom:        1.0,
  externalZoom:      1.5,
};

// ─── Settings gate ────────────────────────────────────────────────────────────
// No zoom function runs until init() calls _settingsReadyResolve().
let _settingsReadyResolve;
const settingsReady = new Promise((r) => { _settingsReadyResolve = r; });
let settings = { ...DEFAULT_SETTINGS };

// ─── Per-window processing lock ───────────────────────────────────────────────
const processingWindows = new Set();

// ─── Window state cache: { displayId, appliedZoom } ──────────────────────────
const windowStateCache = new Map();

// ─── Last focused normal window (for popup diagnostics) ───────────────────────
let lastFocusedNormalWindowId = null;

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((r) => chrome.storage.local.get(DEFAULT_SETTINGS, r));
}
function saveSettings(s) {
  return new Promise((r) => chrome.storage.local.set(s, r));
}

// ─── Display logic ────────────────────────────────────────────────────────────

function getDisplays() {
  return new Promise((r) => chrome.system.display.getInfo({}, r));
}

function getDisplayForWindow(win, displays) {
  if (!displays?.length)                             return null;
  if (win.state === 'minimized')                     return null;
  if (displays.length === 1)                         return displays[0];
  if (win.left == null || !win.width || !win.height) return displays[0];

  const cx = win.left + Math.floor(win.width  / 2);
  const cy = win.top  + Math.floor(win.height / 2);

  for (const d of displays) {
    const b = d.bounds;
    if (cx >= b.left && cx < b.left + b.width &&
        cy >= b.top  && cy < b.top  + b.height) return d;
  }

  // Fallback: largest overlap
  let best = null, max = 0;
  for (const d of displays) {
    const b  = d.bounds;
    const xo = Math.max(0, Math.min(win.left + win.width,  b.left + b.width)  - Math.max(win.left, b.left));
    const yo = Math.max(0, Math.min(win.top  + win.height, b.top  + b.height) - Math.max(win.top,  b.top));
    const a  = xo * yo;
    if (a > max) { max = a; best = d; }
  }
  return best || displays[0];
}

function getDesiredZoom(display, s) {
  if (!s.enabled || !display)                                   return null;
  if (s.externalDisplayId && display.id === s.externalDisplayId) return s.externalZoom;
  return s.laptopZoom;
}

// ─── Zoom application ─────────────────────────────────────────────────────────

/**
 * Apply zoom to a single tab.
 *
 * scope:'per-tab'  — limits this zoom to the tab only, not all tabs on the origin.
 * mode intentionally omitted — defaults to 'automatic' so Chrome renders zoom
 * normally and Ctrl+/- still works. Setting mode:'manual' would silently
 * discard all zoom input until the extension responds to onZoomChange.
 */
async function applyZoomToTab(tabId, desiredZoom) {
  // Step 1: per-tab scope (non-fatal — some tabs reject this but may accept setZoom)
  try {
    await new Promise((r) => {
      chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' }, () => {
        chrome.runtime.lastError; // consume
        r();
      });
    });
  } catch (_) {}

  // Step 2: read + conditionally write
  try {
    const cur = await new Promise((resolve, reject) => {
      chrome.tabs.getZoom(tabId, (z) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(z);
      });
    });

    if (Math.abs(cur - desiredZoom) > 0.001) {
      await new Promise((resolve, reject) => {
        chrome.tabs.setZoom(tabId, desiredZoom, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
      console.log(`[ZS] tab ${tabId}: ${cur.toFixed(2)}→${desiredZoom.toFixed(2)}`);
    }
  } catch (err) {
    // chrome://, devtools://, pdf viewer, etc. — silently skip
    console.debug(`[ZS] tab ${tabId} skip: ${err.message}`);
  }
}

/**
 * Apply correct zoom to every tab in a window.
 * Guards: settingsReady + per-window lock.
 */
async function applyZoomForWindow(windowId) {
  await settingsReady;

  if (!settings.enabled)                           return;
  if (windowId === chrome.windows.WINDOW_ID_NONE)  return;
  if (processingWindows.has(windowId))             return; // lock

  processingWindows.add(windowId);
  try {
    const win = await new Promise((resolve, reject) => {
      chrome.windows.get(windowId, { populate: true }, (w) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(w);
      });
    });

    if (!win || win.type !== 'normal') return;

    const displays    = await getDisplays();
    const display     = getDisplayForWindow(win, displays);
    const desiredZoom = getDesiredZoom(display, settings);
    if (desiredZoom === null) return;

    windowStateCache.set(windowId, { displayId: display?.id, appliedZoom: desiredZoom });
    await Promise.all((win.tabs || []).map((t) => applyZoomToTab(t.id, desiredZoom)));

  } catch (err) {
    console.debug(`[ZS] window ${windowId}: ${err.message}`);
    windowStateCache.delete(windowId);
  } finally {
    processingWindows.delete(windowId);
  }
}

/**
 * Apply correct zoom to a single tab directly, bypassing the window lock.
 * Used for new-tab fast-path: we know the tab's windowId and just need to
 * set its zoom as quickly as possible without waiting for a full window scan.
 */
async function applyZoomForTab(tabId, windowId) {
  await settingsReady;
  if (!settings.enabled) return;

  try {
    const [win, displays] = await Promise.all([
      new Promise((resolve, reject) => {
        chrome.windows.get(windowId, { populate: false }, (w) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(w);
        });
      }),
      getDisplays(),
    ]);

    if (!win || win.type !== 'normal') return;

    const display     = getDisplayForWindow(win, displays);
    const desiredZoom = getDesiredZoom(display, settings);
    if (desiredZoom === null) return;

    await applyZoomToTab(tabId, desiredZoom);
  } catch (err) {
    console.debug(`[ZS] fast-tab ${tabId}: ${err.message}`);
  }
}

/**
 * Check every open window.
 * Only re-applies when display or zoom value changed since last check.
 */
async function checkAllWindows() {
  await settingsReady;
  if (!settings.enabled) return;

  const [displays, windows] = await Promise.all([
    getDisplays(),
    new Promise((r) => chrome.windows.getAll({ populate: true }, r)),
  ]);

  for (const win of windows) {
    if (win.type !== 'normal') continue;
    const display     = getDisplayForWindow(win, displays);
    if (!display) continue;
    const desiredZoom = getDesiredZoom(display, settings);
    if (desiredZoom === null) continue;

    const prev        = windowStateCache.get(win.id);
    const isNew       = !prev;
    const movedDisplay = prev?.displayId   !== display.id;
    const zoomChanged  = prev?.appliedZoom !== desiredZoom;

    windowStateCache.set(win.id, { displayId: display.id, appliedZoom: desiredZoom });

    if (isNew || movedDisplay || zoomChanged) {
      await Promise.all((win.tabs || []).map((t) => applyZoomToTab(t.id, desiredZoom)));
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  settings = await loadSettings();
  _settingsReadyResolve(); // open the gate
  console.log('[ZS] ready. settings:', JSON.stringify(settings));
  await checkAllWindows();
  // Alarm kept as last-resort fallback for edge cases content script can't cover
  // (e.g. chrome:// tabs, minimised windows, window snap without screenX change)
  chrome.alarms.create(POLL_ALARM_NAME, { when: Date.now() + 5000, periodInMinutes: 1 });
}

// ─── Events ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM_NAME) checkAllWindows();
});

// NEW TAB — three-attempt fast-path to minimise the visible zoom jump:
//  Attempt 1: immediately on creation (tab may not be ready yet — that's OK,
//             applyZoomToTab catches the error silently)
//  Attempt 2: on status:'loading' — page is initialising, Chrome accepts setZoom
//  Attempt 3: on status:'complete' — guaranteed final correction
chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.windowId) return;
  // Attempt 1: fire immediately, best case this beats the page render
  applyZoomForTab(tab.id, tab.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.windowId) return;
  // Attempt 2: page loading — catches most real navigations before paint
  if (changeInfo.status === 'loading') {
    applyZoomForTab(tabId, tab.windowId);
  }
  // Attempt 3: page complete — final guarantee
  if (changeInfo.status === 'complete') {
    applyZoomForWindow(tab.windowId);
  }
});

chrome.tabs.onActivated.addListener(({ windowId }) => {
  applyZoomForWindow(windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.windows.get(windowId, (w) => {
    if (!chrome.runtime.lastError && w?.type === 'normal') {
      lastFocusedNormalWindowId = windowId;
    }
  });
  applyZoomForWindow(windowId);
});

chrome.windows.onCreated.addListener((w) => {
  if (w.type === 'normal' && w.id != null) {
    // Short delay for new windows — bounds are sometimes 0,0 right at creation
    setTimeout(() => applyZoomForWindow(w.id), 200);
  }
});

chrome.windows.onRemoved.addListener((id) => {
  windowStateCache.delete(id);
  processingWindows.delete(id);
});

chrome.system.display.onDisplayChanged.addListener(async () => {
  windowStateCache.clear();
  await checkAllWindows();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (!['enabled','externalDisplayId','laptopZoom','externalZoom'].some((k) => k in changes)) return;
  settings = await loadSettings();
  // Null out appliedZoom so every window gets re-evaluated on next check
  for (const [id, s] of windowStateCache) windowStateCache.set(id, { ...s, appliedZoom: null });
  await checkAllWindows();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await saveSettings(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS };
    chrome.runtime.openOptionsPage();
  }
});

// ─── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── From popup/options: force re-check all windows ──────────────────────
  if (msg.type === 'FORCE_CHECK') {
    windowStateCache.clear();
    checkAllWindows().then(() => sendResponse({ ok: true }));
    return true;
  }

  // ── From content script: window was dragged to a new position ───────────
  // The content script detected a screenX/screenY change. We only need to
  // re-check the single window the tab belongs to — much cheaper than
  // checkAllWindows() and happens within ~500ms of the drag completing.
  if (msg.type === 'WINDOW_MOVED') {
    const windowId = sender?.tab?.windowId;
    if (!windowId) return;

    // Only act if the window actually changed its display assignment.
    // applyZoomForWindow's lock + cache will skip if nothing changed.
    applyZoomForWindow(windowId);
    // No sendResponse needed — fire-and-forget
    return;
  }

  // ── From popup/options: diagnostics ─────────────────────────────────────
  if (msg.type === 'GET_DIAGNOSTICS') {
    (async () => {
      const displays = await getDisplays();
      const windows  = await new Promise((r) => chrome.windows.getAll({ populate: true }, r));
      const diags    = [];

      for (const win of windows) {
        if (win.type !== 'normal') continue;
        const display     = getDisplayForWindow(win, displays);
        const desiredZoom = display ? getDesiredZoom(display, settings) : null;
        const active      = (win.tabs || []).find((t) => t.active);
        let actualZoom    = null;
        if (active) {
          actualZoom = await new Promise((r) => {
            chrome.tabs.getZoom(active.id, (z) => { chrome.runtime.lastError; r(z ?? null); });
          });
        }
        diags.push({
          windowId:    win.id,   state:       win.state,
          bounds:      { left: win.left, top: win.top, width: win.width, height: win.height },
          displayId:   display?.id   ?? null,
          displayName: display?.name ?? null,
          desiredZoom, actualZoom,
          activeTabUrl: active?.url ?? null,
          isFocused:    win.focused,
        });
      }

      sendResponse({
        settings,
        lastFocusedWindowId: lastFocusedNormalWindowId,
        displays: displays.map((d) => ({
          id: d.id, name: d.name, bounds: d.bounds,
          isPrimary: d.isPrimary, deviceScaleFactor: d.deviceScaleFactor,
        })),
        windows: diags,
      });
    })();
    return true;
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
