import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import type { RoleData } from '@digilog/shared';
import { PRESET_COLORS } from './roles-components/role-color-picker';
import { RoleTable } from './roles-components/role-table';
import { RoleFormDialog } from './roles-components/role-form-dialog';
import type { RoleFormData } from './roles-components/role-form-dialog';
import { RoleDeleteDialog } from './roles-components/role-delete-dialog';

export function RolesManagementPage() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleData | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [formData, setFormData] = useState<RoleFormData>({
    name: '',
    displayName: '',
    description: '',
    hierarchyLevel: 1,
    color: PRESET_COLORS[0].value,
    permissions: [],
  });

  const { data: roles, isLoading } = useSWR<RoleData[]>('/api/roles');

  const resetForm = () => {
    setFormData({
      name: '',
      displayName: '',
      description: '',
      hierarchyLevel: 1,
      color: PRESET_COLORS[0].value,
      permissions: [],
    });
    setError('');
  };

  const openCreateDialog = () => {
    resetForm();
    setShowCreateDialog(true);
  };

  const openEditDialog = (role: RoleData) => {
    setSelectedRole(role);
    setFormData({
      name: role.name,
      displayName: role.displayName,
      description: role.description || '',
      hierarchyLevel: role.hierarchyLevel,
      color: role.color,
      permissions: role.permissions,
    });
    setShowEditDialog(true);
  };

  const handleCreate = async () => {
    if (!formData.name || !formData.displayName) {
      setError('Name and Display Name are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.post('/api/roles', {
        name: formData.name.toUpperCase().replace(/\s+/g, '_'),
        displayName: formData.displayName,
        description: formData.description,
        hierarchyLevel: formData.hierarchyLevel,
        color: formData.color,
        permissions: formData.permissions,
      });
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowCreateDialog(false);
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to create role');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedRole) return;

    setSaving(true);
    setError('');
    try {
      await api.put(`/api/roles/${selectedRole.name}`, {
        displayName: formData.displayName,
        description: formData.description,
        hierarchyLevel: formData.hierarchyLevel,
        color: formData.color,
        permissions: formData.permissions,
      });
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowEditDialog(false);
      setSelectedRole(null);
    } catch (err: any) {
      setError(err.message || 'Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (role: RoleData) => {
    setDeleteTarget(role);
    setDeleteError('');
    setShowDeleteDialog(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/api/roles/${deleteTarget.name}`);
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch (err: any) {
      const msg = err.message || 'Failed to delete role';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ROLE_MANAGE') ?? false);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-indigo-600 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/config"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 border border-white/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Role Management</h1>
                  <p className="text-purple-100/80 text-sm">Create and manage user roles</p>
                </div>
              </div>
            </div>
          </div>
          {isSuperAdmin && (
            <Button
              onClick={openCreateDialog}
              className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Role
            </Button>
          )}
        </div>
      </div>

      {/* Roles Table */}
      <RoleTable
        roles={roles}
        isLoading={isLoading}
        isSuperAdmin={isSuperAdmin}
        onEdit={openEditDialog}
        onDelete={openDeleteDialog}
      />

      {/* Info Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border border-purple-100/50 p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/25">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-purple-900 mb-1">Role Hierarchy</h3>
            <p className="text-sm text-purple-700">
              Users can only create or manage users with roles of equal or lower hierarchy level.
              System roles (marked with the System badge) cannot be deleted but their permissions can be customized.
            </p>
          </div>
        </div>
      </div>

      {/* Create Role Dialog */}
      <RoleFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        title="Create New Role"
        formData={formData}
        setFormData={setFormData}
        error={error}
        saving={saving}
        onSubmit={handleCreate}
        isEdit={false}
      />

      {/* Delete Role Confirmation Dialog */}
      <RoleDeleteDialog
        open={showDeleteDialog}
        role={deleteTarget}
        error={deleteError}
        deleting={deleting}
        onClose={() => setShowDeleteDialog(false)}
        onDelete={handleDelete}
      />

      {/* Edit Role Dialog */}
      <RoleFormDialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        title={`Edit Role: ${selectedRole?.displayName}`}
        formData={formData}
        setFormData={setFormData}
        error={error}
        saving={saving}
        onSubmit={handleUpdate}
        isEdit={true}
        isSystem={selectedRole?.isSystem}
      />
    </div>
  );
}
