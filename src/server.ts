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

// Called by the browser via sendBeacon() when the tab is closed
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 300);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`AMC Transfer running at ${url}`);
  openBrowser(url);
});

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd);
}
