import fs from 'fs';

/**
 * Dev-server ports from digilog-addresses.ini (repo root) — the ONE file for
 * the server's addresses and ports, applied by apply-addresses.bat and fully
 * parsed/validated by scripts/address-config.ps1. Only [ports] is read here;
 * anything missing, malformed or out of range falls back to 3000 / 5175.
 */
export interface DevPorts { api: number; web: number }

export function readDevPorts(file: string): DevPorts {
  const ports: DevPorts = { api: 3000, web: 5175 };
  if (!fs.existsSync(file)) return ports;
  let section = '';
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s[;#].*$/, '').trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].trim().toLowerCase(); continue; }
    const kv = /^(api|web)\s*=\s*(\d+)$/i.exec(line);
    if (section !== 'ports' || !kv) continue;
    const n = Number(kv[2]);
    if (n >= 1 && n <= 65535) ports[kv[1].toLowerCase() as keyof DevPorts] = n;
  }
  return ports;
}
