/**
 * content.js — ZoomSense position watcher
 *
 * Runs in every tab at document_start. Polls window.screenX / window.screenY
 * every 500ms. When the values change, the window has been dragged or snapped
 * to a new position — possibly onto a different monitor. We notify the
 * background service worker immediately so it can re-evaluate the display
 * assignment and update zoom within ~500ms instead of waiting up to 60s for
 * the alarm.
 *
 * Why screenX / screenY?
 *   These are standard DOM properties that report the window's pixel position
 *   relative to the primary screen's top-left corner. When a window moves
 *   from one monitor to another, these values change. No special permissions
 *   are needed to read them.
 *
 * Why NOT screen.availLeft?
 *   screen.availLeft reports the left edge of the AVAILABLE area on the
 *   screen the window is CURRENTLY on — it changes when the window crosses
 *   a monitor boundary, but only in some browsers/platforms. screenX is more
 *   universally reliable across OS / Chrome versions.
 *
 * Cost: negligible. Two property reads + a comparison every 500ms.
 * The message is only sent when position actually changes, so the background
 * worker is not spammed during normal browsing.
 */

(function () {
  'use strict';

  // Don't run inside iframes — only the top-level document tracks position.
  if (window.self !== window.top) return;

  let lastX = window.screenX;
  let lastY = window.screenY;

  // Track consecutive failures to avoid log spam if extension is reloaded.
  let failCount = 0;
  const MAX_FAILS = 5;

  const INTERVAL_MS = 500;

  const intervalId = setInterval(() => {
    const x = window.screenX;
    const y = window.screenY;

    if (x === lastX && y === lastY) return; // nothing moved

    lastX = x;
    lastY = y;

    // Guard: extension context can become invalid if the extension is reloaded
    // while the tab is still open. Stop polling if that happens.
    if (!chrome.runtime?.id) {
      clearInterval(intervalId);
      return;
    }

    chrome.runtime.sendMessage({ type: 'WINDOW_MOVED', screenX: x, screenY: y }, (resp) => {
      if (chrome.runtime.lastError) {
        failCount++;
        if (failCount >= MAX_FAILS) {
          clearInterval(intervalId);
          console.debug('[ZoomSense] content script stopped — extension context gone');
        }
      } else {
        failCount = 0; // reset on success
      }
    });
  }, INTERVAL_MS);

})();
