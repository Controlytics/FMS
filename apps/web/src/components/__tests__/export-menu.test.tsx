import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { renderPage, mockApi, type MockApi } from '@/test-utils/page-harness';
import { ExportMenu } from '../ExportMenu';
import { expectAllControlsNamed } from './support/a11y';

/**
 * The role-gated export control, driven by the REAL useExportOptions ->
 * `/api/config/export-options/current` path (only fetch is stubbed). The
 * rejection backstop has its own suite (export-menu-backstop.test.tsx).
 */

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  api.restore();
  vi.restoreAllMocks();
});

/** Renders and waits until the role's export matrix has been applied. */
async function show(matrix: Record<string, string>, ui: React.ReactElement) {
  api = mockApi([{ path: '/api/config/export-options/current', body: matrix }]);
  const view = renderPage(ui, { api, user: { role: 'OPERATOR' } });
  await waitFor(() => expect(api.calls('GET', '/api/config/export-options/current')).toHaveLength(1));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  return view;
}

describe('ExportMenu', () => {
  it('both formats allowed -> a dropdown that offers PDF and Excel and runs the chosen one', async () => {
    const pdf = vi.fn();
    const excel = vi.fn();
    await show({}, <ExportMenu surface="audit" onExportPdf={pdf} onExportExcel={excel} />);
    expect(screen.queryByRole('button', { name: /Export as PDF/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(excel).toHaveBeenCalledTimes(1);
    expect(pdf).not.toHaveBeenCalled();
    // Choosing closes the menu.
    expect(screen.queryByRole('button', { name: /Export as PDF/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(pdf).toHaveBeenCalledTimes(1);
  });

  it('the trigger toggles the menu, and a click outside closes it', async () => {
    await show({}, <div><p>elsewhere</p><ExportMenu surface="audit" onExportPdf={vi.fn()} onExportExcel={vi.fn()} /></div>);
    const trigger = screen.getByRole('button', { name: 'Export' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: /Export as PDF/ })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: /Export as PDF/ })); // inside: stays open
    expect(screen.getByRole('button', { name: /Export as PDF/ })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('button', { name: /Export as PDF/ })).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('button', { name: /Export as PDF/ })).toBeNull();
  });

  it('a "PDF only" role sees a single PDF button even when an Excel handler exists', async () => {
    const pdf = vi.fn();
    const excel = vi.fn();
    await show({ audit: 'PDF' }, <ExportMenu surface="audit" onExportPdf={pdf} onExportExcel={excel} />);
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }));
    expect(pdf).toHaveBeenCalledTimes(1);
    expect(excel).not.toHaveBeenCalled();
  });

  it('an "Excel only" role sees a single Excel button', async () => {
    const excel = vi.fn();
    await show({ audit: 'EXCEL' }, <ExportMenu surface="audit" onExportPdf={vi.fn()} onExportExcel={excel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export as Excel' }));
    expect(excel).toHaveBeenCalledTimes(1);
  });

  it('a page that only wires one handler gets that single button', async () => {
    const excel = vi.fn();
    await show({}, <ExportMenu surface="filters" onExportExcel={excel} />);
    expect(screen.getByRole('button', { name: 'Export as Excel' })).toBeInTheDocument();
  });

  it('renders nothing for NONE, or when the allowed format has no handler', async () => {
    const { container, unmount } = await show({ audit: 'NONE' }, <ExportMenu surface="audit" onExportPdf={vi.fn()} onExportExcel={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    const second = await show({ audit: 'PDF' }, <ExportMenu surface="audit" onExportExcel={vi.fn()} />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it('the matrix is per surface: another page\'s restriction does not apply', async () => {
    await show({ audit: 'NONE' }, <ExportMenu surface="pm" onExportPdf={vi.fn()} onExportExcel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('busy disables the control and says "Exporting…" (both variants)', async () => {
    const pdf = vi.fn();
    const { unmount } = await show({ audit: 'PDF' }, <ExportMenu surface="audit" onExportPdf={pdf} busy />);
    const single = screen.getByRole('button', { name: 'Exporting…' });
    expect(single).toBeDisabled();
    fireEvent.click(single);
    expect(pdf).not.toHaveBeenCalled();
    unmount();
    await show({}, <ExportMenu surface="audit" onExportPdf={vi.fn()} onExportExcel={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  });

  it('a caller className replaces the default trigger styling', async () => {
    await show({ audit: 'PDF' }, <ExportMenu surface="audit" onExportPdf={vi.fn()} className="my-btn" />);
    expect(screen.getByRole('button', { name: 'Export as PDF' })).toHaveAttribute('class', 'my-btn');
  });

  it('a handler that resolves is not logged', async () => {
    const pdf = vi.fn(() => Promise.resolve('done'));
    await show({ audit: 'PDF' }, <ExportMenu surface="audit" onExportPdf={pdf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(pdf).toHaveBeenCalledTimes(1);
  });

  // A11Y-UI-5: the dropdown trigger exposes its open state and what it controls
  // (disclosure pattern — the choices stay buttons, so no menu role / haspopup).
  it('the dropdown trigger reports aria-expanded and controls the choices panel; every control has a name', async () => {
    const { container } = await show({}, <ExportMenu surface="audit" onExportPdf={vi.fn()} onExportExcel={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Export' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toContainElement(screen.getByRole('button', { name: /Export as PDF/ }));
    expectAllControlsNamed(container);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
