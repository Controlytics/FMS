import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mockApi, type MockApi } from '@/test-utils/page-harness';

/**
 * createReport / renderSnapshotToPdf drive the REAL jsPDF + jspdf-autotable.
 * The only things replaced are the two browser boundaries jsdom does not have:
 *
 *  - `doc.save()` (FileSaver -> anchor download): recorded instead of downloaded;
 *  - the network (`fetch`, via the page-harness `mockApi`), plus a jsdom `Blob`
 *    for the logo bytes and an `Image` stub that reports natural dimensions —
 *    jsdom never fires load/error on an <img>, so without it loadLogo() hangs.
 *
 * Every `doc.text()` call (ours AND autoTable's cell drawing) is recorded with the
 * page it landed on, so the assertions read what was actually drawn.
 */

interface TextCall { text: string; x: number; y: number; opts?: any; page: number; font: string }
interface DocRecord { doc: any; texts: TextCall[]; images: any[]; saved: string[]; ctorArgs: any[] }

const rec = vi.hoisted(() => ({ docs: [] as DocRecord[], failAddImage: false }));

vi.mock('jspdf', async (importOriginal) => {
  const actual: any = await importOriginal();
  const Real = actual.default ?? actual.jsPDF;
  function RecordingJsPDF(this: unknown, ...args: any[]) {
    const doc = new Real(...args);
    const r: DocRecord = { doc, texts: [], images: [], saved: [], ctorArgs: args };
    const origText = doc.text.bind(doc);
    doc.text = (text: any, x: number, y: number, opts?: any, tr?: any) => {
      const page = doc.getCurrentPageInfo().pageNumber;
      const font = doc.getFont().fontStyle;
      for (const t of Array.isArray(text) ? text : [text]) r.texts.push({ text: String(t), x, y, opts, page, font });
      return origText(text, x, y, opts, tr);
    };
    const origAddImage = doc.addImage.bind(doc);
    doc.addImage = (...a: any[]) => {
      r.images.push(a);
      if (rec.failAddImage) throw new Error('corrupt image');
      return origAddImage(...a);
    };
    // Browser download boundary — FileSaver needs a real browser.
    doc.save = (name: string) => { r.saved.push(name); return doc; };
    rec.docs.push(r);
    return doc;
  }
  return { ...actual, default: RecordingJsPDF, jsPDF: RecordingJsPDF };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_BYTES = readFileSync(resolve(__dirname, '../../../public/logo.jpg'));

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 300;
  naturalHeight = 100;
  static fail = false;
  set src(_v: string) {
    queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
  }
}

const fmt = (d: string) => `FMT(${d.slice(0, 4)})`;

type Mod = typeof import('../pdf-report');
let api: MockApi;
let logoMode: 'ok' | 'notfound' | 'throw' = 'notfound';

/** Fresh module per test — `cachedLogo` is module state. */
async function load(): Promise<Mod> {
  vi.resetModules();
  return import('../pdf-report');
}

function installFetch(routes: Parameters<typeof mockApi>[0] = []) {
  // Explicit routes come first, so they win over the defaults below.
  api = mockApi([
    ...routes,
    { path: '/api/config/branding', body: { companyName: 'Acme Pharma', appName: 'FMS', logoUrl: '/brand/logo.jpg' } },
    { path: '/api/auth/me', body: { username: 'op1', role: 'OPERATOR' } },
    { path: '/api/config/report-signatories/resolved', body: {} },
    { path: '/api/config/report-page-titles/current', body: {} },
  ]);
  const harnessFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith('.jpg')) {
      api.requests.push({ method: 'GET', url, path: url, query: new URLSearchParams(), headers: {}, json: undefined });
      if (logoMode === 'throw') throw new TypeError('network down');
      if (logoMode === 'notfound') return { ok: false, status: 404 } as Response;
      return { ok: true, status: 200, blob: async () => new Blob([LOGO_BYTES], { type: 'image/jpeg' }) } as unknown as Response;
    }
    return harnessFetch(input, init);
  }));
}

const lastDoc = () => rec.docs[rec.docs.length - 1];
/** jspdf-autotable stamps the last table onto the doc; jsPDF's type does not declare it. */
const lastTable = (r: { doc: unknown }) => (r.doc as { lastAutoTable: any }).lastAutoTable;
const texts = () => lastDoc().texts.map((t) => t.text);

beforeEach(() => {
  rec.docs = [];
  rec.failAddImage = false;
  FakeImage.fail = false;
  logoMode = 'notfound';
  vi.stubGlobal('Image', FakeImage);
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('createReport — header identity', () => {
  it('draws the branding company + app name and the title, with no logo when the logo 404s', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'Audit Trail', formatDateTime: fmt });
    expect(texts()).toEqual(expect.arrayContaining(['Acme Pharma', 'FMS', 'Audit Trail']));
    expect(lastDoc().images).toHaveLength(0);
    // No logo -> the identity text starts at the left margin.
    const company = lastDoc().texts.find((t) => t.text === 'Acme Pharma')!;
    expect(company.x).toBe(14);
    // Title is centred on the page.
    const title = lastDoc().texts.find((t) => t.text === 'Audit Trail')!;
    expect(title.x).toBeCloseTo(r.pw / 2);
    expect(title.opts).toMatchObject({ align: 'center' });
    // Portrait A4 by default.
    expect(lastDoc().ctorArgs[0]).toEqual({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    expect(Math.round(r.pw)).toBe(210);
    // It asked for the logo at the branding-configured URL.
    expect(api.requests.some((q) => q.url === '/brand/logo.jpg')).toBe(true);
  });

  it('Report Page Titles overrides (trimmed) win over Branding', async () => {
    installFetch([{ path: '/api/config/report-page-titles/current', body: { companyName: '  Override Co  ', appName: ' Override App ' } }]);
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(texts()).toEqual(expect.arrayContaining(['Override Co', 'Override App']));
    expect(texts()).not.toContain('Acme Pharma');
  });

  it('blank overrides keep the Branding values', async () => {
    installFetch([{ path: '/api/config/report-page-titles/current', body: { companyName: '   ', appName: '' } }]);
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(texts()).toEqual(expect.arrayContaining(['Acme Pharma', 'FMS']));
  });

  it('falls back to the built-in identity when branding and overrides both fail', async () => {
    installFetch([
      { path: '/api/config/branding', status: 500, body: 'not json' },
      { path: '/api/config/report-page-titles/current', status: 500, body: { error: 'X' } },
    ]);
    // Make the branding body unparseable so `.json()` throws.
    const harness = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).endsWith('/api/config/branding')) return { ok: false, json: async () => { throw new SyntaxError('bad'); } } as unknown as Response;
      return (harness as any)(input, init);
    }));
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(texts()).toEqual(expect.arrayContaining(['Controlytics AI Pvt Ltd', 'DigiLog']));
  });

  it('branding with no names keeps the defaults; the default logo path is /logo.jpg', async () => {
    installFetch([{ path: '/api/config/branding', body: {} }]);
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(texts()).toEqual(expect.arrayContaining(['Controlytics AI Pvt Ltd', 'DigiLog']));
    expect(api.requests.some((q) => q.url === '/logo.jpg')).toBe(true);
  });

  it('embeds the logo at 12mm tall keeping its aspect ratio, and shifts the identity text right', async () => {
    logoMode = 'ok';
    installFetch();
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    const [data, kind, x, y, w, h] = lastDoc().images[0];
    expect(String(data)).toMatch(/^data:image\/jpeg;base64,/);
    expect(kind).toBe('JPEG');
    expect([x, y, h]).toEqual([14, 6, 12]);
    expect(w).toBeCloseTo(36); // 300x100 natural -> 3:1 -> 36mm wide
    const company = lastDoc().texts.find((t) => t.text === 'Acme Pharma')!;
    expect(company.x).toBeCloseTo(14 + 36 + 4);
  });

  // 2026-10-23: Branding keeps an uploaded logo as a data: URL (the install
  // baseline ships one). It was fetch()ed like a file - blocked on an installed
  // server by CSP connect-src 'self' - so every PDF printed without its logo.
  it('a data: logo (an uploaded one) is used as is - no network fetch - and embedded as PNG', async () => {
    const dataLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    installFetch([{ path: '/api/config/branding', body: { companyName: 'Acme Pharma', appName: 'FMS', logoUrl: dataLogo } }]);
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith('data:'))).toBe(false);
    const [data, kind] = lastDoc().images[0];
    expect(data).toBe(dataLogo);
    expect(kind).toBe('PNG');
  });

  it('caches the logo: a second report does not fetch it again', async () => {
    logoMode = 'ok';
    installFetch();
    const { createReport } = await load();
    await createReport({ title: 'A', formatDateTime: fmt });
    await createReport({ title: 'B', formatDateTime: fmt });
    expect(api.requests.filter((q) => q.url === '/brand/logo.jpg')).toHaveLength(1);
    expect(rec.docs[1].images).toHaveLength(1);
  });

  it('an image that fails to decode falls back to a 1:1 box', async () => {
    logoMode = 'ok';
    FakeImage.fail = true;
    installFetch();
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    const [, , , , w, h] = lastDoc().images[0];
    expect(w).toBe(12);
    expect(h).toBe(12);
  });

  it('a logo jsPDF rejects is skipped and the text stays at the margin', async () => {
    logoMode = 'ok';
    rec.failAddImage = true;
    installFetch();
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(lastDoc().images).toHaveLength(1);
    expect(lastDoc().texts.find((t) => t.text === 'Acme Pharma')!.x).toBe(14);
  });

  it('a logo the FileReader cannot read is skipped (reader error is caught)', async () => {
    logoMode = 'ok';
    installFetch();
    // jsdom's FileReader cannot be made to fail on a valid Blob — stub just this API.
    vi.stubGlobal('FileReader', class {
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    });
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(lastDoc().images).toHaveLength(0);
    expect(lastDoc().texts.find((t) => t.text === 'Acme Pharma')!.x).toBe(14);
  });

  it('a network failure on the logo is not fatal', async () => {
    logoMode = 'throw';
    installFetch();
    const { createReport } = await load();
    await expect(createReport({ title: 'T', formatDateTime: fmt })).resolves.toBeTruthy();
    expect(lastDoc().images).toHaveLength(0);
  });

  it('wraps a long subtitle and pushes the content cursor down by its line count', async () => {
    installFetch();
    const { createReport } = await load();
    const noSub = await createReport({ title: 'T', formatDateTime: fmt });
    const y0 = noSub.y;
    const long = 'Period: 01/01/2026 → 31/01/2026 · '.repeat(12);
    const withSub = await createReport({ title: 'T', subtitle: long, formatDateTime: fmt });
    const sub = lastDoc().texts.filter((t) => t.text.startsWith('Period:'));
    expect(sub.length).toBeGreaterThan(1);
    // The arrow is transliterated, never drawn as a WinAnsi junk glyph.
    expect(sub.every((t) => !t.text.includes('→'))).toBe(true);
    expect(sub[0].text).toContain('->');
    expect(withSub.y).toBe(y0 + sub.length * 4 + 2);
  });

  it('landscape orientation is passed through', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', orientation: 'landscape', formatDateTime: fmt });
    expect(lastDoc().ctorArgs[0].orientation).toBe('landscape');
    expect(Math.round(r.pw)).toBe(297);
  });
});

describe('createReport — the signed end block and footers', () => {
  it('stamps "Printed By: <username>" + the printed time, then "Page i of n" on every page', async () => {
    sessionStorage.setItem('access_token', 'tok-1');
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.newPage();
    r.save('out.pdf');
    expect(lastDoc().saved).toEqual(['out.pdf']);
    const all = lastDoc().texts;
    const printed = all.find((t) => t.text === 'Printed By: op1')!;
    expect(printed).toBeTruthy();
    expect(printed.font).toBe('bold');
    expect(printed.page).toBe(2); // last page
    const stamp = all.find((t) => t.text.startsWith('Printed Date & Time: '))!;
    expect(stamp.text).toMatch(/^Printed Date & Time: FMT\(\d{4}\)$/);
    expect(stamp.opts).toMatchObject({ align: 'right' });
    expect(all.find((t) => t.text === 'Remarks:')!.page).toBe(2);
    const pages = all.filter((t) => /^Page \d of \d$/.test(t.text));
    expect(pages.map((p) => [p.text, p.page])).toEqual([['Page 1 of 2', 1], ['Page 2 of 2', 2]]);
    expect(pages.every((p) => p.font === 'bold')).toBe(true);
    // Font weight is restored after the bold footer.
    expect(r.doc.getFont().fontStyle).toBe('normal');
    // The /me call carried the session token.
    expect(api.calls('GET', '/api/auth/me')[0].headers.authorization).toBe('Bearer tok-1');
    expect(api.calls('GET', '/api/config/report-signatories/resolved')[0].headers.authorization).toBe('Bearer tok-1');
  });

  it('without a session token the /me + signatory calls carry no Authorization header', async () => {
    installFetch();
    const { createReport } = await load();
    await createReport({ title: 'T', formatDateTime: fmt });
    expect(api.calls('GET', '/api/auth/me')[0].headers.authorization).toBeUndefined();
    expect(api.calls('GET', '/api/config/report-signatories/resolved')[0].headers.authorization).toBeUndefined();
  });

  it('reads the username from a { user } envelope too', async () => {
    installFetch([{ path: '/api/auth/me', body: { user: { username: 'qa7', role: 'QA' } } }]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: qa7');
  });

  it('a failed /me prints "-" rather than a blank attribution', async () => {
    installFetch([{ path: '/api/auth/me', status: 401, body: { error: 'UNAUTHORIZED' } }]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: -');
  });

  it('an empty username on /me prints "-" (never a blank after the label)', async () => {
    installFetch([{ path: '/api/auth/me', body: { username: '', role: '' } }]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: -');
  });

  it('a /me network error also prints "-"', async () => {
    installFetch();
    const harness = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).endsWith('/api/auth/me')) throw new TypeError('offline');
      return (harness as any)(input, init);
    }));
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: -');
  });

  it('uses the role x report signature label configured on Report Signatories (trimmed)', async () => {
    installFetch([{ path: '/api/config/report-signatories/resolved', body: { OPERATOR: { 'audit-trail': '  Reviewed By  ' } } }]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Reviewed By: op1');
  });

  it('falls back to "Printed By" for a report with no label, a blank label, or no reportKey', async () => {
    const sigs = { OPERATOR: { 'audit-trail': '   ' } };
    installFetch([{ path: '/api/config/report-signatories/resolved', body: sigs }]);
    const { createReport } = await load();
    const blank = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    blank.save('a.pdf');
    expect(texts()).toContain('Printed By: op1');
    const other = await createReport({ title: 'T', reportKey: 'filters', formatDateTime: fmt });
    other.save('b.pdf');
    expect(texts()).toContain('Printed By: op1');
    const none = await createReport({ title: 'T', formatDateTime: fmt });
    none.save('c.pdf');
    expect(texts()).toContain('Printed By: op1');
  });

  it('a signatory lookup that fails (non-OK or network) still prints the default label', async () => {
    installFetch([{ path: '/api/config/report-signatories/resolved', status: 403, body: { error: 'FORBIDDEN' } }]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: op1');

    const harness = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('report-signatories')) throw new TypeError('offline');
      return (harness as any)(input, init);
    }));
    const r2 = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    r2.save('y.pdf');
    expect(texts()).toContain('Printed By: op1');
  });

  it('a user with no role gets the default label even when signatories exist', async () => {
    installFetch([
      { path: '/api/auth/me', body: { username: 'norole' } },
      { path: '/api/config/report-signatories/resolved', body: { OPERATOR: { 'audit-trail': 'Approved By' } } },
    ]);
    const { createReport } = await load();
    const r = await createReport({ title: 'T', reportKey: 'audit-trail', formatDateTime: fmt });
    r.save('x.pdf');
    expect(texts()).toContain('Printed By: norole');
  });

  it('explicit signatures replace the role line and print one line each, 5.5mm apart', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({
      title: 'T', formatDateTime: fmt,
      signatures: [
        { label: 'Printed By', value: 'op1' },
        { label: 'Reviewed By', value: 'qa1' },
        { label: 'Approved By', value: 'mgr1' },
      ],
    });
    r.save('x.pdf');
    const lines = lastDoc().texts.filter((t) => / By: /.test(t.text));
    expect(lines.map((l) => l.text)).toEqual(['Printed By: op1', 'Reviewed By: qa1', 'Approved By: mgr1']);
    expect(lines[1].y - lines[0].y).toBeCloseTo(5.5);
    expect(lines[2].y - lines[1].y).toBeCloseTo(5.5);
  });

  it('prints the abbreviation legend above the stamp only when one is passed', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt, legend: [{ abbr: 'NA', meaning: 'Not Applicable' }, { abbr: 'PM', meaning: 'Preventive Maintenance' }] });
    r.save('x.pdf');
    const legend = lastDoc().texts.find((t) => t.text.startsWith('Legend:'))!;
    expect(legend.text).toContain('NA = Not Applicable');
    expect(legend.text).toContain('PM = Preventive Maintenance');
    const printed = lastDoc().texts.find((t) => t.text.startsWith('Printed By'))!;
    expect(legend.y).toBeLessThan(printed.y);

    const r2 = await createReport({ title: 'T', formatDateTime: fmt, legend: [] });
    r2.save('y.pdf');
    expect(lastDoc().texts.some((t) => t.text.startsWith('Legend:'))).toBe(false);
  });

  it('spills the end block onto a fresh page when the content reaches the bottom', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.y = r.ph - 30; // content ends close to the footer
    r.save('x.pdf');
    expect(r.doc.getNumberOfPages()).toBe(2);
    expect(lastDoc().texts.find((t) => t.text === 'Remarks:')!.page).toBe(2);
    expect(texts()).toEqual(expect.arrayContaining(['Page 1 of 2', 'Page 2 of 2']));
  });

  it('keeps the end block on the same page when there is room', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.save('x.pdf');
    expect(r.doc.getNumberOfPages()).toBe(1);
    expect(texts()).toContain('Page 1 of 1');
  });
});

describe('createReport — body helpers', () => {
  it('addSectionTitle draws the title and advances the cursor by 10mm', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    const y0 = r.y;
    r.addSectionTitle('Cycle 1 → Summary');
    const t = lastDoc().texts.find((x) => x.text.startsWith('Cycle 1'))!;
    expect(t.text).toBe('Cycle 1 -> Summary');
    expect(t.x).toBe(17);
    expect(r.y).toBe(y0 + 10);
  });

  it('addTable draws the header + every body cell through autoTable and moves y below the table', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    const y0 = r.y;
    r.addTable({ head: ['Filter', 'Status'], body: [['F-001', 'Done ✓'], ['F-002', '0 → 1']] });
    const drawn = texts();
    expect(drawn).toEqual(expect.arrayContaining(['Filter', 'Status', 'F-001', 'Done Y', 'F-002', '0 -> 1']));
    expect(lastTable(r).finalY).toBeGreaterThan(y0);
    expect(r.y).toBeCloseTo(lastTable(r).finalY + 5);
    // Default 7pt body font and the 2.5mm padding.
    const { settings, styles } = lastTable(r);
    expect(styles.styles.fontSize).toBe(7);
    // 2.5mm all round at the 7pt default — byte-identical to the fixed
    // `cellPadding: 2.5` every report used before the font became configurable (D-UI-1).
    expect(styles.styles.cellPadding).toEqual({ top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 });
    expect(styles.styles.lineWidth).toBeCloseTo(0.2);
    expect(styles.styles.overflow).toBe('linebreak');
    expect(styles.headStyles.fontSize).toBe(7.5);
    expect(styles.headStyles.fillColor).toEqual([30, 58, 95]);
    expect(styles.columnStyles).toEqual({});
    expect(settings.rowPageBreak).toBe('avoid');
    expect(settings.theme).toBe('grid');
  });

  it('a larger table font scales padding, line width and the header size; headColor overrides the fill', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.addTable({ head: ['A'], body: [['1']], fontSize: 9, headColor: [1, 2, 3], columnStyles: { 0: { cellWidth: 40 } } });
    const t = lastTable(r).styles;
    expect(t.styles.fontSize).toBe(9);
    expect(t.styles.cellPadding.top).toBeCloseTo(4.05);
    expect(t.styles.cellPadding.left).toBe(2.5);
    expect(t.styles.lineWidth).toBeCloseTo(0.4);
    expect(t.headStyles.fontSize).toBe(9.5);
    expect(t.headStyles.fillColor).toEqual([1, 2, 3]);
    expect(t.columnStyles).toEqual({ 0: { cellWidth: 40 } });
  });

  it('vertical padding grows linearly above the 7pt default and never drops below 2.5mm', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    const padAt = (fontSize: number) => { r.addTable({ head: ['A'], body: [['1']], fontSize }); return lastTable(r).styles.styles.cellPadding; };
    expect(padAt(7.5).top).toBeCloseTo(2.8875); // deviations report size
    expect(padAt(8).top).toBeCloseTo(3.275);
    expect(padAt(6).top).toBe(2.5);
    expect(padAt(6).bottom).toBe(2.5);
  });

  it('a table that would cross the page bottom starts on a new page', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.y = r.ph - 25; // less than the 20mm a table needs above the 18mm footer zone
    r.addTable({ head: ['A'], body: [['row']] });
    expect(r.doc.getNumberOfPages()).toBe(2);
    expect(lastDoc().texts.find((t) => t.text === 'row')!.page).toBe(2);
  });

  it('addKeyValue lays pairs out in columns, wraps rows and prints "-" for an empty value', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    const y0 = r.y;
    r.addKeyValue([['Filter', 'F-1'], ['AHU', 'AHU-0A'], ['Remarks', '']], 2);
    const label = (s: string) => lastDoc().texts.find((t) => t.text === s)!;
    const colW = (r.pw - 28) / 2;
    expect(label('Filter').x).toBe(14);
    expect(label('AHU').x).toBeCloseTo(14 + colW);
    expect(label('Remarks').x).toBe(14); // third pair wraps to row 2, column 0
    expect(label('Remarks').y).toBe(y0 + 9);
    expect(label('F-1').y).toBe(y0 + 4);
    expect(texts()).toContain('-');
    expect(r.y).toBe(y0 + 9 + 12);
  });

  it('addKeyValue defaults to three columns', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.addKeyValue([['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']]);
    const colW = (r.pw - 28) / 3;
    const at = (s: string) => lastDoc().texts.find((t) => t.text === s)!;
    expect(at('C').x).toBeCloseTo(14 + 2 * colW);
    expect(at('D').x).toBe(14);
    expect(at('D').y).toBe(at('A').y + 9);
  });

  it('checkPageBreak adds a page only when the needed height does not fit', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.checkPageBreak(10);
    expect(r.doc.getNumberOfPages()).toBe(1);
    r.y = r.ph - 20;
    r.checkPageBreak(10);
    expect(r.doc.getNumberOfPages()).toBe(2);
    expect(r.y).toBe(14);
  });

  it('newPage always adds a page and resets the cursor', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.newPage();
    r.newPage();
    expect(r.doc.getNumberOfPages()).toBe(3);
    expect(r.y).toBe(14);
  });

  it('getSnapshot records titles, tables and key/value blocks with the ORIGINAL (non-WinAnsi) text', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'Lifecycle', subtitle: 'Sub', orientation: 'landscape', reportKey: 'cleaning-lifecycle', formatDateTime: fmt });
    r.addSectionTitle('Summary');
    r.addKeyValue([['Filter', 'F → 1']], 2);
    r.addTable({ head: ['Stage'], body: [['Wash → Dry']], fontSize: 8 });
    r.addTable({ head: ['Untitled'], body: [['x']] });
    expect(r.getSnapshot()).toEqual({
      reportType: 'cleaning-lifecycle',
      title: 'Lifecycle',
      subtitle: 'Sub',
      orientation: 'landscape',
      sections: [
        { title: 'Summary', pairs: [['Filter', 'F → 1']], columns: 2 },
        { title: undefined, head: ['Stage'], body: [['Wash → Dry']], columnStyles: undefined, fontSize: 8 },
        { title: undefined, head: ['Untitled'], body: [['x']], columnStyles: undefined, fontSize: undefined },
      ],
    });
  });

  it('the y accessor reads and writes the shared cursor', async () => {
    installFetch();
    const { createReport } = await load();
    const r = await createReport({ title: 'T', formatDateTime: fmt });
    r.y = 123;
    expect(r.y).toBe(123);
    r.addSectionTitle('S');
    expect(r.y).toBe(133);
  });
});

describe('renderSnapshotToPdf', () => {
  it('re-renders every section in order with the full signature chain and saves under the given name', async () => {
    installFetch();
    const { renderSnapshotToPdf } = await load();
    await renderSnapshotToPdf(
      {
        title: 'Deviations', subtitle: 'Jan 2026', orientation: 'landscape',
        sections: [
          { title: 'Totals', pairs: [['Open', '2'], ['Closed', '5']], columns: 2 },
          { head: ['ID', 'Reason'], body: [['D-1', 'Missed PM']], fontSize: 8 },
          { title: 'Detail', head: ['K'], body: [['V']] },
        ],
      },
      [{ label: 'Printed By', value: 'op1' }, { label: 'Approved By', value: 'qa9' }],
      fmt,
      'deviations.pdf',
    );
    const d = lastDoc();
    expect(d.saved).toEqual(['deviations.pdf']);
    expect(d.ctorArgs[0].orientation).toBe('landscape');
    const order = ['Deviations', 'Jan 2026', 'Totals', 'Open', '2', 'Closed', 'ID', 'D-1', 'Missed PM', 'Detail', 'K', 'V', 'Printed By: op1', 'Approved By: qa9'];
    const idx = order.map((s) => d.texts.findIndex((t) => t.text === s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // Explicit signatures win over the role-based single line.
    expect(d.texts.some((t) => t.text === 'Printed By: op1')).toBe(true);
    expect(d.texts.filter((t) => t.text.startsWith('Printed By')).length).toBe(1);
  });
});
