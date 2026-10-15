// AIBuddy Panel — B · 汇流. All SVGs share these hand-built Bezier paths.
const opentype = require('opentype.js');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PATHS = {
  upper: 'M66 0H115C171 0 213 40 213 89C213 103 211 114 207 121C196 113 184 108 170 104C170 82 155 67 134 67H105C81 67 66 50 66 28Z',
  lower: 'M6 278Q0 278 0 272V221C0 179 32 145 82 145C109 145 132 156 144 175C125 187 101 189 84 200C69 210 66 227 66 245V278Z',
  fold: 'M66 278H113C153 278 173 252 173 220C173 207 169 194 161 185C156 215 135 231 108 234C83 237 66 254 66 278Z',
  stream: 'M6 0H66V30C66 76 94 98 139 100C199 103 241 139 241 191C241 243 202 278 144 278H113C153 278 173 252 173 220C173 169 135 136 75 136C29 136 0 110 0 66V6Q0 0 6 0Z',
};
function mark(mono = false) {
  const fill = mono ? '#fff' : '#111111';
  return `<g fill="${fill}">
  <path d="${PATHS.upper}"/>
  <path d="${PATHS.lower}"/>
  <path d="${PATHS.fold}"/>
  <path d="${PATHS.stream}"/></g>`;
}
function svg(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${content}</svg>`;
}
function buildIcon(size = 512) {
  return svg(512, 512, `<rect width="512" height="512" rx="114" fill="#fff"/><g transform="translate(111.4 89.2) scale(1.2)">${mark()}</g>`).replace('width="512" height="512"', `width="${size}" height="${size}"`);
}
function loadFont() {
  const candidates = [process.env.AIBUDDY_BRAND_FONT, 'C:/Windows/Fonts/segoeuib.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
  const file = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!file) throw new Error('Set AIBUDDY_BRAND_FONT to a bold TrueType font path.');
  const data = fs.readFileSync(file);
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
function textPath(font, text, size, x, y, fill) {
  return `<path fill="${fill}" d="${font.getPath(text, x, y, size, { kerning: true }).toPathData(2)}"/>`;
}
function horizontal(font, dark) {
  const width = Math.ceil(300 + font.getAdvanceWidth('AIBuddy', 140) + 40);
  return svg(width, 320, `<g transform="translate(40 49) scale(.8)">${mark(dark)}</g>${textPath(font, 'AIBuddy', 140, 285, 178, dark ? '#f7f7f7' : '#111111')}${textPath(font, 'Panel', 88, 289, 268, dark ? '#bfbfbf' : '#666666')}`);
}
function stacked(font, dark) {
  const width = Math.ceil(Math.max(360, font.getAdvanceWidth('AIBuddy', 84) + 80));
  const line = (text, size, y, fill) => textPath(font, text, size, (width - font.getAdvanceWidth(text, size)) / 2, y, fill);
  return svg(width, 540, `<g transform="translate(${(width - 241) / 2} 24)">${mark(dark)}</g>${line('AIBuddy', 84, 423, dark ? '#f7f7f7' : '#111111')}${line('Panel', 54, 495, dark ? '#bfbfbf' : '#666666')}`);
}
function generate() {
  const font = loadFont();
  fs.mkdirSync(ROOT, { recursive: true });
  const files = {
    'logo-mark.svg': svg(241, 278, mark()),
    'logo-mark-mono.svg': svg(241, 278, mark(true)),
    'logo-icon.svg': buildIcon(),
    'logo-horizontal.svg': horizontal(font, false),
    'logo-horizontal-dark.svg': horizontal(font, true),
    'logo-stacked.svg': stacked(font, false),
    'logo-stacked-dark.svg': stacked(font, true),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, name), content + '\n');
  console.log(`Generated ${Object.keys(files).length} brand SVGs.`);
}
module.exports = { buildIcon, generate };
if (require.main === module) generate();
