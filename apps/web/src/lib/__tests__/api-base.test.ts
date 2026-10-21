import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getApiBase, setApiBase, clearApiBase, normalizeServerUrl, initApiBaseFromStorage } from '../api-base';

describe('api-base', () => {
  beforeEach(() => { localStorage.clear(); delete (window as any).__API_BASE__; });

  it('returns "" when nothing is configured (desktop same-origin default)', () => {
    expect(getApiBase()).toBe('');
  });

  it('setApiBase persists to localStorage and getApiBase returns it', () => {
    setApiBase('https://192.168.1.55:3000');
    expect(getApiBase()).toBe('https://192.168.1.55:3000');
    expect(localStorage.getItem('digilog.serverUrl')).toBe('https://192.168.1.55:3000');
  });

  it('stored value takes precedence over window.__API_BASE__', () => {
    localStorage.setItem('digilog.serverUrl', 'https://stored:3000');
    (window as any).__API_BASE__ = 'https://window:3000';
    expect(getApiBase()).toBe('https://stored:3000');
  });

  it('falls back to window.__API_BASE__ when no stored value', () => {
    (window as any).__API_BASE__ = 'https://window:3000';
    expect(getApiBase()).toBe('https://window:3000');
  });

  it('normalizeServerUrl trims whitespace and strips a trailing slash', () => {
    expect(normalizeServerUrl('  https://x:3000/  ')).toBe('https://x:3000');
  });

  it('normalizeServerUrl throws when the scheme is missing', () => {
    expect(() => normalizeServerUrl('192.168.1.55:3000')).toThrow();
  });

  it('clearApiBase removes stored value and window global', () => {
    setApiBase('https://x:3000');
    clearApiBase();
    expect(getApiBase()).toBe('');
    expect((window as any).__API_BASE__).toBeUndefined();
  });

  it('initApiBaseFromStorage mirrors the stored value into window', () => {
    localStorage.setItem('digilog.serverUrl', 'https://boot:3000');
    initApiBaseFromStorage();
    expect((window as any).__API_BASE__).toBe('https://boot:3000');
  });
});

/**
 * Precedence of the API base (coverage campaign 2026-10-21).
 *
 * Order the app relies on: localStorage `digilog.serverUrl` (the operator's
 * Server Address screen) > window.__API_BASE__ > baked VITE_API_URL > ''.
 * A tablet that already has a stored address must keep it across APK updates.
 *
 * The baked VITE_API_URL tier is NOT exercised here: api-base reads it as
 * `(import.meta as any).env?.VITE_API_URL`, and under this vitest config that
 * cast form resolves to a static env snapshot that `vi.stubEnv` cannot reach
 * (plain `import.meta.env` does see the stub). The only lever is a real env
 * file / process env, which would change the base for every other test. The
 * tiers above it are what decide where a provisioned tablet sends requests.
 */
describe('api-base precedence (stored > window > same-origin)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__API_BASE__;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an empty stored value falls through to window.__API_BASE__', () => {
    localStorage.setItem('digilog.serverUrl', '');
    (window as any).__API_BASE__ = 'https://window:3000';
    expect(getApiBase()).toBe('https://window:3000');
  });

  it('an empty window.__API_BASE__ falls through to same-origin ("") with no baked URL in the test build', () => {
    (window as any).__API_BASE__ = '';
    expect(getApiBase()).toBe('');
  });

  it('a stored value is returned verbatim — getApiBase does not re-normalise what setApiBase already normalised', () => {
    // Only setApiBase writes this key (server-config page + server-discovery), and
    // it normalises first; a hand-written value is used as-is.
    localStorage.setItem('digilog.serverUrl', 'https://raw:3000/');
    expect(getApiBase()).toBe('https://raw:3000/');
  });

  it('falls through to window.__API_BASE__ when localStorage throws (private mode)', () => {
    (window as any).__API_BASE__ = 'https://window:3000';
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(getApiBase()).toBe('https://window:3000');
  });

  it('returns same-origin when localStorage throws and nothing else is configured', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(getApiBase()).toBe('');
  });

  it('setApiBase normalises (trim + trailing slashes) before storing and mirrors it into window', () => {
    expect(setApiBase('  https://10.0.0.5:3000///  ')).toBe('https://10.0.0.5:3000');
    expect(localStorage.getItem('digilog.serverUrl')).toBe('https://10.0.0.5:3000');
    expect((window as any).__API_BASE__).toBe('https://10.0.0.5:3000');
    expect(getApiBase()).toBe('https://10.0.0.5:3000');
  });

  it('setApiBase rejects a value without an http(s) scheme and stores nothing', () => {
    expect(() => setApiBase('ftp://x:21')).toThrow(/full address/);
    expect(() => setApiBase('   ')).toThrow(/full address/);
    expect(localStorage.getItem('digilog.serverUrl')).toBeNull();
    expect((window as any).__API_BASE__).toBeUndefined();
  });

  it('normalizeServerUrl accepts http and upper-case schemes; treats null/undefined as empty', () => {
    expect(normalizeServerUrl('http://a:1')).toBe('http://a:1');
    expect(normalizeServerUrl('HTTPS://A:1/')).toBe('HTTPS://A:1');
    expect(() => normalizeServerUrl(undefined as unknown as string)).toThrow();
    expect(() => normalizeServerUrl(null as unknown as string)).toThrow();
    expect(() => normalizeServerUrl('https://')).toThrow();
  });

  it('setApiBase still sets window.__API_BASE__ when localStorage.setItem throws (quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(setApiBase('https://q:3000')).toBe('https://q:3000');
    expect((window as any).__API_BASE__).toBe('https://q:3000');
    expect(getApiBase()).toBe('https://q:3000');
  });

  it('clearApiBase still clears window.__API_BASE__ when localStorage.removeItem throws', () => {
    (window as any).__API_BASE__ = 'https://w:3000';
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => clearApiBase()).not.toThrow();
    expect((window as any).__API_BASE__).toBeUndefined();
  });

  it('initApiBaseFromStorage never overwrites an existing window.__API_BASE__', () => {
    localStorage.setItem('digilog.serverUrl', 'https://boot:3000');
    (window as any).__API_BASE__ = 'https://already:3000';
    initApiBaseFromStorage();
    expect((window as any).__API_BASE__).toBe('https://already:3000');
  });

  it('initApiBaseFromStorage does nothing when nothing is stored or storage throws', () => {
    initApiBaseFromStorage();
    expect((window as any).__API_BASE__).toBeUndefined();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => initApiBaseFromStorage()).not.toThrow();
    expect((window as any).__API_BASE__).toBeUndefined();
  });
});
