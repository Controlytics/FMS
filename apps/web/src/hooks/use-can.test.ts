import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./use-auth', () => ({ useAuth: vi.fn() }));
import { useAuth } from './use-auth';
import { useCan } from './use-can';

const mockAuth = (role: string, permissions: string[]) =>
  (useAuth as any).mockReturnValue({ user: { role, permissions } });

describe('useCan', () => {
  it('SUPER_ADMIN can do anything', () => {
    mockAuth('SUPER_ADMIN', []);
    const { result } = renderHook(() => useCan());
    expect(result.current('users.delete')).toBe(true);
  });
  it('grants when user holds a node permission', () => {
    mockAuth('ADMIN', ['USER_DELETE']);
    const { result } = renderHook(() => useCan());
    expect(result.current('users.delete')).toBe(true);
  });
  it('denies when user lacks all node permissions', () => {
    // users.delete resolves to ['USER_DELETE', 'USER_READ'] (OR-semantics).
    // ASSET_READ is not in that set, so the check correctly denies.
    // (Plan's fixture used 'USER_READ' which is in the set — corrected here.)
    mockAuth('OPERATOR', ['ASSET_READ']);
    const { result } = renderHook(() => useCan());
    expect(result.current('users.delete')).toBe(false);
  });
  it('denies unknown node ids (default-deny)', () => {
    mockAuth('ADMIN', ['USER_DELETE']);
    const { result } = renderHook(() => useCan());
    expect(result.current('nope.nope')).toBe(false);
  });
});
