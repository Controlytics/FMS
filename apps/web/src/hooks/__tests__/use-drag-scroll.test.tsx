/**
 * App-wide grab-to-pan for wide tables. jsdom has no layout, so each test gives the
 * scroll container its geometry (scrollWidth / clientWidth / getBoundingClientRect)
 * and dispatches pointer events as MouseEvents carrying a `pointerType` — jsdom 25
 * does not construct PointerEvent with that field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useDragScroll } from '../use-drag-scroll';

function pointer(target: Element, type: string, init: { x?: number; y?: number; pointerType?: string; button?: number } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0, button: init.button ?? 0 });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' });
  target.dispatchEvent(ev);
  return ev;
}

function Table({ onRowClick, cls = 'overflow-x-auto', noPan = false }: { onRowClick?: () => void; cls?: string; noPan?: boolean }) {
  return (
    <div className={cls} data-testid="scroller" {...(noPan ? { 'data-no-drag-pan': '' } : {})}>
      <button data-testid="row" onClick={onRowClick}>row action</button>
    </div>
  );
}

function geometry(el: HTMLElement, { scrollWidth = 2000, clientWidth = 500, bottom = 300 } = {}) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  el.getBoundingClientRect = () => ({ top: 0, left: 0, right: clientWidth, bottom, width: clientWidth, height: bottom, x: 0, y: 0, toJSON: () => ({}) });
  el.scrollLeft = 400;
}

let hook: ReturnType<typeof renderHook>;
beforeEach(() => { hook = renderHook(() => useDragScroll()); });
afterEach(() => { hook.unmount(); });

function mount(props: Parameters<typeof Table>[0] = {}, geo?: Parameters<typeof geometry>[1]) {
  const view = render(<Table {...props} />);
  const scroller = view.getByTestId('scroller');
  geometry(scroller, geo);
  return { scroller, row: view.getByTestId('row') };
}

describe('useDragScroll', () => {
  it('a mouse drag past the threshold pans the container and shows the grabbing cursor', () => {
    const { scroller, row } = mount();
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    const move = pointer(row, 'pointermove', { x: 40, y: 50 });
    expect(scroller.scrollLeft).toBe(460);
    expect(scroller.style.cursor).toBe('grabbing');
    expect(scroller.style.getPropertyValue('user-select')).toBe('none');
    expect(move.defaultPrevented).toBe(true); // no text selection while panning
    pointer(row, 'pointermove', { x: 160, y: 50 });
    expect(scroller.scrollLeft).toBe(340);
  });

  it('releasing restores the cursor and swallows the click that follows a real drag — only that one', () => {
    const onRowClick = vi.fn();
    const { scroller, row } = mount({ onRowClick });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 60, y: 50 });
    pointer(row, 'pointerup', { x: 60, y: 50 });
    expect(scroller.style.cursor).toBe('');
    expect(scroller.style.getPropertyValue('user-select')).toBe('');
    row.click();
    expect(onRowClick).not.toHaveBeenCalled();
    row.click();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('a press that moves less than 5 px is an ordinary click', () => {
    const onRowClick = vi.fn();
    const { scroller, row } = mount({ onRowClick });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    const move = pointer(row, 'pointermove', { x: 97, y: 50 });
    pointer(row, 'pointerup', { x: 97, y: 50 });
    row.click();
    expect(scroller.scrollLeft).toBe(400);
    expect(move.defaultPrevented).toBe(false);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('a drag that ends without a trailing click does not eat the NEXT interaction’s click', () => {
    const onRowClick = vi.fn();
    const { row } = mount({ onRowClick });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 50, y: 50 });
    pointer(row, 'pointerup', { x: 50, y: 50 });
    pointer(row, 'pointerdown', { x: 50, y: 50 }); // fresh press clears the stale suppress flag
    pointer(row, 'pointerup', { x: 50, y: 50 });
    row.click();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['touch input (keeps native momentum scrolling)', { pointerType: 'touch' }],
    ['pen input', { pointerType: 'pen' }],
    ['a right-button press', { button: 2 }],
  ])('ignores %s', (_l, init) => {
    const { scroller, row } = mount();
    pointer(row, 'pointerdown', { x: 100, y: 50, ...init });
    pointer(row, 'pointermove', { x: 20, y: 50, ...init });
    expect(scroller.scrollLeft).toBe(400);
  });

  it('ignores a container that does not overflow horizontally', () => {
    const { scroller, row } = mount({}, { scrollWidth: 500, clientWidth: 500 });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 20, y: 50 });
    expect(scroller.scrollLeft).toBe(400);
  });

  it('ignores a press on the native scrollbar gutter at the bottom edge', () => {
    const { scroller, row } = mount({}, { bottom: 300 });
    pointer(row, 'pointerdown', { x: 100, y: 290 });
    pointer(row, 'pointermove', { x: 20, y: 290 });
    expect(scroller.scrollLeft).toBe(400);
  });

  it('respects the data-no-drag-pan opt-out (e.g. the pipeline editor canvas)', () => {
    const { scroller, row } = mount({ noPan: true });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 20, y: 50 });
    expect(scroller.scrollLeft).toBe(400);
  });

  it('ignores presses outside any scroll container, and also works on .overflow-auto', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    pointer(outside, 'pointerdown', { x: 1, y: 1 });
    pointer(outside, 'pointermove', { x: 90, y: 1 }); // no container captured: nothing to pan
    outside.remove();
    const { scroller, row } = mount({ cls: 'overflow-auto' });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 80, y: 50 });
    expect(scroller.scrollLeft).toBe(420);
  });

  it('pointercancel abandons the pan without swallowing the next click', () => {
    const onRowClick = vi.fn();
    const { scroller, row } = mount({ onRowClick });
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 50, y: 50 });
    pointer(row, 'pointercancel');
    expect(scroller.style.cursor).toBe('');
    pointer(row, 'pointermove', { x: 0, y: 50 });
    expect(scroller.scrollLeft).toBe(450); // further moves no longer pan
    row.click();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('unmounting removes every listener', () => {
    hook.unmount();
    const { scroller, row } = mount();
    pointer(row, 'pointerdown', { x: 100, y: 50 });
    pointer(row, 'pointermove', { x: 20, y: 50 });
    expect(scroller.scrollLeft).toBe(400);
    hook = renderHook(() => undefined);
  });
});
