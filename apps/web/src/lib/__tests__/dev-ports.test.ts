import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readDevPorts } from '../../../dev-ports';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devports-'));
const ini = (text: string) => { const p = path.join(dir, `${Math.random()}.ini`); fs.writeFileSync(p, text); return p; };

describe('readDevPorts (vite.config.ts ← digilog-addresses.ini)', () => {
  it('reads the real repo file', () => {
    const real = path.resolve(__dirname, '../../../../../digilog-addresses.ini');
    if (!fs.existsSync(real)) return;
    const p = readDevPorts(real);
    expect(p.api).toBeGreaterThan(0);
    expect(p.web).toBeGreaterThan(0);
  });

  it('defaults to 3000 / 5175 when the file is missing', () => {
    expect(readDevPorts(path.join(dir, 'missing.ini'))).toEqual({ api: 3000, web: 5175 });
  });

  it('reads [ports] with a BOM, comments and CRLF', () => {
    expect(readDevPorts(ini('\uFEFF; note\r\n[server]\r\naddress = x\r\n[ports]\r\napi = 3443   ; comment\r\nweb=8080\r\n')))
      .toEqual({ api: 3443, web: 8080 });
  });

  it('ignores keys outside [ports] and out-of-range values', () => {
    expect(readDevPorts(ini('[server]\napi = 9999\n[ports]\nweb = 6000\napi = 70000\n'))).toEqual({ api: 3000, web: 6000 });
  });
});
