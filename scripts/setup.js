#!/usr/bin/env node
/**
 * Downloads ADB (Android Debug Bridge) binaries from Google's official
 * Android Platform Tools for Windows, macOS, and Linux.
 *
 * Run once before building: npm run setup
 * Then build distributable executables: npm run dist
 *
 * Requires internet access during this setup step only.
 * The resulting executables work fully offline.
 */

'use strict';

const https      = require('https');
const fs         = require('fs');
const fsp        = require('fs/promises');
const path       = require('path');
const stream     = require('stream');
const unzipper   = require('unzipper');
const { execFileSync } = require('child_process');

const PLATFORM_TOOLS = {
  win:   'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  mac:   'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
};

// Files to extract from each zip (relative to platform-tools/ inside the zip)
const EXTRACT_FILTER = {
  win:   f => f === 'adb.exe' || f.endsWith('.dll'),
  mac:   f => f === 'adb',
  linux: f => f === 'adb',
};

const BIN_DIR = path.join(__dirname, '..', 'bin');

function download(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const request = https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function extractAdb(platformName, buffer, outDir) {
  const filter = EXTRACT_FILTER[platformName];
  const directory = await unzipper.Open.buffer(buffer);

  let extracted = 0;
  for (const file of directory.files) {
    if (file.type === 'Directory') continue;

    // Entries are like "platform-tools/adb.exe"
    const parts = file.path.split('/');
    if (parts.length < 2 || parts[0] !== 'platform-tools') continue;

    const filename = parts[1];
    if (!filename || !filter(filename)) continue;

    const dest = path.join(outDir, filename);
    await new Promise((resolve, reject) => {
      file.stream()
        .pipe(fs.createWriteStream(dest))
        .on('finish', resolve)
        .on('error', reject);
    });

    // Make binaries executable on Unix
    if (platformName !== 'win') {
      await fsp.chmod(dest, 0o755);
    }

    extracted++;
  }

  if (extracted === 0) {
    throw new Error(`No ADB files found in zip for platform "${platformName}"`);
  }
}

function alreadyDownloaded(platformName) {
  const binary = platformName === 'win' ? 'adb.exe' : 'adb';
  return fs.existsSync(path.join(BIN_DIR, platformName, binary));
}

async function setupPlatform(platformName, url) {
  const outDir = path.join(BIN_DIR, platformName);
  await fsp.mkdir(outDir, { recursive: true });

  if (alreadyDownloaded(platformName)) {
    console.log(`  [${platformName}] Already present — skipping.`);
    return;
  }

  process.stdout.write(`  [${platformName}] Downloading...`);
  const buffer = await download(url);
  process.stdout.write(` extracting...`);
  await extractAdb(platformName, buffer, outDir);
  console.log(' done.');
}

async function main() {
  const currentOnly = process.argv.includes('--current');

  let platforms;
  if (currentOnly) {
    const p = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    platforms = [[p, PLATFORM_TOOLS[p]]];
    console.log(`Setting up ADB for current platform (${p})...\n`);
  } else {
    platforms = Object.entries(PLATFORM_TOOLS);
    console.log('Setting up ADB binaries for all platforms...\n');
  }

  for (const [name, url] of platforms) {
    await setupPlatform(name, url);
  }

  // Capture the ADB version from the current platform's binary and write it to bin/adb-version.txt.
  // All three platform zips ship the same platform-tools release, so one version string covers all.
  const currentPlatform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const currentBinary   = path.join(BIN_DIR, currentPlatform, process.platform === 'win32' ? 'adb.exe' : 'adb');
  try {
    const versionOutput = execFileSync(currentBinary, ['version'], { encoding: 'utf8' });
    const match         = versionOutput.match(/Version\s+([\d.\-]+)/);
    const versionStr    = match ? match[1] : versionOutput.split('\n')[0].trim();
    fs.writeFileSync(path.join(BIN_DIR, 'adb-version.txt'), versionStr);
    console.log(`  ADB version: ${versionStr}`);
  } catch {
    console.warn('  Warning: could not determine ADB version — bin/adb-version.txt not written.');
  }

  if (currentOnly) {
    console.log('\nADB is ready. Starting the app...\n');
  } else {
    console.log('\nAll ADB binaries are ready in bin/');
    console.log('Run "npm run dist" to build the distributable executables.\n');
  }
}

main().catch(err => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
