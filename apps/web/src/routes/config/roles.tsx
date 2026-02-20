import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSION_CATEGORIES } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

const PRESET_COLORS = [
  { value: 'bg-gradient-to-r from-red-500 to-pink-500', label: 'Red-Pink' },
  { value: 'bg-gradient-to-r from-purple-500 to-indigo-500', label: 'Purple-Indigo' },
  { value: 'bg-gradient-to-r from-blue-500 to-cyan-500', label: 'Blue-Cyan' },
  { value: 'bg-gradient-to-r from-emerald-500 to-green-500', label: 'Emerald-Green' },
  { value: 'bg-gradient-to-r from-amber-500 to-orange-500', label: 'Amber-Orange' },
  { value: 'bg-gradient-to-r from-slate-400 to-slate-500', label: 'Slate' },
  { value: 'bg-gradient-to-r from-teal-500 to-cyan-500', label: 'Teal-Cyan' },
  { value: 'bg-gradient-to-r from-rose-500 to-red-500', label: 'Rose-Red' },
];

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
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    hierarchyLevel: 1,
    color: PRESET_COLORS[0].value,
    permissions: [] as string[],
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

  const togglePermission = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const toggleCategory = (category: string, value: boolean) => {
    const categoryPerms = PERMISSION_CATEGORIES[category as keyof typeof PERMISSION_CATEGORIES];
    if (value) {
      setFormData(prev => ({
        ...prev,
        permissions: [...new Set([...prev.permissions, ...categoryPerms.map(p => p.key)])],
      }));
    } else {
      const keysToRemove = categoryPerms.map(p => p.key);
      setFormData(prev => ({
        ...prev,
        permissions: prev.permissions.filter(p => !keysToRemove.includes(p)),
      }));
    }
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

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

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
      <Card className="border-0 shadow-xl overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-16 text-center">
              <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p className="text-slate-500">Loading roles...</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Role</TableHead>
                  <TableHead className="font-semibold text-slate-600">Description</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Hierarchy</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Permissions</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Type</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Status</TableHead>
                  {isSuperAdmin && (
                    <TableHead className="font-semibold text-slate-600 text-center">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles?.map((role) => (
                  <TableRow key={role.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex px-3 py-1.5 rounded-full text-xs font-semibold text-white ${role.color}`}>
                          {role.displayName}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">{role.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-slate-600 max-w-xs truncate">
                        {role.description || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-mono">
                        Level {role.hierarchyLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium text-slate-700">
                        {role.permissions.length}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {role.isSystem ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">System</Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200">Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {role.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-700 border-slate-200">Inactive</Badge>
                      )}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(role)}
                            className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(role)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            Create New Role
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <div className="p-2 rounded-lg bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Role Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                placeholder="e.g., QUALITY_ASSURANCE"
                className="h-12 font-mono"
              />
              <p className="text-xs text-slate-500">Uppercase letters and underscores only</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Display Name *</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="e.g., Quality Assurance"
                className="h-12"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Description</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this role's purpose"
              className="h-12"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Hierarchy Level</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={formData.hierarchyLevel}
                onChange={(e) => setFormData({ ...formData, hierarchyLevel: parseInt(e.target.value) || 1 })}
                className="h-12"
              />
              <p className="text-xs text-slate-500">Higher level = more privileges (1-10)</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Badge Color</label>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setFormData({ ...formData, color: color.value })}
                    className={`h-10 rounded-lg ${color.value} transition-all ${
                      formData.color === color.value ? 'ring-2 ring-offset-2 ring-purple-500' : ''
                    }`}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Permissions</h3>
            {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]) => {
              const allEnabled = permissions.every(p => formData.permissions.includes(p.key));
              return (
                <div key={category} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                    <span className="font-semibold text-slate-700">{category}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleCategory(category, !allEnabled)}
                      className="text-xs"
                    >
                      {allEnabled ? 'Disable All' : 'Enable All'}
                    </Button>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-2">
                    {permissions.map((perm) => (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                          formData.permissions.includes(perm.key)
                            ? 'bg-purple-50 border-purple-200 border'
                            : 'bg-white border border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.permissions.includes(perm.key)}
                          onChange={() => togglePermission(perm.key)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          formData.permissions.includes(perm.key)
                            ? 'bg-purple-500 border-purple-500'
                            : 'border-slate-300'
                        }`}>
                          {formData.permissions.includes(perm.key) && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-slate-700">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>


          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-gradient-to-r from-purple-500 to-indigo-600"
            >
              {saving ? 'Creating...' : 'Create Role'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Role Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            Delete Role
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {deleteError && (
            <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <div className="p-2 rounded-lg bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">{deleteError}</p>
            </div>
          )}

          <p className="text-slate-600">
            Are you sure you want to permanently delete the role{' '}
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold text-white ${deleteTarget?.color}`}>
              {deleteTarget?.displayName}
            </span>
            ?
          </p>
          <p className="text-sm text-slate-500">
            This action cannot be undone. The role will be permanently removed from the system.
          </p>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Role'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={showEditDialog} onClose={() => setShowEditDialog(false)} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            Edit Role: {selectedRole?.displayName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <div className="p-2 rounded-lg bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {selectedRole?.isSystem && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <div className="p-2 rounded-lg bg-amber-100">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-sm text-amber-700">
                This is a system role. You can modify its display name, description, color, and permissions, but the role name and cannot be changed.
              </p>
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Role Name</label>
              <Input
                value={formData.name}
                disabled
                className="h-12 font-mono bg-slate-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Display Name *</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                className="h-12"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Description</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this role's purpose"
              className="h-12"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Hierarchy Level</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={formData.hierarchyLevel}
                onChange={(e) => setFormData({ ...formData, hierarchyLevel: parseInt(e.target.value) || 1 })}
                className="h-12"
                disabled={selectedRole?.isSystem}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Badge Color</label>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setFormData({ ...formData, color: color.value })}
                    className={`h-10 rounded-lg ${color.value} transition-all ${
                      formData.color === color.value ? 'ring-2 ring-offset-2 ring-purple-500' : ''
                    }`}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Permissions</h3>
            {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]) => {
              const allEnabled = permissions.every(p => formData.permissions.includes(p.key));
              return (
                <div key={category} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                    <span className="font-semibold text-slate-700">{category}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleCategory(category, !allEnabled)}
                      className="text-xs"
                    >
                      {allEnabled ? 'Disable All' : 'Enable All'}
                    </Button>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-2">
                    {permissions.map((perm) => (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                          formData.permissions.includes(perm.key)
                            ? 'bg-purple-50 border-purple-200 border'
                            : 'bg-white border border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.permissions.includes(perm.key)}
                          onChange={() => togglePermission(perm.key)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          formData.permissions.includes(perm.key)
                            ? 'bg-purple-500 border-purple-500'
                            : 'border-slate-300'
                        }`}>
                          {formData.permissions.includes(perm.key) && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-slate-700">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>


          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={saving}
              className="bg-gradient-to-r from-purple-500 to-indigo-600"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
