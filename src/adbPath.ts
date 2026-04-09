import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolves the path to the ADB binary.
 *
 * - In development (ts-node / node dist/): returns 'adb' and relies on system PATH.
 * - In a pkg bundle: extracts the embedded ADB binary to the system temp directory
 *   on first run, then returns that path. The extraction is skipped on subsequent runs.
 *
 * ADB binaries are embedded at build time from the bin/ directory.
 */

const isPkg = typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== 'undefined';

const TEMP_BIN_DIR = path.join(os.tmpdir(), 'amc-adb-bin');

let resolvedPath: string | null = null;

export function getAdbPath(): string {
  if (resolvedPath) return resolvedPath;

  if (!isPkg) {
    // In zip-distribution mode (node dist/server.js), prefer bundled ADB from bin/<platform>/
    // if it exists, so non-technical users don't need ADB on their PATH.
    const platform    = process.platform;
    const binaryName  = platform === 'win32' ? 'adb.exe' : 'adb';
    const platformDir = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
    const localBin    = path.join(__dirname, '..', 'bin', platformDir, binaryName);
    resolvedPath = fs.existsSync(localBin) ? localBin : 'adb';
    return resolvedPath;
  }

  const platform    = process.platform;
  const binaryName  = platform === 'win32' ? 'adb.exe' : 'adb';
  const platformDir = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
  const destBinary  = path.join(TEMP_BIN_DIR, binaryName);

  if (!fs.existsSync(destBinary)) {
    fs.mkdirSync(TEMP_BIN_DIR, { recursive: true });

    // In a pkg bundle, __dirname resolves inside the virtual snapshot filesystem.
    // Regular fs calls (readFileSync, copyFileSync) work transparently against it.
    const srcDir = path.join(__dirname, '..', 'bin', platformDir);

    // Copy the main binary
    fs.copyFileSync(path.join(srcDir, binaryName), destBinary);

    // On Windows, ADB needs its companion DLLs in the same directory
    if (platform === 'win32') {
      for (const entry of fs.readdirSync(srcDir)) {
        if (entry.endsWith('.dll')) {
          fs.copyFileSync(
            path.join(srcDir, entry),
            path.join(TEMP_BIN_DIR, entry),
          );
        }
      }
    }

    // Ensure the binary is executable on Unix
    if (platform !== 'win32') {
      fs.chmodSync(destBinary, 0o755);
    }
  }

  resolvedPath = destBinary;
  return resolvedPath;
}
