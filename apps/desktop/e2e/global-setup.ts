import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  if (process.platform !== 'linux') return;
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    const out = execSync('dbus-launch', { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)/);
      if (m) process.env[m[1]] = m[2];
    }
  }
  try {
    execSync('pkill -u $(id -u) gnome-keyring-daemon', {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // no daemon running — fine
  }
  try {
    execSync('echo "e2e-keyring" | gnome-keyring-daemon --unlock --components=secrets', {
      encoding: 'utf8',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // best-effort: secure-store falls back to base64 when keyring is unavailable
  }
}
