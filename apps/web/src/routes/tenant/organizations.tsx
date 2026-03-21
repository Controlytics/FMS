import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';

interface Org {
  id: string; name: string; slug: string; description?: string;
  isActive: boolean; userCount: number; entityCount: number;
  createdAt: string;
}

export default function OrganizationsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });

  const navigate = useNavigate();
  const { data, mutate } = useSWR<{ data: Org[]; total: number }>(
    `/api/tenant/organizations?page=1&limit=50${search ? `&search=${search}` : ''}`
  );

  const createOrg = async () => {
    await api.post('/api/tenant/organizations', form);
    setShowCreate(false);
    setForm({ name: '', slug: '', description: '' });
    mutate();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/api/tenant/organizations/${id}`, { isActive: !isActive });
    mutate();
  };

  const allowed = ['SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN'].includes(user?.role || '');
  if (!allowed) return <div className="p-6">Access denied</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organizations</h1>
          <p className="text-gray-500">Manage organizations within your tenant</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Create Organization
        </button>
      </div>

      <input type="text" placeholder="Search organizations..." value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 border rounded-lg" />

      {showCreate && (
        <div className="bg-white border rounded-lg p-6 space-y-4 shadow-lg">
          <h2 className="text-lg font-semibold">New Organization</h2>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="px-3 py-2 border rounded" />
            <input placeholder="Slug (url-safe)" value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})} className="px-3 py-2 border rounded" />
            <input placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="px-3 py-2 border rounded col-span-2" />
          </div>
          <div className="flex gap-2">
            <button onClick={createOrg} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Organization</th>
              <th className="px-4 py-3 text-center font-medium">Users</th>
              <th className="px-4 py-3 text-center font-medium">Entities</th>
              <th className="px-4 py-3 text-center font-medium">Status</th>
              <th className="px-4 py-3 text-center font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data?.data.map(o => (
              <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/tenant/organizations/${o.id}`)}>
                <td className="px-4 py-3">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-gray-400">{o.slug}{o.description ? ` — ${o.description}` : ''}</div>
                </td>
                <td className="px-4 py-3 text-center">{o.userCount}</td>
                <td className="px-4 py-3 text-center">{o.entityCount}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded text-xs ${o.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {o.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(o.id, o.isActive)}
                    className={`px-3 py-1 rounded text-xs ${o.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                    {o.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && <div className="px-4 py-3 bg-gray-50 text-sm text-gray-500">Total: {data.total} organizations</div>}
      </div>
    </div>
  );
}
