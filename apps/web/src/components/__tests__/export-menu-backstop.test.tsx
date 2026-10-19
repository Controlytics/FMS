import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * C-05 backstop — ExportMenu fired its async handlers and dropped the promise,
 * so a handler rejection (a dismissed export password prompt) became an
 * unhandled rejection. Pages report their own failures; the menu must make sure
 * nothing escapes unhandled, stay silent on a cancel, and log anything else.
 */

const flags = { pdf: true, excel: false };
vi.mock('@/hooks/use-export-options', () => ({ useExportOptions: () => flags }));

import { ExportMenu } from '../ExportMenu';

async function unhandledDuring(fn: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const h = (e: unknown) => { seen.push(e); };
  process.on('unhandledRejection', h);
  try { fn(); await new Promise((r) => setTimeout(r, 20)); } finally { process.off('unhandledRejection', h); }
  return seen;
}

afterEach(() => { vi.restoreAllMocks(); flags.pdf = true; flags.excel = false; });

describe('ExportMenu — rejected export handlers', () => {
  it('a cancelled prompt leaves no unhandled rejection and logs nothing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = () => Promise.reject(Object.assign(new Error('cancelled'), { error: 'REAUTH_CANCELLED' }));
    render(<ExportMenu surface="filters" onExportPdf={handler} />);
    const unhandled = await unhandledDuring(() => fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ })));
    expect(unhandled).toEqual([]);
    expect(err).not.toHaveBeenCalled();
  });

  it('any other rejection is logged, not left unhandled (dropdown path too)', async () => {
    flags.excel = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = () => Promise.reject(new Error('disk full'));
    render(<ExportMenu surface="filters" onExportPdf={vi.fn()} onExportExcel={handler} />);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    const unhandled = await unhandledDuring(() => fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ })));
    expect(unhandled).toEqual([]);
    expect(err).toHaveBeenCalledWith('[ExportMenu] export failed', expect.objectContaining({ message: 'disk full' }));
  });
});
