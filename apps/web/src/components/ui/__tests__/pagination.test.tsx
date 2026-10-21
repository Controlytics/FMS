import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { renderPage, mockApi, type MockApi } from '@/test-utils/page-harness';
import { Pagination } from '../pagination';

/**
 * The one pagination control. Rendered through the page harness so the
 * rows-per-page options come from the REAL `/api/config/pagination/current`
 * path (SWR -> apiClient -> fetch), with only fetch stubbed.
 */

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
  api = mockApi([{ path: '/api/config/pagination/current', body: { limit: 25, count: 3, options: [10, 25, 50] } }]);
});
afterEach(() => {
  cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  api.restore();
  vi.restoreAllMocks();
});

/** Renders, then lets the pagination-config request land (inside act). */
async function show(props: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const onPageChange = vi.fn();
  const onPageSizeChange = props.onPageSizeChange;
  const view = renderPage(
    <Pagination page={1} pageSize={25} totalItems={60} onPageChange={onPageChange} {...props} onPageSizeChange={onPageSizeChange} />,
    { api },
  );
  await waitFor(() => expect(api.calls('GET', '/api/config/pagination/current').length).toBeGreaterThan(0));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  return { ...view, onPageChange };
}

const summary = (c: HTMLElement) => c.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim();
const pageButtons = () => screen.getAllByRole('button').filter((b) => /^\d+$/.test(b.textContent ?? '')).map((b) => b.textContent);

describe('Pagination', () => {
  it('summarises the visible slice', async () => {
    const { container } = await show({ page: 2 });
    expect(summary(container)).toBe('Showing 26–50 of 60');
  });

  it('the last page shows a short slice', async () => {
    const { container } = await show({ page: 3 });
    expect(summary(container)).toBe('Showing 51–60 of 60');
  });

  it('an empty list reads 0–0 and shows no page buttons', async () => {
    const { container } = await show({ totalItems: 0 });
    expect(summary(container)).toBe('Showing 0–0 of 0');
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
  });

  it('a single page shows no page navigation', async () => {
    await show({ totalItems: 25 });
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('lists first, last and the neighbours of the current page, with gaps between', async () => {
    await show({ page: 6, pageSize: 10, totalItems: 130 });
    expect(pageButtons()).toEqual(['1', '5', '6', '7', '13']);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('no gap when the neighbours touch the edges', async () => {
    await show({ page: 2, pageSize: 10, totalItems: 40 });
    expect(pageButtons()).toEqual(['1', '2', '3', '4']);
    expect(screen.queryByText('…')).toBeNull();
  });

  it('marks the current page with the theme colour', async () => {
    await show({ page: 2 });
    const current = screen.getByRole('button', { name: '2' });
    expect(current.style.backgroundColor).toBe('var(--theme-primary)');
    expect(current).toHaveClass('text-white');
    expect(screen.getByRole('button', { name: '1' }).style.backgroundColor).toBe('');
  });

  it('Previous / Next move one page and are disabled at the ends', async () => {
    const first = await show({ page: 1 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(first.onPageChange).toHaveBeenCalledWith(2);
    first.unmount();

    const last = await show({ page: 3 });
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(last.onPageChange).toHaveBeenCalledWith(2);
  });

  it('clicking a page number jumps to it', async () => {
    const { onPageChange } = await show({ page: 1 });
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('clamps an out-of-range page (e.g. after the list shrank) to the last page', async () => {
    const { container, onPageChange } = await show({ page: 99 });
    expect(summary(container)).toBe('Showing 51–60 of 60');
    expect(screen.getByRole('button', { name: '3' }).style.backgroundColor).toBe('var(--theme-primary)');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('clamps a page below 1 to the first page', async () => {
    const { container } = await show({ page: 0 });
    expect(summary(container)).toBe('Showing 1–25 of 60');
  });

  it('no rows selector without onPageSizeChange', async () => {
    await show();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('the rows selector adds the current size to the options (sorted), and resets to page 1 on change', async () => {
    const onPageSizeChange = vi.fn();
    const { onPageChange } = await show({ pageSize: 20, onPageSizeChange });
    const select = screen.getByRole('combobox', { name: /Rows/ }) as HTMLSelectElement;
    // Configured [10,25,50] does not hold the page's 20, so 20 is slotted in — the
    // selector must never render blank.
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['10', '20', '25', '50']);
    expect(select.value).toBe('20');
    fireEvent.change(select, { target: { value: '50' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('uses the configured options from the server once loaded', async () => {
    api = mockApi([{ path: '/api/config/pagination/current', body: { limit: 15, count: 3, options: [15, 30, 60] } }]);
    await show({ pageSize: 30, onPageSizeChange: vi.fn() });
    const select = screen.getByRole('combobox', { name: /Rows/ });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['15', '30', '60']));
  });

  it('an explicit pageSizeOptions prop wins over the config', async () => {
    await show({ pageSize: 5, pageSizeOptions: [5, 100], onPageSizeChange: vi.fn() });
    const select = screen.getByRole('combobox', { name: /Rows/ });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['5', '100']);
  });

  it('passes a className through', async () => {
    const { container } = await show({ className: 'border-t' });
    expect(container.firstElementChild).toHaveClass('border-t');
  });
});
