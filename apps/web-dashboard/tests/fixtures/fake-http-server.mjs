#!/usr/bin/env node

import net from 'node:net';

const args = process.argv.slice(2);
const isMcp = args.some((arg) => arg.endsWith('mcp-server.js'));
const role = isMcp ? 'mcp' : 'vite';
const port = Number(args.at(-1));
const exitDelay = Number(
  isMcp ? process.env.FAKE_MCP_EXIT_MS ?? 0 : process.env.FAKE_VITE_EXIT_MS ?? 0,
);
const exitCode = Number(
  isMcp ? process.env.FAKE_MCP_EXIT_CODE ?? 23 : process.env.FAKE_VITE_EXIT_CODE ?? 24,
);
const listenDelay = Number(
  isMcp ? process.env.FAKE_MCP_LISTEN_DELAY_MS ?? 0 : process.env.FAKE_VITE_LISTEN_DELAY_MS ?? 0,
);
const failBeforeListenCode = Number(
  isMcp
    ? process.env.FAKE_MCP_FAIL_BEFORE_LISTEN_CODE ?? 0
    : process.env.FAKE_VITE_FAIL_BEFORE_LISTEN_CODE ?? 0,
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`[fake-${role}] invalid port: ${args.at(-1)}\n`);
  process.exit(64);
}

const server = net.createServer((socket) => socket.end());
if (failBeforeListenCode > 0) {
  process.exit(failBeforeListenCode);
}

const listenTimer = setTimeout(() => {
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`[fake-${role}] listening on ${port}\n`);
  });
}, listenDelay);

const close = (code) => {
  clearTimeout(listenTimer);
  if (!server.listening) {
    process.exit(code);
  }
  server.close(() => process.exit(code));
};

process.on('SIGTERM', () => close(0));
process.on('SIGINT', () => close(0));

if (exitDelay > 0) {
  setTimeout(() => process.exit(exitCode), exitDelay);
}
