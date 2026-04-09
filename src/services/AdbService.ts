import { execFile } from 'child_process';
import { promisify } from 'util';
import { getAdbPath } from '../adbPath';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB — large enough for deep directory listings

export type DeviceStatus = 'connected' | 'disconnected' | 'unauthorized' | 'adb-not-found';

export interface DeviceInfo {
  status: DeviceStatus;
  serial?: string;
}

export interface PhoneEntry {
  name: string;
  type: 'file' | 'dir';
  date?: Date;
}

export class AdbService {
  private async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(getAdbPath(), args, { maxBuffer: MAX_BUFFER });
    return stdout;
  }

  async getDeviceStatus(): Promise<DeviceInfo> {
    try {
      const output = await this.run(['devices']);
      const lines = output.trim().split('\n').slice(1).filter(l => l.trim());

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const serial = parts[0];
        const state = parts[1];
        if (state === 'unauthorized') return { status: 'unauthorized', serial };
        if (state === 'device') return { status: 'connected', serial };
      }

      return { status: 'disconnected' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('not found')) {
        return { status: 'adb-not-found' };
      }
      return { status: 'disconnected' };
    }
  }

  async listDirectory(phonePath: string): Promise<PhoneEntry[]> {
    try {
      const output = await this.run(['shell', 'ls', '-la', phonePath]);
      return output
        .trim()
        .split('\n')
        .map(line => this.parseLsLine(line))
        .filter((e): e is PhoneEntry => e !== null);
    } catch {
      return [];
    }
  }

  async listFilesRecursive(phonePath: string): Promise<string[]> {
    try {
      const output = await this.run(['shell', 'find', phonePath, '-type', 'f']);
      // adb shell output uses CRLF on Windows — trim() strips the \r so paths are clean
      return output.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    } catch {
      return [];
    }
  }

  async pullFile(phonePath: string, localPath: string): Promise<void> {
    await this.run(['pull', phonePath, localPath]);
  }

  /**
   * Gets the file's modification date from the Android shell.
   * Used as a fallback when EXIF data is not available.
   */
  async getFileDate(phonePath: string): Promise<Date | null> {
    try {
      const output = await this.run(['shell', 'ls', '-la', phonePath]);
      const entry = output
        .trim()
        .split('\n')
        .map(l => this.parseLsLine(l))
        .find((e): e is PhoneEntry => e !== null);
      return entry?.date ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Parses a single line from `adb shell ls -la` output.
   * Handles the Toybox format used on Android 6+: YYYY-MM-DD HH:MM
   */
  private parseLsLine(line: string): PhoneEntry | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total')) return null;

    const parts = trimmed.split(/\s+/);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const dateIdx = parts.findIndex(p => datePattern.test(p));

    // Need at least: permissions, date, time, filename
    if (dateIdx < 0 || dateIdx + 2 >= parts.length) return null;

    const permissions = parts[0];
    const dateStr = parts[dateIdx];
    const timeStr = parts[dateIdx + 1];
    const name = parts.slice(dateIdx + 2).join(' ');

    if (!name || name === '.' || name === '..') return null;

    const date = new Date(`${dateStr}T${timeStr}:00`);

    return {
      name,
      type: permissions.startsWith('d') ? 'dir' : 'file',
      date: isNaN(date.getTime()) ? undefined : date,
    };
  }
}
