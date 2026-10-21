import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { usePageTestLifecycle } from '../../../__tests__/fm-test-kit';
import { HierarchyCanvas, type HierarchyCanvasProps } from '../HierarchyCanvas';
import { renderChildrenConnector, FilterDiagNode } from '../HierarchyDiagram';

usePageTestLifecycle();

const BLOCK = { id: 'b1', name: 'Block A' };
const CHILDREN: HierarchyCanvasProps['children'] = [
  { id: 'ar1', name: 'Area North', type: 'area', ahus: [
    { id: 'a1', name: 'AHU-1', filters: [
      { id: 'f1', name: 'FLT-001', currentLifecycleState: 'DRY_IN', filterSet: 'SET_A' },
      { id: 'f2', name: 'FLT-002', currentLifecycleState: null, filterSet: null },
    ] },
  ] },
  { id: 'ar2', name: 'Area Empty', type: 'area' },
  { id: 'a2', name: 'AHU-2', type: 'ahu', filters: [
    { id: 'f3', name: 'FLT-003', currentLifecycleState: 'QUARANTINE_HOLD', filterSet: 'SET_B' },
  ] },
  { id: 'a3', name: 'AHU-3', type: 'ahu' },
];
const IDS = new Map<string, any[]>([
  ['f1', [{ identifierType: 'BARCODE', identifierValue: 'BC-1' }, { identifierType: 'RFID', identifierValue: 'E200F1' }]],
  ['f3', [{ identifierType: 'BARCODE', identifierValue: 'BC-3' }]],
]);
const ALL = { canCreate: true, canEditHierarchy: true, canDeleteHierarchy: true };
const NONE = { canCreate: false, canEditHierarchy: false, canDeleteHierarchy: false };

function renderCanvas(perms = ALL, children = CHILDREN) {
  const handlers = { onNavigate: vi.fn(), onAddChild: vi.fn(), onEditNode: vi.fn(), onDeleteNode: vi.fn() };
  const onAddBlockChild = vi.fn();
  const view = render(<HierarchyCanvas block={BLOCK} children={children} identifiersByAsset={IDS} perms={perms} handlers={handlers} onAddBlockChild={onAddBlockChild} />);
  return { ...view, handlers, onAddBlockChild };
}

const nodeBtn = (name: string) => screen.getAllByText(name).map((n) => n.closest('button')!).find(Boolean)!;
const scroller = (c: HTMLElement) => c.querySelector('[data-no-drag-pan]') as HTMLDivElement;

describe('HierarchyCanvas — tree', () => {
  it('draws Block → Areas/AHUs → Filters with lifecycle labels, RFID and set', () => {
    renderCanvas();
    expect(screen.getByText('Hierarchy')).toBeInTheDocument();
    expect(screen.getAllByText('Block A')).toHaveLength(2); // title strip + block node
    ['Area North', 'Area Empty', 'AHU-1', 'AHU-2', 'AHU-3', 'FLT-001', 'FLT-002', 'FLT-003'].forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
    const f1 = nodeBtn('FLT-001');
    expect(f1).toHaveTextContent('Dry In');
    expect(f1).toHaveTextContent('E200F1'); // RFID, not the barcode
    expect(f1).not.toHaveTextContent('BC-1');
    expect(f1).toHaveTextContent('SET A');
    expect(nodeBtn('FLT-002')).toHaveTextContent('To Be Cleaned');
    const f3 = nodeBtn('FLT-003');
    expect(f3).toHaveTextContent('QUARANTINE HOLD');
    expect(f3).not.toHaveTextContent('BC-3');
    expect(f3).toHaveTextContent('SET B');
  });

  it('clicking a node navigates with its type, id and name', () => {
    const { handlers } = renderCanvas();
    fireEvent.click(nodeBtn('Area North'));
    fireEvent.click(nodeBtn('AHU-2'));
    fireEvent.click(nodeBtn('FLT-001'));
    fireEvent.click(screen.getAllByText('Block A')[1].closest('button')!);
    expect(handlers.onNavigate.mock.calls).toEqual([
      ['area', 'ar1', 'Area North'], ['ahu', 'a2', 'AHU-2'], ['filter', 'f1', 'FLT-001'], ['block', 'b1', 'Block A'],
    ]);
  });

  it('with create/edit/delete rights: add, edit and delete controls reach their handlers without navigating', () => {
    const { handlers, onAddBlockChild } = renderCanvas();
    fireEvent.click(screen.getByTitle('Add Area'));
    const addAhu = screen.getAllByTitle('Add AHU'); // block + each area
    expect(addAhu).toHaveLength(3);
    fireEvent.click(addAhu[0]);
    expect(onAddBlockChild.mock.calls).toEqual([
      [{ type: 'area', parentId: 'b1', parentName: 'Block A' }],
      [{ type: 'ahu', parentId: 'b1', parentName: 'Block A' }],
    ]);
    fireEvent.click(addAhu[1]);
    expect(handlers.onAddChild).toHaveBeenCalledWith({ type: 'ahu', parentId: 'ar1', parentName: 'Area North' });
    fireEvent.click(screen.getAllByTitle('Edit Area')[0]);
    fireEvent.click(screen.getAllByTitle('Delete Area')[1]);
    fireEvent.click(screen.getAllByTitle('Edit AHU')[0]);
    fireEvent.click(screen.getAllByTitle('Delete AHU')[2]);
    expect(handlers.onEditNode.mock.calls).toEqual([[{ id: 'ar1', name: 'Area North', entityType: 'Area' }], [{ id: 'a1', name: 'AHU-1', entityType: 'AHU' }]]);
    expect(handlers.onDeleteNode.mock.calls).toEqual([[{ id: 'ar2', name: 'Area Empty', entityType: 'Area' }], [{ id: 'a3', name: 'AHU-3', entityType: 'AHU' }]]);
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it('without rights: no add / edit / delete controls at all', () => {
    renderCanvas(NONE);
    for (const t of ['Add Area', 'Add AHU', 'Edit Area', 'Delete Area', 'Edit AHU', 'Delete AHU']) expect(screen.queryByTitle(t)).toBeNull();
  });

  it('a block with no children draws just the block', () => {
    renderCanvas(ALL, []);
    expect(screen.getAllByText('Block A')).toHaveLength(2);
    expect(screen.queryByText('Area North')).toBeNull();
  });
});

describe('HierarchyDiagram helpers', () => {
  it('renderChildrenConnector: nothing for no children, a single drop for one, a bus for many', () => {
    expect(renderChildrenConnector([])).toBeNull();
    const one = render(<div data-testid="one">{renderChildrenConnector([<span key="a">only</span>])}</div>);
    expect(within(one.getByTestId('one')).getByText('only')).toBeInTheDocument();
    expect(one.getByTestId('one').querySelectorAll('.absolute.top-0')).toHaveLength(0);
    one.unmount();
    const many = render(<div data-testid="many">{renderChildrenConnector(['a', 'b', 'c'].map((k) => <span key={k}>{k}</span>))}</div>);
    const bus = Array.from(many.getByTestId('many').querySelectorAll('.absolute.top-0')).map((el) => el.className);
    expect(bus).toHaveLength(3);
    expect(bus[0]).toContain('left-1/2 right-0');
    expect(bus[1]).toContain('left-0 right-0');
    expect(bus[2]).toContain('left-0 right-1/2');
  });

  it('a filter with no identifiers entry still renders', () => {
    render(<FilterDiagNode filter={{ id: 'zz', name: 'FLT-ZZ', currentLifecycleState: 'WASH_IN' }} identifiersByAsset={new Map()} onNavigate={vi.fn()} />);
    expect(nodeBtn('FLT-ZZ')).toHaveTextContent('Wash In');
  });
});

describe('HierarchyCanvas — zoom, center and pan', () => {
  it('zoom steps by 10% between 50% and 150%; the % button resets to 100%', () => {
    const { container } = renderCanvas();
    const scaled = () => (scroller(container).firstElementChild as HTMLElement).style.transform;
    const zoomIn = screen.getByTitle('Zoom in');
    const zoomOut = screen.getByTitle('Zoom out');
    expect(screen.getByTitle('Reset zoom and center')).toHaveTextContent('100%');
    for (let i = 0; i < 6; i++) fireEvent.click(zoomIn);
    expect(screen.getByTitle('Reset zoom and center')).toHaveTextContent('150%');
    expect(zoomIn).toBeDisabled();
    expect(scaled()).toBe('scale(1.5)');
    for (let i = 0; i < 12; i++) fireEvent.click(zoomOut);
    expect(screen.getByTitle('Reset zoom and center')).toHaveTextContent('50%');
    expect(zoomOut).toBeDisabled();
    fireEvent.click(screen.getByTitle('Reset zoom and center'));
    expect(screen.getByTitle('Reset zoom and center')).toHaveTextContent('100%');
    expect(scaled()).toBe('scale(1)');
  });

  it('Center view scrolls horizontally to the middle of the overflow', () => {
    const { container } = renderCanvas();
    const el = scroller(container);
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 1000 });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 400 });
    el.scrollLeft = 0;
    fireEvent.click(screen.getByTitle('Center view'));
    expect(el.scrollLeft).toBe(300);
    // content narrower than the viewport never scrolls negative
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 200 });
    fireEvent.click(screen.getByTitle('Reset zoom and center'));
    expect(el.scrollLeft).toBe(0);
  });

  it('dragging the background pans (after a 4px threshold); a press on a control does not', () => {
    const { container } = renderCanvas();
    const el = scroller(container);
    el.scrollLeft = 200; el.scrollTop = 100;
    expect(el.className).toContain('cursor-grab');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(el, { clientX: 102, clientY: 101 }); // under threshold
    expect(el.className).not.toContain('cursor-grabbing');
    expect(el.scrollLeft).toBe(200);
    fireEvent.mouseMove(el, { clientX: 150, clientY: 130 });
    expect(el.className).toContain('cursor-grabbing');
    expect(el.scrollLeft).toBe(150);
    expect(el.scrollTop).toBe(70);
    fireEvent.mouseUp(el);
    expect(el.className).not.toContain('cursor-grabbing');
    fireEvent.mouseMove(el, { clientX: 300, clientY: 300 }); // no drag in progress
    expect(el.scrollLeft).toBe(150);

    // press on a node button: no pan starts
    fireEvent.mouseDown(nodeBtn('AHU-2'), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(el, { clientX: 200, clientY: 200 });
    expect(el.className).not.toContain('cursor-grabbing');

    // leaving the canvas ends a pan
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(el, { clientX: 120, clientY: 100 });
    expect(el.className).toContain('cursor-grabbing');
    fireEvent.mouseLeave(el);
    expect(el.className).not.toContain('cursor-grabbing');
  });
});

describe('HierarchyCanvas — full screen', () => {
  let fsEl: Element | null = null;
  let webkitFsEl: Element | null = null;
  afterEach(() => {
    fsEl = null; webkitFsEl = null;
    delete (HTMLElement.prototype as any).requestFullscreen;
    delete (HTMLElement.prototype as any).webkitRequestFullscreen;
    delete (document as any).exitFullscreen;
    delete (document as any).webkitExitFullscreen;
    delete (document as any).fullscreenElement;
    delete (document as any).webkitFullscreenElement;
  });
  const defineDocFs = () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => webkitFsEl });
  };

  it('uses the Fullscreen API; the icon follows the browser (incl. leaving with Esc)', async () => {
    defineDocFs();
    (HTMLElement.prototype as any).requestFullscreen = vi.fn(async function (this: Element) { fsEl = this; document.dispatchEvent(new Event('fullscreenchange')); });
    (document as any).exitFullscreen = vi.fn(async () => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')); });
    const { container } = renderCanvas();
    await act(async () => { fireEvent.click(screen.getByTitle('Full screen')); });
    expect((HTMLElement.prototype as any).requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fsEl).toBe(container.firstChild);
    expect(screen.getByTitle('Exit full screen (Esc)')).toBeInTheDocument();
    // real fullscreen: the CSS fallback is NOT applied
    expect((container.firstChild as HTMLElement).className).not.toContain('fixed inset-0 z-50');
    await act(async () => { fireEvent.click(screen.getByTitle('Exit full screen (Esc)')); });
    expect((document as any).exitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Full screen')).toBeInTheDocument();
    // Esc in the browser: fullscreenchange with nothing full screen
    fsEl = container.firstChild as Element;
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByTitle('Exit full screen (Esc)')).toBeInTheDocument();
    fsEl = null;
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByTitle('Full screen')).toBeInTheDocument();
  });

  it('falls back to the webkit-prefixed API', async () => {
    defineDocFs();
    (HTMLElement.prototype as any).webkitRequestFullscreen = vi.fn(async function (this: Element) { webkitFsEl = this; document.dispatchEvent(new Event('webkitfullscreenchange')); });
    (document as any).webkitExitFullscreen = vi.fn(async () => { webkitFsEl = null; document.dispatchEvent(new Event('webkitfullscreenchange')); });
    renderCanvas();
    await act(async () => { fireEvent.click(screen.getByTitle('Full screen')); });
    expect((HTMLElement.prototype as any).webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Exit full screen (Esc)')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTitle('Exit full screen (Esc)')); });
    expect((document as any).webkitExitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('Full screen')).toBeInTheDocument();
  });

  it('when the browser refuses full screen it maximises inside the viewport instead, and toggles back', async () => {
    defineDocFs();
    (HTMLElement.prototype as any).requestFullscreen = vi.fn(async () => { throw new Error('Permissions policy'); });
    const { container } = renderCanvas();
    await act(async () => { fireEvent.click(screen.getByTitle('Full screen')); });
    expect((container.firstChild as HTMLElement).className).toContain('fixed inset-0 z-50');
    expect(screen.getByTitle('Exit full screen (Esc)')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTitle('Exit full screen (Esc)')); });
    expect((container.firstChild as HTMLElement).className).not.toContain('fixed inset-0 z-50');
    expect(screen.getByTitle('Full screen')).toBeInTheDocument();
  });

  it('with no Fullscreen API at all the click is harmless', async () => {
    renderCanvas();
    await act(async () => { fireEvent.click(screen.getByTitle('Full screen')); });
    expect(screen.getByTitle('Full screen')).toBeInTheDocument();
  });
});
