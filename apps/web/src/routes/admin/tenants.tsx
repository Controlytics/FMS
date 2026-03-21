import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';

interface Tenant {
  id: string; name: string; slug: string; contactEmail: string;
  plan: string; maxUsers: number; maxDevices: number; maxOrganizations: number;
  isActive: boolean; userCount: number; deviceCount: number; organizationCount: number;
  createdAt: string;
}

export default function TenantsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', contactEmail: '', plan: 'FREE', maxUsers: 10, maxDevices: 50, maxOrganizations: 5 });

  const { data, mutate } = useSWR<{ data: Tenant[]; total: number }>(
    `/api/super-admin/tenants?page=1&limit=50${search ? `&search=${search}` : ''}`
  );

  const createTenant = async () => {
    await api.post('/api/super-admin/tenants', form);
    setShowCreate(false);
    setForm({ name: '', slug: '', contactEmail: '', plan: 'FREE', maxUsers: 10, maxDevices: 50, maxOrganizations: 5 });
    mutate();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/api/super-admin/tenants/${id}`, { isActive: !isActive });
    mutate();
  };

  if (user?.role !== 'SUPER_ADMIN') return <div className="p-6">Access denied</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-gray-500">Manage platform tenants (companies)</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Create Tenant
        </button>
      </div>

      <input type="text" placeholder="Search tenants..." value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 border rounded-lg" />

      {showCreate && (
        <div className="bg-white border rounded-lg p-6 space-y-4 shadow-lg">
          <h2 className="text-lg font-semibold">New Tenant</h2>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Company Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="px-3 py-2 border rounded" />
            <input placeholder="Slug (url-safe)" value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})} className="px-3 py-2 border rounded" />
            <input placeholder="Contact Email" value={form.contactEmail} onChange={e => setForm({...form, contactEmail: e.target.value})} className="px-3 py-2 border rounded" />
            <select value={form.plan} onChange={e => setForm({...form, plan: e.target.value})} className="px-3 py-2 border rounded">
              <option value="FREE">Free</option>
              <option value="STARTER">Starter</option>
              <option value="PROFESSIONAL">Professional</option>
              <option value="ENTERPRISE">Enterprise</option>
            </select>
            <input type="number" placeholder="Max Users" value={form.maxUsers} onChange={e => setForm({...form, maxUsers: +e.target.value})} className="px-3 py-2 border rounded" />
            <input type="number" placeholder="Max Devices" value={form.maxDevices} onChange={e => setForm({...form, maxDevices: +e.target.value})} className="px-3 py-2 border rounded" />
          </div>
          <div className="flex gap-2">
            <button onClick={createTenant} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Tenant</th>
              <th className="px-4 py-3 text-left font-medium">Plan</th>
              <th className="px-4 py-3 text-center font-medium">Users</th>
              <th className="px-4 py-3 text-center font-medium">Devices</th>
              <th className="px-4 py-3 text-center font-medium">Orgs</th>
              <th className="px-4 py-3 text-center font-medium">Status</th>
              <th className="px-4 py-3 text-center font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data?.data.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-gray-400">{t.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    t.plan === 'ENTERPRISE' ? 'bg-purple-100 text-purple-700' :
                    t.plan === 'PROFESSIONAL' ? 'bg-blue-100 text-blue-700' :
                    t.plan === 'STARTER' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>{t.plan}</span>
                </td>
                <td className="px-4 py-3 text-center">{t.userCount}/{t.maxUsers}</td>
                <td className="px-4 py-3 text-center">{t.deviceCount}/{t.maxDevices}</td>
                <td className="px-4 py-3 text-center">{t.organizationCount}/{t.maxOrganizations}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded text-xs ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(t.id, t.isActive)}
                    className={`px-3 py-1 rounded text-xs ${t.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                    {t.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && <div className="px-4 py-3 bg-gray-50 text-sm text-gray-500">Total: {data.total} tenants</div>}
      </div>
    </div>
  );
}
