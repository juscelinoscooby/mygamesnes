/**
 * scripts/sync-www.js
 * Prepara o diretório www/ com todos os ativos estáticos da PWA para empacotamento pelo Capacitor.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');

const FILES_TO_COPY = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'sample-manual-cfw500.pdf'
];

const DIRS_TO_COPY = [
  'css',
  'js',
  'icons'
];

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

fs.mkdirSync(WWW_DIR, { recursive: true });

for (const file of FILES_TO_COPY) {
  copyRecursive(path.join(ROOT, file), path.join(WWW_DIR, file));
}

for (const dir of DIRS_TO_COPY) {
  copyRecursive(path.join(ROOT, dir), path.join(WWW_DIR, dir));
}

console.log('Diretório www/ sincronizado com sucesso para o Capacitor.');
