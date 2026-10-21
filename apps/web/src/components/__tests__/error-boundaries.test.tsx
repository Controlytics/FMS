/**
 * ErrorBoundary (app root) and RouteErrorBoundary (per route).
 * A child that throws during render must be replaced by the fallback, which
 * names the error and offers a reload.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../error-boundary';
import { RouteErrorBoundary } from '../route-error-boundary';

function Boom({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

let reload: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.spyOn>;
const realLocation = window.location;
beforeEach(() => {
  reload = vi.fn();
  // jsdom cannot reload; replace location with a stub that records the call.
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
  // React logs every caught render error; silence it but keep the calls to inspect.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(<ErrorBoundary><p>page body</p></ErrorBoundary>);
    expect(screen.getByText('page body')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it('replaces a crashed tree with the fallback, shows the message, and logs it', () => {
    render(<ErrorBoundary><Boom message="Cannot read properties of undefined (reading 'id')" /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of undefined (reading 'id')")).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith('[ErrorBoundary] Caught error:', expect.any(Error), expect.any(String));
  });

  it('"Reload Page" reloads', () => {
    render(<ErrorBoundary><Boom message="x" /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Reload Page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('omits the message block for an error with no message object', () => {
    // getDerivedStateFromError stores whatever was thrown; a null throw leaves error null.
    function ThrowNull(): React.ReactElement { throw null; }
    render(<ErrorBoundary><ThrowNull /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(document.querySelector('pre')).toBeNull();
  });
});

describe('RouteErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(<RouteErrorBoundary><p>route body</p></RouteErrorBoundary>);
    expect(screen.getByText('route body')).toBeInTheDocument();
  });

  it('shows the error message in place of the route', () => {
    render(<RouteErrorBoundary><Boom message="Chunk load failed" /></RouteErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Chunk load failed')).toBeInTheDocument();
  });

  it('falls back to a generic sentence when the error has no message', () => {
    render(<RouteErrorBoundary><Boom message="" /></RouteErrorBoundary>);
    expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
  });

  it('"Reload Page" clears the error and reloads', () => {
    render(<RouteErrorBoundary><Boom message="x" /></RouteErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Reload Page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
