import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface LocalEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export class FileService {
  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async moveFile(src: string, dest: string): Promise<void> {
    await fs.rename(src, dest);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(src, dest);
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore — file may already be gone
    }
  }

  async listDirectory(dirPath: string): Promise<LocalEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() || e.isFile())
      .map(e => ({
        name: e.name,
        type: (e.isDirectory() ? 'dir' : 'file') as 'dir' | 'file',
        path: path.join(dirPath, e.name),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns filesystem root(s): drive letters on Windows, ['/'] on Linux/Mac.
   */
  async getRoots(): Promise<string[]> {
    if (process.platform === 'win32') {
      const drives: string[] = [];
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        try {
          await fs.access(`${letter}:\\`);
          drives.push(`${letter}:\\`);
        } catch {
          // Drive not mounted
        }
      }
      return drives;
    }
    return ['/'];
  }

  getTempDir(): string {
    return path.join(os.tmpdir(), 'amc-transfer');
  }
}
