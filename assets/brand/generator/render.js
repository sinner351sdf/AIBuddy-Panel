// Render production SVGs and synchronize browser assets and desktop source.png.
const { Resvg } = require('@resvg/resvg-js');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const UI = path.resolve(ROOT, '../../desktop-tauri/ui/brand');
const DESKTOP = path.resolve(ROOT, '../../desktop-tauri/src-tauri/icons');
function render(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
}
// ICO supports lossless PNG entries, preserving transparency at all favicon sizes.
function ico(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const index = 6 + i * 16;
    header[index] = size === 256 ? 0 : size;
    header[index + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, index + 4);
    header.writeUInt16LE(32, index + 6);
    header.writeUInt32LE(png.length, index + 8);
    header.writeUInt32LE(offset, index + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map(entry => entry.png)]);
}
function generateRasters() {
  for (const dir of [path.join(ROOT, 'png'), UI, DESKTOP]) fs.mkdirSync(dir, { recursive: true });
  const icon = fs.readFileSync(path.join(ROOT, 'logo-icon.svg'), 'utf8');
  for (const size of [16, 32, 48, 64, 128, 192, 256, 512, 1024]) {
    fs.writeFileSync(path.join(ROOT, `png/logo-icon-${size}.png`), render(icon, size));
  }
  for (const name of ['horizontal', 'horizontal-dark', 'stacked', 'stacked-dark']) {
    const source = fs.readFileSync(path.join(ROOT, `logo-${name}.svg`), 'utf8');
    const width = Number(source.match(/width="(\d+)"/)[1]);
    fs.writeFileSync(path.join(ROOT, `png/logo-${name}@2x.png`), render(source, width * 2));
  }
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), ico([16, 32, 48].map(size => ({ size, png: render(icon, size) }))));
  for (const name of fs.readdirSync(ROOT).filter(name => name.endsWith('.svg') || name === 'favicon.ico')) {
    fs.copyFileSync(path.join(ROOT, name), path.join(UI, name));
  }
  for (const size of [64, 128]) fs.copyFileSync(path.join(ROOT, `png/logo-icon-${size}.png`), path.join(UI, `logo-icon-${size}.png`));
  fs.copyFileSync(path.join(ROOT, 'png/logo-icon-1024.png'), path.join(DESKTOP, 'source.png'));
  console.log('Rendered brand PNGs, favicon, web assets, and desktop source.png.');
}
module.exports = { render, ico, generateRasters };
if (require.main === module) generateRasters();
