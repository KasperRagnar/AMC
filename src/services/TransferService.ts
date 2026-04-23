import EventEmitter from 'events';
import path from 'path';
import fs from 'fs/promises';
import { AdbService } from './AdbService';
import { ExifService } from './ExifService';
import { FileService } from './FileService';

export type FileType = 'images' | 'videos' | 'allTypes' | 'files' | 'music';
export type ConflictAction = 'skip' | 'overwrite' | 'skip-all' | 'overwrite-all';

export interface TransferOptions {
  sourceDir: string;
  destDir: string;
  fileType: FileType;
  dateFrom?: string;
  dateTo?: string;
}

export interface ProgressEvent {
  current: number;
  total: number;
  filename: string;
}

export interface ConflictEvent {
  filename: string;
  destPath: string;
}

export interface ScanEvent {
  total: number;
}

export interface SummaryEvent {
  copied: number;
  skipped: number;
  errors: number;
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp',
  '.gif', '.bmp', '.raw', '.dng', '.cr2', '.nef', '.arw', '.orf',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.3gp', '.m4v', '.wmv', '.ts',
]);

const FILE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv',
  '.zip', '.rar', '.7z',
  '.epub', '.mobi',
]);

const MUSIC_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff',
]);

/**
 * Orchestrates file transfer from phone to local machine.
 *
 * Emits:
 *   'progress' (ProgressEvent) — after each file pull starts
 *   'conflict' (ConflictEvent) — when a file already exists at destination
 *   'complete' (SummaryEvent) — when all files are processed
 *
 * Call resolveConflict() in response to a 'conflict' event to resume.
 * Call cancel() to abort an in-progress transfer.
 */
export class TransferService extends EventEmitter {
  private conflictResolve: ((action: ConflictAction) => void) | null = null;
  private cancelled = false;

  constructor(
    private readonly adb: AdbService,
    private readonly exif: ExifService,
    private readonly files: FileService,
  ) {
    super();
  }

  cancel(): void {
    this.cancelled = true;
    // Resolve any pending conflict so the loop can exit
    this.conflictResolve?.('skip');
    this.conflictResolve = null;
  }

  resolveConflict(action: ConflictAction): void {
    this.conflictResolve?.(action);
    this.conflictResolve = null;
  }

  async start(options: TransferOptions): Promise<void> {
    this.cancelled = false;

    const { sourceDir, destDir, fileType } = options;
    const tempDir = this.files.getTempDir();
    await this.files.ensureDir(tempDir);

    const allFiles = await this.adb.listFilesRecursive(sourceDir);
    let filtered = allFiles
      .filter(f => this.matchesType(f, fileType))
      .filter(f => !path.basename(f).startsWith('.trashed-'));

    if (options.dateFrom && options.dateTo) {
      const from = new Date(options.dateFrom + 'T00:00:00');
      const to   = new Date(options.dateTo   + 'T23:59:59');
      const modTimes = await this.adb.getFileModTimes(filtered);
      filtered = filtered.filter(f => {
        const d = modTimes.get(f);
        return d != null && d >= from && d <= to;
      });
    }

    if (filtered.length === 0) {
      this.emit('noFiles');
      return;
    }

    // Tell the frontend how many files were found before copying begins
    this.emit('scan', { total: filtered.length });

    const summary: SummaryEvent = { copied: 0, skipped: 0, errors: 0 };
    // 'skip-all' or 'overwrite-all' applied to all remaining conflicts
    let globalAction: 'skip-all' | 'overwrite-all' | null = null;

    for (let i = 0; i < filtered.length; i++) {
      if (this.cancelled) break;

      const phonePath = filtered[i];
      const filename = path.basename(phonePath);
      const tempPath = path.join(tempDir, filename);

      this.emit('progress', { current: i + 1, total: filtered.length, filename });

      try {
        await this.adb.pullFile(phonePath, tempPath);

        const ext = path.extname(phonePath).toLowerCase();

        let destFolder: string;
        if (FILE_EXTENSIONS.has(ext)) {
          destFolder = path.join(destDir, 'files');
        } else if (MUSIC_EXTENSIONS.has(ext)) {
          destFolder = path.join(destDir, 'music');
        } else {
          const typeFolder = VIDEO_EXTENSIONS.has(ext) ? 'videos' : 'images';
          const date =
            (await this.exif.getDate(tempPath)) ??
            (await this.adb.getFileDate(phonePath));
          destFolder = date
            ? path.join(
                destDir,
                typeFolder,
                String(date.getFullYear()),
                this.pad(date.getMonth() + 1),
                this.pad(date.getDate()),
              )
            : path.join(destDir, typeFolder, 'Unknown');
        }

        await this.files.ensureDir(destFolder);

        const destPath = path.join(destFolder, filename);
        const exists = await this.files.fileExists(destPath);

        if (exists) {
          let action: ConflictAction;

          if (globalAction) {
            action = globalAction;
          } else {
            this.emit('conflict', { filename, destPath });
            action = await this.waitForConflict();
            if (action === 'skip-all' || action === 'overwrite-all') {
              globalAction = action;
            }
          }

          if (action === 'skip' || action === 'skip-all') {
            summary.skipped++;
            await this.files.deleteFile(tempPath);
            continue;
          }
        }

        await this.moveToDest(tempPath, destPath);
        summary.copied++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const deviceGone =
          msg.includes('no devices') ||
          msg.includes('device offline') ||
          msg.includes('device not found') ||
          msg.includes('error: closed');

        if (deviceGone) {
          await this.files.deleteFile(tempPath);
          this.emit('disconnect');
          return;
        }

        summary.errors++;
        await this.files.deleteFile(tempPath);
      }
    }

    // Best-effort cleanup of temp dir
    try { await fs.rmdir(tempDir); } catch { /* may still have files on error */ }

    this.emit('complete', summary);
  }

  private async moveToDest(src: string, dest: string): Promise<void> {
    try {
      await this.files.moveFile(src, dest);
    } catch {
      // Cross-device rename fails (e.g., temp on system drive, dest on external)
      await this.files.copyFile(src, dest);
      await this.files.deleteFile(src);
    }
  }

  private waitForConflict(): Promise<ConflictAction> {
    return new Promise(resolve => {
      this.conflictResolve = resolve;
    });
  }

  private matchesType(filePath: string, fileType: FileType): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (fileType === 'images') return IMAGE_EXTENSIONS.has(ext);
    if (fileType === 'videos') return VIDEO_EXTENSIONS.has(ext);
    if (fileType === 'files')  return FILE_EXTENSIONS.has(ext);
    if (fileType === 'music')  return MUSIC_EXTENSIONS.has(ext);
    return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)
        || FILE_EXTENSIONS.has(ext)   || MUSIC_EXTENSIONS.has(ext);
  }

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }
}
