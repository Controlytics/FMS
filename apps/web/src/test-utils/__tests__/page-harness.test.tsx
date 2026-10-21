import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { mockApi, renderPage, clearGlobalSwrCache, forgetSignedInUser, type MockRequest } from '../page-harness';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';

afterEach(() => { cleanup(); sessionStorage.clear(); });

function Probe() {
  const { data, error } = useSWR<{ items: string[] }>('/api/things?page=1');
  const { user } = useAuth();
  const can = useCan();
  return (
    <div>
      <p>role:{user?.role ?? '-'}</p>
      <p>canExport:{String(can('audit.export'))}</p>
      {error ? <p>error:{String(error.message ?? error.error)}</p> : null}
      {data?.items.map((i) => <p key={i}>{i}</p>)}
      <button onClick={() => apiClient.post('/api/things', { name: 'x' })}>add</button>
    </div>
  );
}

describe('page harness', () => {
  it('serves SWR reads through the real fetcher and exposes the signed-in user to useCan', async () => {
    const api = mockApi([{ path: '/api/things', body: { items: ['alpha', 'beta'] } }]);
    renderPage(<Probe />, { user: { role: 'QA', permissions: ['AUDIT_EXPORT'] }, api });
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(await screen.findByText('role:QA')).toBeInTheDocument();
    expect(screen.getByText('canExport:true')).toBeInTheDocument();
    const read = api.calls('GET', '/api/things')[0];
    expect(read.query.get('page')).toBe('1');
    expect(read.headers.authorization).toBe('Bearer test-token');
  });

  it('records request bodies and reports unmocked calls', async () => {
    const api = mockApi([{ path: '/api/things', body: { items: [] } }, { method: 'POST', path: '/api/things', status: 201, body: (r: MockRequest) => ({ ok: r.json.name }) }]);
    renderPage(<Probe />, { user: { role: 'ADMIN', permissions: [] }, api });
    screen.getByText('add').click();
    await waitFor(() => expect(api.calls('POST', '/api/things')).toHaveLength(1));
    expect(api.calls('POST', '/api/things')[0].json).toEqual({ name: 'x' });
    expect(api.unmatched).toEqual([]);
  });

  it('a server error reaches the page as an error (no silent success)', async () => {
    const api = mockApi([{ path: '/api/things', status: 500, body: { error: 'INTERNAL_ERROR', message: 'boom' } }]);
    renderPage(<Probe />, { user: { role: 'ADMIN' }, api });
    expect(await screen.findByText(/error:/)).toBeInTheDocument();
  });
});

// Options added 2026-10-21 for bug classes the default set-up hid.
function KeySwitcher() {
  const [k, setK] = useState('a');
  const { data } = useSWR<{ v: string }>(`/api/keys/${k}`);
  return (
    <div>
      <p>value:{data?.v ?? '-'}</p>
      <button onClick={() => setK('a')}>A</button>
      <button onClick={() => setK('b')}>B</button>
    </div>
  );
}

describe('page harness options', () => {
  const keyRoutes = () => mockApi([
    { path: '/api/keys/a', body: { v: 'A' } },
    { path: '/api/keys/b', body: { v: 'B' } },
  ]);
  const goA_B_A = async () => {
    expect(await screen.findByText('value:A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(await screen.findByText('value:B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(await screen.findByText('value:A')).toBeInTheDocument();
  };

  it("dedupe: 'production' reuses a recent answer (A -> B -> A asks for A once), as the app does", async () => {
    const api = keyRoutes();
    renderPage(<KeySwitcher />, { user: { role: 'ADMIN' }, api, dedupe: 'production' });
    await goA_B_A();
    expect(api.calls('GET', '/api/keys/a')).toHaveLength(1);
  });

  it('control: the default set-up re-asks on every mount of a key', async () => {
    const api = keyRoutes();
    renderPage(<KeySwitcher />, { user: { role: 'ADMIN' }, api });
    await goA_B_A();
    await waitFor(() => expect(api.calls('GET', '/api/keys/a')).toHaveLength(2));
  });

  it('globalCache: a page refresh through the global mutate(key) reaches the rendered page', async () => {
    await clearGlobalSwrCache();
    let n = 0;
    const api = mockApi([{ path: '/api/things', body: () => ({ items: [`v${++n}`] }) }]);
    renderPage(<Probe />, { user: { role: 'ADMIN' }, api, globalCache: true });
    expect(await screen.findByText('v1')).toBeInTheDocument();
    await act(async () => { await globalMutate('/api/things?page=1'); });
    expect(await screen.findByText('v2')).toBeInTheDocument();
    await clearGlobalSwrCache();
  });

  it('records a multipart body as `form`', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/upload', body: { ok: true } }]);
    const fd = new FormData();
    fd.append('file', new File(['x'], 'schedule.csv'));
    await fetch('/api/upload', { method: 'POST', body: fd });
    const req = api.calls('POST', '/api/upload')[0];
    expect(req.json).toBeUndefined();
    expect((req.form?.get('file') as File).name).toBe('schedule.csv');
  });

  it('forgetSignedInUser drops the cached user useAuth would start from', () => {
    localStorage.setItem('digilog_cached_user', JSON.stringify({ role: 'QA' }));
    forgetSignedInUser();
    expect(localStorage.getItem('digilog_cached_user')).toBeNull();
  });
});
