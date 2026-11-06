import { createReadStream, lstatSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { NOTICE_FILES, normalizeBasePath, STATIC_ENTRIES } from './manifest.mjs';
import { isMain, parseOptions, PROJECT_ROOT, safeChild } from './lib/paths.mjs';

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
});

export function requestPath(raw, basePath = '/') {
  const base = normalizeBasePath(basePath);
  const path = decodeURIComponent(raw.split('?')[0]);
  if (path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || !path.startsWith(base)) throw new Error('Invalid request path.');
  const local = path.slice(base.length) || 'index.html';
  if (local.split('/').some((part) => !part || part.startsWith('.'))) throw new Error('Hidden paths and traversal are not served.');
  const first = local.split('/')[0];
  if (![...STATIC_ENTRIES, ...NOTICE_FILES, 'build-manifest.json'].includes(first)) throw new Error('Path is outside the static allowlist.');
  return local;
}

export function staticServer({ root = PROJECT_ROOT, basePath = '/' } = {}) {
  const base = normalizeBasePath(basePath);
  return createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const raw = request.url ?? '/';
    if (base !== '/' && raw.split('?')[0] === base.slice(0, -1)) {
      response.writeHead(308, { Location: `${base}${raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''}` }).end(); return;
    }
    let path;
    try { path = safeChild(root, requestPath(raw, base)); }
    catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    let stat;
    try { stat = lstatSync(path); if (!stat.isFile()) throw new Error('Not a file'); }
    catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'text/plain; charset=utf-8',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(path);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
}

if (isMain(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), ['preview', 'port', 'host', 'base'], ['preview']);
    if (options.help) console.log('npm run dev [-- --port 4183 --host 127.0.0.1 --base /]\nnpm run preview [-- --port 4184 --base /platform-atlas/]\nPreview requires npm run build. Only allowlisted static files are served.');
    else {
      const port = Number(options.port ?? (options.preview ? 4184 : 4183));
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
      const root = options.preview ? safeChild(PROJECT_ROOT, 'dist') : PROJECT_ROOT;
      try { if (!lstatSync(join(root, 'index.html')).isFile()) throw new Error('Missing entry'); }
      catch { throw new Error('Missing index.html; run npm run build before preview.'); }
      const basePath = normalizeBasePath(options.base);
      const host = options.host ?? '127.0.0.1';
      const server = staticServer({ root, basePath });
      server.on('error', (error) => { console.error(`serve: ${error.message}`); process.exitCode = 1; });
      server.listen(port, host, () => console.log(`${options.preview ? 'Preview' : 'Development'}: http://${host}:${port}${basePath}`));
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
    }
  } catch (error) { console.error(`serve: ${error.message}`); process.exitCode = 1; }
}
