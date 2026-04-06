import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

interface RuleChain {
  id: string;
  name: string;
  description: string | null;
  isRoot: boolean;
  isSystem: boolean;
  isActive: boolean;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse {
  data: RuleChain[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function RuleChainsPage() {
  const { toast } = useToast();
  const reauth = useReauth();

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 20;

  // Search
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input (300ms)
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedRuleChain, setSelectedRuleChain] = useState<RuleChain | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Build query params
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (debouncedSearch) params.set('search', debouncedSearch);

  const { data, mutate, isLoading } = useSWR<PaginatedResponse>(`/api/rule-chains?${params}`);
  const ruleChains = data?.data ?? [];

  // ---------------------------------------------------------------------------
  // Dialog openers
  // ---------------------------------------------------------------------------

  const openCreateDialog = () => {
    setFormName('');
    setFormDescription('');
    setShowCreateDialog(true);
  };

  const openEditDialog = (rc: RuleChain) => {
    setSelectedRuleChain(rc);
    setFormName(rc.name);
    setFormDescription(rc.description ?? '');
    setShowEditDialog(true);
  };

  const openDeleteDialog = (rc: RuleChain) => {
    setSelectedRuleChain(rc);
    setShowDeleteDialog(true);
  };

  // ---------------------------------------------------------------------------
  // CRUD handlers
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error('Validation Error', 'Rule chain name is required.');
      return;
    }
    setSaving(true);
    const body = { name: formName.trim(), description: formDescription.trim() || null };
    await reauth.execute(
      'CREATE_RULE_CHAIN',
      async (password?: string) => {
        if (password) {
          await apiClient.postWithReauth('/api/rule-chains', body, password);
        } else {
          await apiClient.post('/api/rule-chains', body);
        }
      },
      {
        onSuccess: () => {
          toast.success('Rule Chain Created', `"${formName.trim()}" has been created successfully.`);
          setShowCreateDialog(false);
          mutate();
          setSaving(false);
        },
        onError: (err: unknown) => {
          toast.error('Create Failed', (err as any)?.message || 'Failed to create rule chain.');
          setSaving(false);
        },
      },
    );
  };

  const handleUpdate = async () => {
    if (!selectedRuleChain) return;
    if (!formName.trim()) {
      toast.error('Validation Error', 'Rule chain name is required.');
      return;
    }
    setSaving(true);
    const body = { name: formName.trim(), description: formDescription.trim() || null };
    await reauth.execute(
      'UPDATE_RULE_CHAIN',
      async (password?: string) => {
        if (password) {
          await apiClient.putWithReauth(`/api/rule-chains/${selectedRuleChain.id}`, body, password);
        } else {
          await apiClient.put(`/api/rule-chains/${selectedRuleChain.id}`, body);
        }
      },
      {
        onSuccess: () => {
          toast.success('Rule Chain Updated', `"${formName.trim()}" has been updated successfully.`);
          setShowEditDialog(false);
          setSelectedRuleChain(null);
          mutate();
          setSaving(false);
        },
        onError: (err: unknown) => {
          toast.error('Update Failed', (err as any)?.message || 'Failed to update rule chain.');
          setSaving(false);
        },
      },
    );
  };

  const handleDelete = async () => {
    if (!selectedRuleChain) return;
    setDeleting(true);
    await reauth.execute(
      'DELETE_RULE_CHAIN',
      async (password?: string) => {
        if (password) {
          await apiClient.deleteWithReauth(`/api/rule-chains/${selectedRuleChain.id}`, password);
        } else {
          await apiClient.delete(`/api/rule-chains/${selectedRuleChain.id}`);
        }
      },
      {
        onSuccess: () => {
          toast.success('Rule Chain Deleted', `"${selectedRuleChain.name}" has been deleted successfully.`);
          setShowDeleteDialog(false);
          setSelectedRuleChain(null);
          mutate();
          setDeleting(false);
        },
        onError: (err: unknown) => {
          toast.error('Delete Failed', (err as any)?.message || 'Failed to delete rule chain.');
          setDeleting(false);
        },
      },
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Rule Chains</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage automation rule chains and workflows</p>
          </div>
        </div>
        <Button
          onClick={openCreateDialog}
          className="gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/25"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Rule Chain
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rule chains..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-16 text-center">
          <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-cyan-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-slate-500">Loading rule chains...</p>
        </div>
      ) : ruleChains.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-16 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-slate-100">
              <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-slate-600 font-semibold">No rule chains found</p>
              <p className="text-sm text-slate-400 mt-1">
                {debouncedSearch
                  ? 'Try adjusting your search criteria.'
                  : 'Get started by creating your first rule chain.'}
              </p>
            </div>
            {!debouncedSearch && (
              <Button
                onClick={openCreateDialog}
                className="gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Rule Chain
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="font-semibold text-slate-600">Name</TableHead>
              <TableHead className="font-semibold text-slate-600">Description</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Version</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Status</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Root</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">System</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ruleChains.map((rc) => (
              <TableRow key={rc.id} className="hover:bg-slate-50/50 transition-colors">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-100 text-cyan-600 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <span className="font-semibold text-slate-800">{rc.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-slate-500 max-w-xs truncate block">
                    {rc.description || '--'}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm font-medium text-slate-700">v{rc.currentVersion}</span>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={rc.isActive ? 'success' : 'default'}>
                    {rc.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {rc.isRoot ? (
                    <Badge variant="warning">Yes</Badge>
                  ) : (
                    <Badge variant="default">No</Badge>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {rc.isSystem ? (
                    <Badge variant="secondary">Yes</Badge>
                  ) : (
                    <Badge variant="default">No</Badge>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Link to={`/rule-chains/${rc.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-violet-600 hover:text-violet-700 hover:bg-violet-50"
                        title="Open visual editor"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(rc)}
                      className="text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50"
                      title="Edit rule chain metadata"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(rc)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Delete rule chain"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">
              Page <span className="font-semibold text-slate-800">{data.page}</span> of{' '}
              <span className="font-semibold text-slate-800">{data.totalPages}</span>
              <span className="text-slate-400 ml-2">({data.total} total rule chains)</span>
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (data?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="gap-1.5"
              >
                Next
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Rule Chain Dialog */}
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-100 text-cyan-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            Create Rule Chain
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Name *</label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Enter rule chain name"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Description</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Enter description (optional)"
              rows={3}
              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={saving}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
          >
            {saving ? 'Creating...' : 'Create Rule Chain'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Rule Chain Dialog */}
      <Dialog
        open={showEditDialog}
        onClose={() => { setShowEditDialog(false); setSelectedRuleChain(null); }}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-100 text-cyan-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            Edit Rule Chain
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Name *</label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Enter rule chain name"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Description</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Enter description (optional)"
              rows={3}
              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowEditDialog(false); setSelectedRuleChain(null); }}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={saving}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteDialog}
        onClose={() => { setShowDeleteDialog(false); setSelectedRuleChain(null); }}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            Delete Rule Chain
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-slate-800">{selectedRuleChain?.name}</span>?
            This action cannot be undone.
          </p>
          {selectedRuleChain?.isSystem && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <div className="p-2 rounded-lg bg-amber-100">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-sm text-amber-700">
                This is a <strong>system</strong> rule chain. Deleting it may affect core functionality.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setSelectedRuleChain(null); }}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {deleting ? 'Deleting...' : 'Delete Rule Chain'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Re-auth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
      />
    </div>
  );
}
