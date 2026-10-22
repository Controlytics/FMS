import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyText } from '../clipboard';

// jsdom has neither navigator.clipboard nor document.execCommand; each test sets
// only the one it needs and restores it.
const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
const setExec = (value: unknown) => Object.defineProperty(document, 'execCommand', { value, configurable: true });

afterEach(() => {
  delete (navigator as any).clipboard;
  delete (document as any).execCommand;
});

describe('copyText', () => {
  it('uses the Clipboard API and reports success, without touching the fallback', async () => {
    const writeText = vi.fn(async () => {});
    const exec = vi.fn(() => true);
    setClipboard({ writeText });
    setExec(exec);
    await expect(copyText('Tmp@4821')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Tmp@4821');
    expect(exec).not.toHaveBeenCalled();
  });

  it('a refused write falls back to execCommand("copy") and reports its result', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const exec = vi.fn(() => true);
    setExec(exec);
    await expect(copyText('x')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    exec.mockReturnValue(false);
    await expect(copyText('x')).resolves.toBe(false);
  });

  it('no Clipboard API: the fallback alone decides; it copies the text from a temporary node it removes', async () => {
    let selected = '';
    setExec(vi.fn(() => { selected = (document.querySelector('textarea') as HTMLTextAreaElement).value; return true; }));
    await expect(copyText('redirect-uri')).resolves.toBe(true);
    expect(selected).toBe('redirect-uri');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('nothing available, or the fallback throws: false, never a rejection', async () => {
    await expect(copyText('x')).resolves.toBe(false);
    setExec(vi.fn(() => { throw new Error('SecurityError'); }));
    await expect(copyText('x')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
