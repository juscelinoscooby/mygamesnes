/**
 * server.js — Servidor HTTP estático local para o TechManual Offline PWA
 * Suporta MIME types completos para ES Modules (.mjs/.js), Web Manifest (.webmanifest),
 * Service Worker (sw.js) e binários PDF.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.apk': 'application/vnd.android.package-archive'
};

const ROOT_DIR = __dirname;
const PORTS = [8080, 3000, 5173, 8000];

function requestHandler(req, res) {
  const safePath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT_DIR, safePath === '/' ? 'index.html' : safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-cache'
  });

  fs.createReadStream(filePath).pipe(res);
}

for (const port of PORTS) {
  const server = http.createServer(requestHandler);
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error(`Erro na porta ${port}:`, err.message);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`TechManual Offline PWA rodando em: http://localhost:${port}`);
  });
}
