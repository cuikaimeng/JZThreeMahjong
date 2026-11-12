/**
 * 开发预览服务器（仅浏览器预览用，小程序不依赖）
 * 与 SimpleHTTP 的区别：所有响应带 Cache-Control: no-store，
 * 避免改完代码后浏览器缓存旧模块导致"改动不生效"的假象。
 *
 * 启动：node tools/dev-server.js  → http://localhost:8790/preview/index.html
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8790;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/preview/index.html';
    const file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found: ' + urlPath);
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`dev server: http://localhost:${PORT}/preview/index.html`));
