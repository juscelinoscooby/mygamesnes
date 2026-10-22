import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const items = [
  'emulator',
  'sw.js',
  'manifest.webmanifest',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'pix-qr.jpeg',
  'games/games.json',
];

for (const rel of items) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) {
    console.warn(`[prepare] skip missing ${rel}`);
    continue;
  }
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    copyDir(src, dst);
    console.log(`[prepare] dir ${rel}`);
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`[prepare] file ${rel}`);
  }
}

// Capacitor precisa de ambos os manifestos
if (!fs.existsSync(path.join(dist, 'manifest.webmanifest')) && fs.existsSync(path.join(dist, 'manifest.json'))) {
  fs.copyFileSync(path.join(dist, 'manifest.json'), path.join(dist, 'manifest.webmanifest'));
  console.log('[prepare] manifest.json -> manifest.webmanifest');
}

console.log('[prepare] done. dist:', fs.readdirSync(dist).join(', '));
