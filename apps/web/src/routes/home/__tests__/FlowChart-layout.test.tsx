import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { FlowChart } from '../FlowChart';
import type { FlowStep } from '../types';
import type { RoleAccess } from '../viewer-access';

/**
 * FlowChart's two layouts and the sequence layout's horizontal-scroll cue.
 * jsdom does no layout (scrollWidth/clientWidth are 0), so the overflow
 * metrics are stubbed for the scroll container only and restored afterwards.
 */

const ROLES: RoleAccess[] = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin', hierarchyLevel: 6, color: 'bg-red-500', permissions: [], sidebarItems: [] },
  { name: 'LEAD', displayName: 'Lead', hierarchyLevel: 3, color: 'rgb(99, 102, 241)', permissions: ['DASHBOARD_VIEW', 'FILTER_OPERATE'], sidebarItems: [] },
];

const STEPS: FlowStep[] = [
  { label: 'Start', gate: ['FILTER_OPERATE'], kind: 'action', description: 'Pick a reason' },
  { label: 'Check', gate: ['FILTER_OPERATE'], kind: 'decision', branch: { label: 'Bypass', gate: ['FILTER_BYPASS'] } },
  { label: 'Close', gate: ['AUDIT_DELETE'], kind: 'system' },
];

// Layout metrics for the scroll container (`.overflow-x-auto`); 0 elsewhere.
const metrics = { scrollWidth: 1000, clientWidth: 300 };
const saved: Record<string, PropertyDescriptor | undefined> = {};
function stubLayout() {
  for (const key of ['scrollWidth', 'clientWidth'] as const) {
    saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('overflow-x-auto') ? metrics[key] : 0; },
    });
  }
}
function restoreLayout() {
  for (const key of ['scrollWidth', 'clientWidth']) {
    if (saved[key]) Object.defineProperty(HTMLElement.prototype, key, saved[key]!);
    else delete (HTMLElement.prototype as any)[key];
  }
}
const scroller = (c: HTMLElement) => c.querySelector('.overflow-x-auto') as HTMLElement;
const setScrollLeft = (el: HTMLElement, v: number) => Object.defineProperty(el, 'scrollLeft', { configurable: true, value: v });
const leftFade = (c: HTMLElement) => c.querySelector('.bg-gradient-to-r.from-white');
const rightFade = (c: HTMLElement) => c.querySelector('.bg-gradient-to-l.from-white');

beforeEach(() => { metrics.scrollWidth = 1000; metrics.clientWidth = 300; });
afterEach(() => { cleanup(); restoreLayout(); vi.unstubAllGlobals(); });

describe('FlowChart — actions layout (default)', () => {
  it('renders independent cards: no step numbers, no arrows, no scroll region', () => {
    const { container } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} />);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.queryByText('1')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelector('ol')).toBeNull();
    expect(scroller(container)).toBeNull();
    // a raw rgb() role colour is applied as a style
    expect(screen.getAllByText('Lead')[0]).toHaveStyle({ backgroundColor: 'rgb(99, 102, 241)' });
    // a gate no role holds still shows Super Admin (bypass); the description has a tooltip copy
    expect(screen.getByText('Pick a reason')).toHaveAttribute('title', 'Pick a reason');
  });

  it('a step nobody can perform reads "no role configured"', () => {
    render(<FlowChart steps={[{ label: 'Orphan', gate: ['AUDIT_DELETE'], kind: 'system' }]} moduleId="dashboard" roles={ROLES.slice(1)} />);
    expect(screen.getByText('no role configured')).toBeInTheDocument();
  });

  it('access "authenticated" shows every role that can see the module', () => {
    render(<FlowChart steps={[{ label: 'Read', gate: [], access: 'authenticated', kind: 'system' }]} moduleId="dashboard" roles={ROLES} />);
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
  });
});

describe('FlowChart — sequence layout', () => {
  it('numbers the steps and joins them with one arrow between each pair', () => {
    const { container } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} layout="sequence" />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    const items = container.querySelectorAll('ol > li');
    expect(items).toHaveLength(3);
    // arrow connector (aria-hidden div) after the first two items only
    expect(items[0].querySelectorAll(':scope > div[aria-hidden="true"]')).toHaveLength(1);
    expect(items[2].querySelectorAll(':scope > div[aria-hidden="true"]')).toHaveLength(0);
    // branch card under step 2
    expect(screen.getByText('Bypass')).toBeInTheDocument();
  });

  it('without overflow there is no cue and no fade', () => {
    const { container } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} layout="sequence" />);
    expect(screen.queryByText('Scroll for more')).toBeNull();
    expect(leftFade(container)).toBeNull();
    expect(rightFade(container)).toBeNull();
  });

  it('when the flow overflows: cue + right fade at the start, both fades mid-way, left fade only at the end', () => {
    stubLayout();
    const { container } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} layout="sequence" />);
    const el = scroller(container);
    expect(screen.getByText('Scroll for more')).toBeInTheDocument();
    expect(rightFade(container)).not.toBeNull();
    expect(leftFade(container)).toBeNull();

    setScrollLeft(el, 300);
    fireEvent.scroll(el);
    expect(screen.getByText('Scroll for more')).toBeInTheDocument();
    expect(leftFade(container)).not.toBeNull();
    expect(rightFade(container)).not.toBeNull();

    setScrollLeft(el, 700);
    fireEvent.scroll(el);
    expect(screen.queryByText('Scroll for more')).toBeNull();
    expect(leftFade(container)).not.toBeNull();
    expect(rightFade(container)).toBeNull();
  });

  it('without ResizeObserver, a window resize that makes the flow fit removes the cue; unmount stops listening', () => {
    stubLayout();
    vi.stubGlobal('ResizeObserver', undefined);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} layout="sequence" />);
    expect(screen.getByText('Scroll for more')).toBeInTheDocument();
    metrics.clientWidth = 1200; // wider viewport: everything fits
    fireEvent(window, new Event('resize'));
    expect(screen.queryByText('Scroll for more')).toBeNull();
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('with ResizeObserver, it observes the scroll region, recomputes on a resize callback, and disconnects on unmount', () => {
    stubLayout();
    const instances: { cb: () => void; observed: Element[]; disconnected: boolean }[] = [];
    class FakeRO {
      rec: { cb: () => void; observed: Element[]; disconnected: boolean };
      constructor(cb: () => void) { this.rec = { cb, observed: [], disconnected: false }; instances.push(this.rec); }
      observe(el: Element) { this.rec.observed.push(el); }
      disconnect() { this.rec.disconnected = true; }
    }
    vi.stubGlobal('ResizeObserver', FakeRO);
    const { container, unmount } = render(<FlowChart steps={STEPS} moduleId="dashboard" roles={ROLES} layout="sequence" />);
    expect(instances).toHaveLength(1);
    expect(instances[0].observed).toEqual([scroller(container)]);
    expect(screen.getByText('Scroll for more')).toBeInTheDocument();
    metrics.scrollWidth = 200;
    act(() => instances[0].cb()); // the observer reports a layout change
    expect(screen.queryByText('Scroll for more')).toBeNull();
    unmount();
    expect(instances[0].disconnected).toBe(true);
  });
});
