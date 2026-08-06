#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const discoveryDir = process.env.STRATCRAFT_SERVICE_API_DISCOVERY_DIR;
const mode = process.env.FAKE_SERVICE_RUNTIME_MODE ?? 'healthy';
const exitDelay = Number(process.env.FAKE_SERVICE_RUNTIME_EXIT_MS ?? 0);
const exitCode = Number(process.env.FAKE_SERVICE_RUNTIME_EXIT_CODE ?? 35);
const listenDelay = Number(process.env.FAKE_SERVICE_RUNTIME_LISTEN_DELAY_MS ?? 0);
const keepAlive = setInterval(() => {}, 60_000);

if (process.env.FAKE_SERVICE_RUNTIME_ENV_FILE) {
  fs.writeFileSync(
    process.env.FAKE_SERVICE_RUNTIME_ENV_FILE,
    process.env.STRATCRAFT_WORKER_TRUST_STORE ?? '',
  );
}

if (!discoveryDir) {
  process.stderr.write('[fake-service-api] STRATCRAFT_SERVICE_API_DISCOVERY_DIR is required\n');
  process.exit(64);
}

fs.mkdirSync(discoveryDir, { recursive: true });
const portFile = path.join(discoveryDir, 'api-port');
const tokenFile = path.join(discoveryDir, 'api-token');
const claimFile = path.join(discoveryDir, 'api-runtime.lock');

function removeEvidence() {
  for (const file of [portFile, tokenFile, claimFile]) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

if (mode === 'exit-failure') {
  process.exit(exitCode);
}

if (mode === 'missing') {
  removeEvidence();
} else if (mode === 'invalid') {
  fs.writeFileSync(portFile, 'not-a-port\n');
  fs.writeFileSync(tokenFile, '\n');
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(404);
  response.end();
});

function close(code) {
  clearInterval(keepAlive);
  clearTimeout(listenTimer);
  removeEvidence();
  if (!server.listening) {
    process.exit(code);
  }
  server.close(() => process.exit(code));
}

const listenTimer = setTimeout(() => {
  if (mode === 'healthy' || mode === 'unreachable') {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') process.exit(65);
      fs.writeFileSync(portFile, `${address.port}\n`);
      fs.writeFileSync(tokenFile, 'fixture-token\n');
      fs.writeFileSync(claimFile, JSON.stringify({
        host: 'headless',
        pid: process.pid,
        claimedAtMs: Date.now(),
      }));
      if (mode === 'unreachable') {
        server.close();
      }
    });
  }
}, listenDelay);

process.on('SIGTERM', () => close(0));
process.on('SIGINT', () => close(0));

if (exitDelay > 0) {
  setTimeout(() => close(exitCode), exitDelay);
}
