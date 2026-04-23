import { Router } from 'express';
import WebSocket from 'ws';
import { TransferService, TransferOptions, ConflictAction, FolderMode } from '../services/TransferService';
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
    const { sourceDir, destDir, fileType, dateFrom, dateTo, folderMode } = req.body as TransferOptions & { dateFrom?: string; dateTo?: string };

    if (!sourceDir || !destDir || !fileType) {
      res.status(400).json({ error: 'sourceDir, destDir, and fileType are required' });
      return;
    }

    if ((dateFrom == null) !== (dateTo == null)) {
      res.status(400).json({ error: 'Provide both dateFrom and dateTo, or neither' });
      return;
    }

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && dateTo) {
      if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) {
        res.status(400).json({ error: 'dateFrom and dateTo must be YYYY-MM-DD' });
        return;
      }
      if (dateFrom > dateTo) {
        res.status(400).json({ error: 'dateFrom must not be after dateTo' });
        return;
      }
    }

    const VALID_FOLDER_MODES = new Set<string>(['filesOnly', 'keepFolders']);
    if (folderMode != null && !VALID_FOLDER_MODES.has(folderMode as string)) {
      res.status(400).json({ error: 'folderMode must be "filesOnly" or "keepFolders"' });
      return;
    }

    // Cancel any running transfer before starting a new one
    activeTransfer?.cancel();

    activeTransfer = new TransferService(adb, exif, files);
    activeTransfer.on('scan',       data => send({ type: 'scan',       ...data }));
    activeTransfer.on('progress',   data => send({ type: 'progress',   ...data }));
    activeTransfer.on('conflict',   data => send({ type: 'conflict',   ...data }));
    activeTransfer.on('complete',   data => send({ type: 'complete',   ...data }));
    activeTransfer.on('disconnect',  ()   => send({ type: 'disconnect' }));
    activeTransfer.on('noFiles',     ()   => send({ type: 'noFiles' }));

    // Respond immediately — transfer runs asynchronously
    res.json({ ok: true });

    const options: TransferOptions = {
      sourceDir, destDir, fileType,
      ...(dateFrom && dateTo ? { dateFrom, dateTo } : {}),
      ...(folderMode         ? { folderMode: folderMode as FolderMode } : {}),
    };
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
