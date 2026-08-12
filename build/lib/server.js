import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const mimeTypes = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mjs': 'application/javascript',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serves `root` over http on an ephemeral port. The site uses root relative
 * urls (/static/..., /src/...) so it has to be served, not opened as file://
 * @param {string} root folder to serve
 * @returns {Promise<{port: number, close: function}>}
 */
export function startServer(root) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = path.join(root, path.normalize(pathname));
    if (!filename.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) {
      filename = path.join(filename, 'index.html');
    }
    fs.promises.readFile(filename).then(content => {
      res.writeHead(200, {
        'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(content);
    }).catch(() => {
      res.writeHead(404, {'content-type': 'text/plain'}).end('not found');
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}
