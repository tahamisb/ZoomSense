# ZoomSense

A Chrome extension that automatically adjusts tab zoom based on which monitor a Chrome window is on.

If you use a laptop with an external monitor, you have probably spent time manually hitting Ctrl+- every time you move a window to your big screen, then Ctrl+= again when you move it back. ZoomSense eliminates that. You set a zoom level for each display once, and it handles the rest silently in the background.

---

## How it works

ZoomSense tracks the screen position of every Chrome window. When a window moves to a different display, it reads the display ID, looks up the zoom level you configured for that display, and applies it to every tab in the window. The zoom is scoped per-tab so it never interferes with zoom levels you have set manually on other tabs or sites.

Detection uses two mechanisms in parallel:

- A content script runs in every tab and polls the window's screen coordinates every 500ms. When the position changes, it notifies the background worker immediately. This handles window dragging and gives a response time of roughly 500ms.
- A fallback alarm fires once per minute to catch edge cases the content script cannot cover, such as minimised windows or chrome:// tabs where content scripts do not run.

---

## Installation

**From the Chrome Web Store**

Search for ZoomSense in the Chrome Web Store, or use the direct link in the sidebar.

**Manual installation (unpacked)**

1. Download the latest release zip from the Releases page and extract it.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable Developer Mode using the toggle in the top-right corner.
4. Click Load unpacked and select the extracted folder.
5. The extension installs and the settings page opens automatically.

---

## Setup

1. Click the ZoomSense icon in the Chrome toolbar.
2. Open Full Settings.
3. In the Displays section, find your external monitor in the list and click Set External.
4. Set the zoom level for each display. The default is 1.00x for the laptop and 1.50x for the external monitor.
5. Click Save Settings.

That is all. ZoomSense will now apply the correct zoom whenever a window moves between displays.

---

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Read and set zoom levels on individual tabs. |
| `storage` | Save your zoom preferences locally on your device. |
| `system.display` | Enumerate connected monitors and read their screen coordinates. |
| `windows` | Read window positions and bounds to determine which display each window is on. |
| `alarms` | Run a background check once per minute as a fallback for cases the content script cannot detect. |
| `host_permissions: <all_urls>` | Required for the content script to run in tabs and report window position changes. |

No data is collected, transmitted, or stored anywhere outside your local device.

---

## File structure

```
zoomsense/
├── manifest.json       MV3 manifest
├── background.js       Service worker — display detection and zoom logic
├── content.js          Content script — 500ms position polling per tab
├── popup.html          Toolbar popup UI
├── popup.js
├── popup.css
├── options.html        Full settings page
├── options.js
├── options.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Known limitations

- **Window dragging without tab interaction.** If you drag a window to another monitor without clicking any tab, the content script detects the position change within 500ms. In rare cases where the content script is not active (minimised window, chrome:// tabs), the 1-minute alarm handles it.
- **Minimum alarm period.** Chrome enforces a minimum 1-minute period for alarms in packed extensions, so the fallback poll cannot run faster than that.
- **chrome:// and DevTools tabs.** These tabs do not support zoom modification and are silently skipped. All other tabs function normally.
- **Per-tab zoom scope.** ZoomSense uses per-tab zoom rather than per-origin zoom. This means it will not override zoom levels you have set manually via Ctrl+scroll on a specific site.

---

## Technical notes

**Why per-tab zoom instead of per-origin zoom?**
Chrome's default zoom behaviour is per-origin — changing zoom on one tab changes it for all tabs on the same domain. ZoomSense uses `setZoomSettings({ scope: 'per-tab' })` before applying zoom so each tab is handled independently. This prevents the extension from overwriting zoom preferences a user has set on a site they visit frequently.

**Why not `mode: 'manual'`?**
An earlier version of this extension used `mode: 'manual'` in `setZoomSettings`. This instructs Chrome to suppress all zoom rendering and wait for the extension to respond to `onZoomChange` events. Since ZoomSense does not listen to `onZoomChange`, this had the effect of silently discarding every zoom change including Ctrl+/-. The mode is now omitted, which defaults to `'automatic'` and lets Chrome handle zoom rendering normally.

**Service worker restart race condition.**
MV3 service workers are short-lived and restart frequently. On restart, the in-memory settings object defaults to `externalDisplayId: null` before `chrome.storage.local` has been read. Any event firing in that window would apply the wrong zoom. ZoomSense uses a `settingsReady` Promise that gates all zoom functions until storage has loaded. Events that arrive before the gate opens are dropped rather than executed with stale settings.

---

## Changelog

### 1.1.0
- Added content script for sub-minute window movement detection (500ms response time).
- Faster new-tab zoom: zoom is now attempted at tab creation, page load, and page complete rather than only at page complete.
- Renamed to ZoomSense.

### 1.0.0
- Initial release.
- Event-driven zoom with 1-minute alarm fallback.
- Settings page with display selection and zoom presets.
- Per-tab zoom scope with no-op guard to avoid fighting manual zoom.

---

## License

Copyright (c) 2025 Taha Mutahir

All rights reserved.
