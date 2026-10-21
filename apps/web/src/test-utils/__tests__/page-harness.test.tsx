import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import useSWR from 'swr';
import { mockApi, renderPage, type MockRequest } from '../page-harness';
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
