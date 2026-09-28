// Renders the film to MP4 (or a few stills) with headless Chromium + ffmpeg.
//
//   node render.mjs                      -> a-beautiful-accident.mp4 (1920x1080, 30 fps, AAC audio)
//   node render.mjs --stills 2,17,38,56  -> stills/frame-<t>.jpg
//
// Env: FFMPEG=/path/to/ffmpeg (needs libx264), FONT_DIR=dir of Google Font files
// named by URL path (optional; fonts are fetched from Google otherwise).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;
const FPS = Number(process.env.FPS || 30);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FONT_DIR = process.env.FONT_DIR;
const OUT = process.env.OUT || path.join(here, 'a-beautiful-accident.mp4');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.error('page error:', e.message));
if (FONT_DIR) {
  const fontCss = fs.readFileSync(path.join(FONT_DIR, '..', 'fonts.css'), 'utf8')
    .replace(/https:\/\/fonts\.gstatic\.com\/([^)]+)/g, (_, p) => 'https://fonts.gstatic.com/' + p);
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));
  await page.route('https://fonts.gstatic.com/**', r => {
    const p = new URL(r.request().url()).pathname.slice(1).replace(/\//g, '_');
    const f = path.join(FONT_DIR, p);
    return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  });
}
await page.goto(pathToFileURL(path.join(here, 'index.html')).href);
await page.evaluate(async () => {
  await Promise.all(['italic 600 40px "Cormorant Garamond"', 'italic 500 40px "Cormorant Garamond"', '600 40px Figtree', '800 40px Figtree', '700 40px Figtree', '500 30px Figtree'].map(f => document.fonts.load(f)));
  window.__cv = document.createElement('canvas');
  FILM.setup(window.__cv, 1920);
});
const grab = t => page.evaluate(t => { FILM.draw(t); return window.__cv.toDataURL('image/jpeg', 0.94).split(',')[1]; }, t);

if (stillsArg) {
  const dir = path.join(here, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of stillsArg.split(',').map(Number)) {
    fs.writeFileSync(path.join(dir, `frame-${s.toFixed(2)}.jpg`), Buffer.from(await grab(s), 'base64'));
  }
  await browser.close();
  process.exit(0);
}

console.log('rendering audio…');
const wavB64 = await page.evaluate(async () => {
  const buf = await FILM.renderAudio(48000);
  const n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, 48000, true);
  out.setUint32(28, 48000 * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  let peak = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) peak = Math.max(peak, Math.abs(ch[c][i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) out.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i] * g)) * 32767, true);
  const bytes = new Uint8Array(out.buffer); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
const wavPath = path.join(here, '.audio.wav');
fs.writeFileSync(wavPath, Buffer.from(wavB64, 'base64'));

console.log('rendering frames…');
const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', wavPath,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
const total = Math.round(60 * FPS);
for (let i = 0; i < total; i++) {
  const buf = Buffer.from(await grab(i / FPS), 'base64');
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 150 === 0) console.log(`  ${i}/${total}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
fs.unlinkSync(wavPath);
await browser.close();
console.log('wrote', OUT);
