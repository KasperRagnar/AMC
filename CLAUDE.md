# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local web app that copies photos and videos from an Android phone to a computer using ADB over USB. The user opens the app via a start script, a browser tab opens automatically, and the server shuts down when the tab is closed.

## Commands

```bash
# Development
npm install
npm run dev          # Run with ts-node, uses system ADB from PATH

# Production (self-contained executables)
npm install
npm run setup        # One-time: downloads ADB binaries into bin/ (needs internet)
npm run dist         # Compiles TypeScript + bundles into release/ executables

# Run a specific build without packaging
npm run build && npm start
```

The server runs on `http://localhost:3000` (development) or the same port when launched from the executable.

### Distributing

After `npm run dist`, the `release/` folder contains one self-contained executable per platform:
- `amc-win.exe` — Windows x64 (double-click to run)
- `amc-macos` — macOS Intel
- `amc-macos-arm64` — macOS Apple Silicon
- `amc-linux` — Linux x64

Each executable includes Node.js, the app, the frontend, and the ADB binary for its platform. No installation required for the end user.

### Start scripts (development / testing without packaging)

```bash
./start.sh     # Linux / macOS — handles npm install + build automatically
start.vbs      # Windows — double-click, hides terminal
start.bat      # Windows — shows terminal (for debugging)
```

## Project structure

```
src/
  server.ts               Entry point: Express + WebSocket server, browser launch, shutdown endpoint
  services/
    AdbService.ts         Wraps adb CLI via execFile (safe, no shell injection)
    ExifService.ts        Reads EXIF date from local files using exifr
    FileService.ts        Local filesystem: list dirs, move/copy/delete files, temp dir, OS roots
    TransferService.ts    Orchestrates transfer; extends EventEmitter
  routes/
    device.ts             GET /api/device/status, GET /api/device/browse
    filesystem.ts         GET /api/filesystem/roots, GET /api/filesystem/browse
    transfer.ts           POST /api/transfer/start|resolve|cancel  (factory: receives getWs fn)
public/
  index.html              Single-page app — 4 screens shown/hidden via JS
  style.css               CSS custom properties, no framework
  app.js                  Vanilla JS; all event listeners attached in DOMContentLoaded
  i18n/
    en.json / da.json / es.json   All UI strings; loaded at runtime via fetch
```

## Architecture: how the pieces connect

**Transfer flow (happy path):**
1. Browser opens WebSocket → `server.ts` stores it as `activeWs`
2. `POST /api/transfer/start` → `createTransferRouter` creates a `TransferService`, wires its events to `send()` (which writes to `activeWs`), then calls `transferService.start()` asynchronously
3. `TransferService` emits `progress`, `conflict`, `complete` events — these are forwarded to the browser via WebSocket
4. On `conflict`: browser shows modal → user clicks → `POST /api/transfer/resolve` → `transferService.resolveConflict(action)` resolves the internal `Promise` the loop is awaiting

**Shutdown:** `beforeunload` fires `navigator.sendBeacon('/api/shutdown')` → server calls `process.exit(0)`.

**Date resolution per file:** EXIF from pulled temp file → `adb shell ls -la <phonePath>` date → `Unknown/` folder at destination root.

**Folder structure created at destination:** `<destDir>/<Year>/<MM>/<DD>/filename` or `<destDir>/Unknown/filename`.

## Key constraints

- In development (`npm run dev`), `adb` must be in the system PATH. In a packaged executable, `src/adbPath.ts` extracts the bundled ADB binary from the pkg snapshot to `os.tmpdir()/amc-adb-bin/` on first launch and reuses it on subsequent runs.
- Only USB — no network/Wi-Fi ADB.
- The app **never deletes or moves files on the phone** — only reads and pulls.
- `TransferService` uses a `conflictResolve` callback pattern (not a queue) so only one conflict dialog is shown at a time. If `cancel()` is called while waiting, it resolves with `'skip'` to unblock the loop.
- `execFile` is used for all ADB calls (not `exec`) to avoid shell injection when paths contain spaces or special characters.

## Adding a new language

1. Copy `public/i18n/en.json` to `public/i18n/<code>.json` and translate all values.
2. Add an `<option value="<code>">` to `#lang-select` in `public/index.html`.

## Extending file type support

Image and video extensions are defined as `Set` constants at the top of `src/services/TransferService.ts`. Add extensions there — no other changes needed.
