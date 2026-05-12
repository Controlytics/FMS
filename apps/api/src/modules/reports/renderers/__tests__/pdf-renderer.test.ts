import { describe, it, expect, afterAll } from 'vitest';
import { renderPdf, closeBrowser } from '../pdf-renderer.js';

const HAS_BROWSER = (() => {
  try {
    require('node:fs').accessSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    return true;
  } catch {
    return process.platform !== 'win32';
  }
})();

const baseOptions = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: 20, right: 15, bottom: 20, left: 15 },
};

describe.skipIf(!HAS_BROWSER)('renderPdf (smoke against real browser)', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it('produces a non-empty PDF buffer with %PDF- magic bytes', async () => {
    const html = '<!doctype html><html><body><h1>DigiLog test</h1><p>hello</p></body></html>';
    const buffer = await renderPdf(html, baseOptions);
    expect(buffer.length).toBeGreaterThan(1024);
    const magic = buffer.subarray(0, 5).toString('ascii');
    expect(magic).toBe('%PDF-');
  }, 60_000);

  it('renders landscape orientation', async () => {
    const html = '<!doctype html><html><body><h1>landscape</h1></body></html>';
    const buffer = await renderPdf(html, { ...baseOptions, orientation: 'landscape' });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 60_000);
});
