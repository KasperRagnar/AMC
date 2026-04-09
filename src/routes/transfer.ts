import { Router } from 'express';
import WebSocket from 'ws';
import { TransferService, TransferOptions, ConflictAction } from '../services/TransferService';
import { AdbService } from '../services/AdbService';
import { ExifService } from '../services/ExifService';
import { FileService } from '../services/FileService';

// Shared service instances — one ADB connection, one EXIF parser, one FS helper
const adb = new AdbService();
const exif = new ExifService();
const files = new FileService();

/**
 * Creates the transfer router.
 * @param getWs — returns the active WebSocket connection, or null if disconnected.
 */
export function createTransferRouter(getWs: () => WebSocket | null) {
  const router = Router();
  let activeTransfer: TransferService | null = null;

  function send(data: object): void {
    const ws = getWs();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  router.post('/start', (req, res) => {
    const options = req.body as TransferOptions;

    if (!options.sourceDir || !options.destDir || !options.fileType) {
      res.status(400).json({ error: 'sourceDir, destDir, and fileType are required' });
      return;
    }

    // Cancel any running transfer before starting a new one
    activeTransfer?.cancel();

    activeTransfer = new TransferService(adb, exif, files);
    activeTransfer.on('progress', data => send({ type: 'progress', ...data }));
    activeTransfer.on('conflict', data => send({ type: 'conflict', ...data }));
    activeTransfer.on('complete', data => send({ type: 'complete', ...data }));

    // Respond immediately — transfer runs asynchronously
    res.json({ ok: true });

    activeTransfer.start(options).catch(err => {
      send({ type: 'error', message: String(err) });
    });
  });

  router.post('/resolve', (req, res) => {
    const { action } = req.body as { action: ConflictAction };
    activeTransfer?.resolveConflict(action);
    res.json({ ok: true });
  });

  router.post('/cancel', (_req, res) => {
    activeTransfer?.cancel();
    res.json({ ok: true });
  });

  return router;
}
