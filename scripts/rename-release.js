const fs   = require('fs');
const path = require('path');

const { version } = require('../package.json');
const releaseDir  = path.join(__dirname, '..', 'release');

const targets = [
  { from: 'amc-win-x64.exe',   to: `amc-v${version}-win-x64.exe`   },
  { from: 'amc-macos-x64',     to: `amc-v${version}-macos-x64`     },
  { from: 'amc-macos-arm64',   to: `amc-v${version}-macos-arm64`   },
  { from: 'amc-linux-x64',     to: `amc-v${version}-linux-x64`     },
];

for (const { from, to } of targets) {
  const src  = path.join(releaseDir, from);
  const dest = path.join(releaseDir, to);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`  ${from} → ${to}`);
  }
}
