/**
 * Production static serving of the built web dashboard SPA (TICKET_1289_1 F2).
 *
 * In production the webui is a single origin: the MCP HTTP server (:7789) serves
 * both `/mcp` (+ `/api/auth/*`, `/mcp/events`) AND the compiled dashboard bundle
 * with an SPA `index.html` fallback -- no second Vite process, no dev-only proxy
 * hop. The dev loop (start-dev.sh: Vite :7790 -> MCP :7789) is unchanged.
 *
 * Security: this only serves files that resolve INSIDE the bundle root (path
 * traversal is rejected). The bind host stays 127.0.0.1 by default (server.ts /
 * TICKET_1265_6 D6); LAN exposure is a separate explicit flag.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';

/**
 * Resolve the built dashboard bundle directory, or null when it is not present
 * (e.g. running in stdio mode, or the bundle was never built). Resolution order:
 *   1. STRATCRAFT_WEBDASH_DIST env (explicit override for packaged installs);
 *   2. the repo layout: apps/web-dashboard/dist, located by walking up from the
 *      compiled server file to the `apps` dir (stable across the src/dist
 *      layout, same technique as db.ts resolveDevDataDir).
 * A directory only counts if it contains `index.html` (a real SPA build).
 */
export function resolveDashboardDist(): string | null {
  const envDir = process.env.STRATCRAFT_WEBDASH_DIST;
  if (envDir && fs.existsSync(path.join(envDir, 'index.html'))) {
    return envDir;
  }
  // Walk up to the `standalone` package root, then to apps/web-dashboard/dist.
  // __dirname is .../apps/desktop/src/mcp/standalone(/src|/dist/src) at runtime.
  let dir = __dirname;
  while (path.basename(dir) !== 'standalone') {
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached fs root without finding it
    dir = parent;
  }
  // standalone -> mcp -> src -> desktop -> apps
  const appsDir = path.join(dir, '..', '..', '..', '..');
  const distDir = path.join(appsDir, 'web-dashboard', 'dist');
  return fs.existsSync(path.join(distDir, 'index.html')) ? distDir : null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Serve a GET request for the SPA out of `distDir`. Returns true if the request
 * was handled (a static asset or the SPA index fallback), false if the caller
 * should continue its own routing (only for non-GET or when distDir is absent).
 *
 * Fallback rule (standard SPA): a request whose resolved path is not an existing
 * file, and which is not an asset request (no file extension), gets `index.html`
 * so client-side deep-link routes refresh correctly (AC5). Asset requests that
 * miss (a `.js`/`.css` 404) return a real 404 -- they must not silently receive
 * HTML, which would mask a broken build.
 */
export function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  distDir: string,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, rel);

  // Path-traversal guard: the resolved path must stay inside distDir.
  const rootWithSep = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;
  if (resolved !== distDir && !resolved.startsWith(rootWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    sendFile(res, resolved, req.method === 'HEAD');
    return true;
  }

  // Missing asset (has a file extension) -> genuine 404, not the SPA shell.
  if (path.extname(rel) !== '') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }

  // SPA deep-link fallback -> index.html.
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    sendFile(res, indexPath, req.method === 'HEAD');
    return true;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}

function sendFile(res: http.ServerResponse, filePath: string, headOnly: boolean): void {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': stat.size,
    // Hashed asset filenames are immutable; index.html must never be cached.
    'Cache-Control': path.basename(filePath) === 'index.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  if (headOnly) {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}
