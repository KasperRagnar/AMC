import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import { exec } from 'child_process';
import deviceRouter from './routes/device';
import filesystemRouter from './routes/filesystem';
import { createTransferRouter } from './routes/transfer';

const PORT = 3000;
const app = express();

// Pending shutdown timer — cancelled if any new request arrives within the grace period.
// This prevents a hard-refresh (which fires beforeunload) from killing the server.
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

// Cancel a pending shutdown when the browser makes a real request (e.g. hard-refresh).
// Background polling (/api/device/status) is excluded — an in-flight poll that arrives
// after the tab is closed must not prevent the server from shutting down.
const BACKGROUND_PATHS = new Set(['/api/device/status']);

app.use((req, _res, next) => {
  if (shutdownTimer && !BACKGROUND_PATHS.has(req.path)) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track the most recent WebSocket connection for sending transfer events
let activeWs: WebSocket | null = null;

wss.on('connection', (ws) => {
  activeWs = ws;
  ws.on('close', () => {
    if (activeWs === ws) activeWs = null;
  });
});

app.use('/api/device', deviceRouter);
app.use('/api/filesystem', filesystemRouter);
app.use('/api/transfer', createTransferRouter(() => activeWs));

// Called by the browser via sendBeacon() when the tab is closed (or refreshed).
// We wait 5 seconds before actually shutting down — if the browser sends any
// new request within that window (e.g. after a hard-refresh) the timer is
// cancelled by the middleware above and the server keeps running.
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  shutdownTimer = setTimeout(() => {
    server.close();
    process.exit(0);
  }, 5000);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Android Media Copier running at ${url}`);
  openBrowser(url);
});

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}
