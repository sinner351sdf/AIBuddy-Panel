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
// One source for PWA, adaptive Android icons and launch screens. No Android SDK needed.
function generateMobileRasters(check = false) {
  const icon = fs.readFileSync(path.join(ROOT, 'logo-icon.svg'), 'utf8');
  const inner = icon.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const canvas = (width, height, fraction, circle = false) => {
    const side = Math.min(width, height) * fraction;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${circle ? `<circle cx="${width/2}" cy="${height/2}" r="${width/2}" fill="#fff"/>` : `<rect width="${width}" height="${height}" fill="#fff"/>`}<svg x="${(width-side)/2}" y="${(height-side)/2}" width="${side}" height="${side}" viewBox="0 0 512 512">${inner}</svg></svg>`;
  };
  const outputs = new Map();
  const assets = path.resolve(UI, '../assets');
  for (const size of [180, 192, 512]) outputs.set(path.join(assets, `app-icon-${size}.png`), render(icon, size));
  // Entire mark fits the 80% maskable safe circle, including its corners.
  outputs.set(path.join(assets, 'app-icon-maskable-512.png'), render(canvas(512, 512, .55), 512));
  const res = path.resolve(ROOT, '../../desktop-tauri/mobile/android/app/src/main/res');
  for (const [density, scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]) {
    const folder = path.join(res, `mipmap-${density}`), size=48*scale, foreground=108*scale;
    outputs.set(path.join(folder,'ic_launcher.png'),render(icon,size));
    outputs.set(path.join(folder,'ic_launcher_round.png'),render(canvas(size,size,.64,true),size));
    outputs.set(path.join(folder,'ic_launcher_foreground.png'),render(canvas(foreground,foreground,.55),foreground));
  }
  const splashes = {drawable:[480,320], 'drawable-land-mdpi':[480,320], 'drawable-land-hdpi':[800,480], 'drawable-land-xhdpi':[1280,720], 'drawable-land-xxhdpi':[1600,960], 'drawable-land-xxxhdpi':[1920,1280], 'drawable-port-mdpi':[320,480], 'drawable-port-hdpi':[480,800], 'drawable-port-xhdpi':[720,1280], 'drawable-port-xxhdpi':[960,1600], 'drawable-port-xxxhdpi':[1280,1920]};
  for (const [folder,[width,height]] of Object.entries(splashes)) outputs.set(path.join(res,folder,'splash.png'),render(canvas(width,height,.24),width));
  outputs.set(path.join(res,'drawable/ic_launcher_background.xml'),Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#FFFFFF"/></shape>\n'));
  const differences=[];
  for(const [file,bytes] of outputs) {
    if(check) { if(!fs.existsSync(file)||!fs.readFileSync(file).equals(bytes)) differences.push(path.relative(ROOT,file)); }
    else { fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes); }
  }
  if(differences.length) throw new Error('Mobile brand assets differ from source: '+differences.join(', '));
  console.log(`${check?'Verified':'Generated'} ${outputs.size} mobile/PWA/Android brand assets.`);
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
  generateMobileRasters();
  console.log('Rendered brand PNGs, favicon, web assets, and desktop source.png.');
}
module.exports = { render, ico, generateRasters, generateMobileRasters };
if (require.main === module) {
  if (process.argv.includes('--check-mobile')) generateMobileRasters(true);
  else if (process.argv.includes('--mobile')) generateMobileRasters();
  else generateRasters();
}
