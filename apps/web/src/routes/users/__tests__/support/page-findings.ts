/**
 * Shared helpers for the admin-pages coverage slice (2026-10-21).
 *
 * Two kinds of finding the page tests collect besides behaviour:
 *   - controls (button / input / select / textarea) with no accessible name,
 *   - console.error / console.warn output a page emits during normal use.
 *
 * Lives under __tests__/ so coverage never counts it as application code.
 */
import { vi } from 'vitest';
import { computeAccessibleName } from 'dom-accessibility-api';
import type { MockRoute } from '@/test-utils/page-harness';

/** Describe a control for a findings line: tag, type, id/name, a bit of markup. */
function describeControl(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type');
  const id = el.getAttribute('id');
  const name = el.getAttribute('name');
  const ph = el.getAttribute('placeholder');
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join(' ');
  return [
    tag + (type ? `[type=${type}]` : ''),
    id ? `#${id}` : '',
    name ? `name=${name}` : '',
    ph ? `placeholder="${ph}"` : '',
    cls ? `class="${cls}"` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Unnamed controls that belong to SHARED components outside this slice and are
 * reported once, not per page:
 *   - the toast close "x" (components/ui/toast.tsx), an svg-only button;
 *   - the show/hide-password eye in the re-auth dialog (components/reauth-dialog.tsx).
 */
function isSharedKnown(el: Element): boolean {
  if (el.tagName === 'BUTTON' && (el.getAttribute('class') ?? '').startsWith('shrink-0 p-0.5 rounded hover:bg-black/5')) return true;
  if (el.tagName === 'BUTTON' && el.getAttribute('tabindex') === '-1'
    && el.parentElement?.querySelector('input[placeholder="Enter your password"]')) return true;
  return false;
}

export interface UnlabeledReport {
  /** No accessible name at all: a screen reader announces just "button" / "edit text". */
  none: string[];
  /** Named only by its placeholder, which disappears once the user types (WCAG 3.3.2). */
  placeholderOnly: string[];
}

/**
 * Every visible control under `root` whose computed accessible name is empty.
 * Hidden inputs and inputs a page deliberately hides (display:none file pickers
 * driven by a labelled button) are skipped: a screen reader never reaches them.
 */
export function unlabeledControls(root: ParentNode = document.body): UnlabeledReport {
  const out: UnlabeledReport = { none: [], placeholderOnly: [] };
  root.querySelectorAll('button, input, select, textarea').forEach((el) => {
    if (el.getAttribute('type') === 'hidden') return;
    if (el.closest('[hidden], [aria-hidden="true"]')) return;
    if ((el as HTMLElement).style?.display === 'none' || el.classList.contains('hidden')) return;
    if (isSharedKnown(el)) return;
    if (computeAccessibleName(el).trim() !== '') return;
    if ((el.getAttribute('placeholder') ?? '').trim() !== '') out.placeholderOnly.push(describeControl(el));
    else out.none.push(describeControl(el));
  });
  return out;
}

/** Messages that are jsdom/test-environment noise, not page behaviour. */
const NOISE = [
  /Not implemented: (navigation|window\.scrollTo|HTMLCanvasElement|window\.print)/i,
];

export interface ConsoleCapture {
  errors: string[];
  warnings: string[];
  restore(): void;
}

/**
 * Spies on console.error / console.warn and records what a page logs. The
 * original output is suppressed so the run stays readable; the test decides
 * whether what was logged is a defect.
 */
export function captureConsole(): ConsoleCapture {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
  const keep = (s: string) => !NOISE.some((re) => re.test(s));
  const e = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { const s = fmt(args); if (keep(s)) errors.push(s); });
  const w = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { const s = fmt(args); if (keep(s)) warnings.push(s); });
  return { errors, warnings, restore: () => { e.mockRestore(); w.mockRestore(); } };
}

/** The `useReauth` SWR feed: which actions this user must sign with a password. */
export function reauthActions(actions: string[] = []): MockRoute {
  return { path: '/api/config/action-reauth/my-actions', body: { actions } };
}

/**
 * Config feeds nearly every page reads through shared hooks
 * (useDatetimeFormat, usePaginationDefaults). Defaults match the server's.
 */
export function commonConfigRoutes(): MockRoute[] {
  return [
    { path: '/api/config/datetime/current', body: { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'UTC' } },
    { path: '/api/config/pagination/current', body: { limit: 20, count: 3, options: [10, 20, 50] } },
  ];
}
