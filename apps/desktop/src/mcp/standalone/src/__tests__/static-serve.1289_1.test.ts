/**
 * TICKET_1289_1 F2 -- static SPA serving (single origin, AC5).
 *
 * Exercises serveStatic() against a synthetic bundle dir: index fallback for
 * deep-link routes, real assets by MIME, missing-asset 404 (not the shell),
 * and the path-traversal guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { serveStatic } from '../static-serve';

/** Minimal fake ServerResponse capturing status/headers/body. */
class FakeRes {
  statusCode = 0;
  headers: Record<string, unknown> = {};
  chunks: Buffer[] = [];
  ended = false;
  writeHead(code: number, headers?: Record<string, unknown>): this {
    this.statusCode = code;
    if (headers) Object.assign(this.headers, headers);
    return this;
  }
  // serveStatic uses fs.createReadStream(...).pipe(res); emulate a Writable.
  write(chunk: Buffer | string): boolean {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }
  end(chunk?: Buffer | string): void {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.ended = true;
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  emit(): boolean {
    return false;
  }
  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function req(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

/** Wait until a piped response has ended (createReadStream is async). */
async function waitEnded(res: FakeRes): Promise<void> {
  for (let i = 0; i < 200 && !res.ended; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('serveStatic (F2 single-origin SPA)', () => {
  let dist: string;

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'webdash-dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html>SPA</html>');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('serves index.html at /', async () => {
    const res = new FakeRes();
    expect(serveStatic(req('/'), res as unknown as http.ServerResponse, dist)).toBe(true);
    await waitEnded(res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('SPA');
    expect(res.headers['Cache-Control']).toBe('no-cache');
  });

  it('serves a real asset with correct MIME + immutable cache', async () => {
    const res = new FakeRes();
    expect(serveStatic(req('/assets/app.js'), res as unknown as http.ServerResponse, dist)).toBe(true);
    await waitEnded(res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/javascript');
    expect(String(res.headers['Cache-Control'])).toContain('immutable');
  });

  it('AC5: deep-link route (no extension) falls back to index.html', async () => {
    const res = new FakeRes();
    expect(serveStatic(req('/guide/agent/123'), res as unknown as http.ServerResponse, dist)).toBe(true);
    await waitEnded(res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('SPA');
  });

  it('a missing ASSET (has extension) returns 404, not the SPA shell', () => {
    const res = new FakeRes();
    expect(serveStatic(req('/assets/missing.js'), res as unknown as http.ServerResponse, dist)).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('SPA');
  });

  it('rejects path traversal outside the bundle root', () => {
    const res = new FakeRes();
    expect(
      serveStatic(req('/../../etc/passwd'), res as unknown as http.ServerResponse, dist),
    ).toBe(true);
    // Either 403 (traversal caught) or 404 (resolved-but-absent); never a 200 leak.
    expect([403, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it('does not handle non-GET/HEAD (returns false so MCP POST routing continues)', () => {
    const res = new FakeRes();
    expect(serveStatic(req('/', 'POST'), res as unknown as http.ServerResponse, dist)).toBe(false);
    expect(res.ended).toBe(false);
  });
});
