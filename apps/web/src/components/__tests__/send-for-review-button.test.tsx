/**
 * SendForReviewButton (coverage campaign 2026-10-21).
 *
 * The feature is switched OFF in code (`SEND_FOR_REVIEW_ENABLED = false`,
 * 2026-06-22): the component must render nothing, never build a snapshot and
 * never fetch the role / user lists it would need for its picker. The dialog
 * and send paths below that flag are unreachable without editing the
 * component, so they are reported as not covered rather than tested.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderPage, mockApi } from '@/test-utils/page-harness';
import { SendForReviewButton } from '../SendForReviewButton';

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SendForReviewButton (feature disabled)', () => {
  it('renders nothing, builds no snapshot and requests nothing', async () => {
    const buildSnapshot = vi.fn(() => ({ title: 'T', sections: [] }));
    const api = mockApi([]);
    const { container } = renderPage(<div data-testid="host"><SendForReviewButton buildSnapshot={buildSnapshot} /></div>, { api });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(container.querySelector('[data-testid="host"]')).toBeEmptyDOMElement();
    expect(buildSnapshot).not.toHaveBeenCalled();
    expect(api.requests).toHaveLength(0);
  });
});
