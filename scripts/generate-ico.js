const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const svgPath = path.join(__dirname, '..', 'public', 'logo.svg');
const icoPath = path.join(__dirname, '..', 'public', 'logo.ico');
const tmpPng  = path.join(os.tmpdir(), 'amc-logo-256.png');

async function main() {
  // Render SVG → 256×256 PNG
  await sharp(svgPath).resize(256, 256).png().toFile(tmpPng);

  // Dynamically import the ESM default export
  const { default: pngToIco } = await import('png-to-ico');
  const ico = await pngToIco(tmpPng);
  fs.writeFileSync(icoPath, ico);
  fs.unlinkSync(tmpPng);
  console.log('  logo.ico generated');
}

main().catch(err => { console.error(err); process.exit(1); });
