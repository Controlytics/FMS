import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectEdgePath } from '../edge-detector.js';

describe('detectEdgePath', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    vi.restoreAllMocks();
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  it('returns the standard Edge path on win32 when present', () => {
    setPlatform('win32');
    const fsMock = { existsSync: (p: string) => p.includes('msedge.exe') };
    const result = detectEdgePath({ fs: fsMock as never });
    expect(result).toMatch(/msedge\.exe$/);
  });

  it('honours PUPPETEER_EXECUTABLE_PATH when set', () => {
    setPlatform('win32');
    const override = 'D:\\custom\\edge\\msedge.exe';
    const fsMock = { existsSync: (p: string) => p === override };
    const result = detectEdgePath({ fs: fsMock as never, env: { PUPPETEER_EXECUTABLE_PATH: override } });
    expect(result).toBe(override);
  });

  it('returns chromium path on linux', () => {
    setPlatform('linux');
    const fsMock = { existsSync: (p: string) => p.includes('chromium') };
    const result = detectEdgePath({ fs: fsMock as never });
    expect(result).toMatch(/chromium/);
  });

  it('throws if no browser found on win32', () => {
    setPlatform('win32');
    const fsMock = { existsSync: () => false };
    expect(() => detectEdgePath({ fs: fsMock as never })).toThrow(/No browser found/);
  });

  it('throws if no browser found on linux', () => {
    setPlatform('linux');
    const fsMock = { existsSync: () => false };
    expect(() => detectEdgePath({ fs: fsMock as never })).toThrow(/No browser found/);
  });

  it('throws if PUPPETEER_EXECUTABLE_PATH is set but file missing', () => {
    setPlatform('win32');
    const fsMock = { existsSync: () => false };
    expect(() =>
      detectEdgePath({ fs: fsMock as never, env: { PUPPETEER_EXECUTABLE_PATH: 'C:\\nope.exe' } }),
    ).toThrow(/PUPPETEER_EXECUTABLE_PATH.*nope/i);
  });
});
