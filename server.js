import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.data': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.smc': 'application/octet-stream',
  '.sfc': 'application/octet-stream',
  '.zip': 'application/zip'
};

function resolveFile(reqPath) {
  const candidates = [
    process.cwd(),
    __dirname,
    path.resolve('.'),
    path.resolve('..')
  ];

  for (const base of candidates) {
    const candidatePath = path.normalize(path.join(base, reqPath));
    try {
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return candidatePath;
      }
    } catch (_) {}
  }
  return null;
}

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = resolveFile(reqPath);

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Arquivo não encontrado: ' + reqPath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Arquivo não encontrado: ' + reqPath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    const isGamesJson = filePath.endsWith(`${path.sep}games${path.sep}games.json`);
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    };

    if (ext === '.js' && path.basename(filePath) === 'sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    if (ext === '.webmanifest' || path.basename(filePath) === 'manifest.json') {
      headers['Content-Type'] = 'application/manifest+json; charset=utf-8';
      headers['Cache-Control'] = 'no-cache, must-revalidate';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🎮 Game Boy SNES Pocket PWA rodando em:`);
  console.log(`   - Local:    http://localhost:${PORT}`);
  console.log(`   - Na Rede:  http://0.0.0.0:${PORT} (acesse pelo celular!)`);
  console.log(`Pressione Ctrl+C para encerrar.`);
});
