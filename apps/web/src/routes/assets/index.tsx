import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { AssetDetailPanel } from './components/entity-detail-panel';
import { useAssetTreeLogic } from './hooks/use-asset-tree-logic';
import { useAssetMutations } from './hooks/use-asset-mutations';
import {
  AddEntityWizard,
  EditEntityDialog,
  DeleteEntityDialog,
  LinkEntitiesDialog,
  AddIdentifierDialog,
  AttachExistingDialog,
} from './components/dialogs';
import type {
  TreeNode, AssetTemplate, AssetInstance, AssetRelation, AuditRecord, PaginatedInstances,
} from './types';
import { getIcon } from './constants';

// =============================================
// Main Component
// =============================================

export { AssetExplorerPage as AssetsPage };

export function AssetExplorerPage() {
  const { user } = useAuth();

  // Permission helpers for RBAC button visibility
  const canCreate = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ASSET_CREATE') ?? false);
  const canUpdate = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ASSET_UPDATE') ?? false);
  const canDelete = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ASSET_DELETE') ?? false);
  const canManageRelationships = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ASSET_RELATIONSHIP_CREATE') ?? false);
  const { formatDateTime } = useDatetimeFormat();

  // ---- View state ----
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [treeTemplateFilter, setTreeTemplateFilter] = useState('');

  // ---- Dialog states ----
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddIdentifierDialog, setShowAddIdentifierDialog] = useState(false);
  const [showAttachExistingDialog, setShowAttachExistingDialog] = useState(false);
  const [attachParentId, setAttachParentId] = useState('');
  const [addParentId, setAddParentId] = useState<string | null>(null);

  // ---- Form data ----
  const [editAsset, setEditAsset] = useState({ name: '', description: '', status: 'Active', parentId: null as string | null, attributes: {} as Record<string, any> });

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // ---- List view state ----
  const [listPage, setListPage] = useState(1);
  const [listSearch, setListSearch] = useState('');

  // ---- Debounced search ----
  const [debouncedTreeSearch, setDebouncedTreeSearch] = useState('');
  const [debouncedListSearch, setDebouncedListSearch] = useState('');
  const treeSearchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listSearchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (treeSearchTimeout.current) clearTimeout(treeSearchTimeout.current);
    treeSearchTimeout.current = setTimeout(() => setDebouncedTreeSearch(treeSearch), 300);
    return () => { if (treeSearchTimeout.current) clearTimeout(treeSearchTimeout.current); };
  }, [treeSearch]);

  useEffect(() => {
    if (listSearchTimeout.current) clearTimeout(listSearchTimeout.current);
    listSearchTimeout.current = setTimeout(() => setDebouncedListSearch(listSearch), 300);
    return () => { if (listSearchTimeout.current) clearTimeout(listSearchTimeout.current); };
  }, [listSearch]);

  // =============================================
  // Data Fetching
  // =============================================

  // Data fetching: tree + detail + relationships + audit are separate queries
  // because each has different refresh intervals and cache invalidation needs.
  // SWR deduplicates by key, so navigating within the tree doesn't re-fetch the tree.
  const { data: treeData, isLoading: treeLoading } = useSWR<TreeNode[]>('/api/assets/instances/tree', { refreshInterval: 30000 });
  const { data: selectedAsset, isLoading: detailLoading } = useSWR<AssetInstance>(selectedAssetId ? `/api/assets/instances/${selectedAssetId}` : null);
  const { data: templatesData } = useSWR<{ data: AssetTemplate[] }>('/api/assets/templates?isActive=true');
  const { data: listData, isLoading: listLoading } = useSWR<PaginatedInstances>(
    viewMode === 'list' ? `/api/assets/instances?page=${listPage}${debouncedListSearch ? `&search=${encodeURIComponent(debouncedListSearch)}` : ''}${treeTemplateFilter ? `&templateId=${encodeURIComponent(treeTemplateFilter)}` : ''}&isActive=true` : null,
  );
  const { data: auditData } = useSWR<{ data: AuditRecord[] }>(selectedAssetId && activeTab === 'audit' ? `/api/audit?targetId=${selectedAssetId}` : null, { revalidateOnMount: true, dedupingInterval: 0 });
  const { data: allRelationshipsData } = useSWR<AssetRelation[]>(selectedAssetId && activeTab === 'relationships' ? '/api/assets/relationships' : null);

  const templates = templatesData?.data ?? [];
  const auditRecords = auditData?.data ?? [];

  // =============================================
  // Hooks
  // =============================================

  const {
    expandedNodes, setExpandedNodes, getChildren, toggleExpand,
    expandAll, collapseAll, getParentPath, flatAssetList, filteredTreeFn,
  } = useAssetTreeLogic(treeData);

  const filteredTree = useMemo(() => filteredTreeFn(debouncedTreeSearch, treeTemplateFilter), [filteredTreeFn, debouncedTreeSearch, treeTemplateFilter]);
  const hasActiveFilters = debouncedTreeSearch || treeTemplateFilter;
  const rootNodes = useMemo(() => hasActiveFilters ? filteredTree : filteredTree.filter((n) => !n.parentId), [filteredTree, hasActiveFilters]);

  const mutations = useAssetMutations({
    setSaving,
    setError,
    onCreateSuccess: () => { setShowAddDialog(false); setAddParentId(null); },
    onUpdateSuccess: () => { setShowEditDialog(false); },
    onDeleteSuccess: () => { setShowDeleteDialog(false); setSelectedAssetId(null); },
    onRelationshipCreated: (result: any) => {
      setShowLinkDialog(false);
    },
    onRelationshipDeleted: () => {},
    onIdentifierCreated: () => { setShowAddIdentifierDialog(false); },
    onIdentifierDeleted: () => {},
    onUnlinked: () => {},
    onRemovedFromDiagram: () => {},
    onAttachSuccess: () => { setShowAttachExistingDialog(false); setAttachParentId(''); },
  });

  // ---- Open Dialogs ----
  const openAddDialog = useCallback((parentId?: string | null) => {
    setAddParentId(parentId ?? null);
    setError('');
    setShowAddDialog(true);
  }, []);

  const openLinkDialog = useCallback(() => {
    setError('');
    setShowLinkDialog(true);
  }, []);

  const openEditDialog = useCallback(() => {
    if (!selectedAsset) return;
    setEditAsset({
      name: selectedAsset.name, description: selectedAsset.description || '',
      status: selectedAsset.status, parentId: selectedAsset.parentId,
      attributes: selectedAsset.attributes || {},
    });
    setError('');
    setShowEditDialog(true);
  }, [selectedAsset]);

  // =============================================
  // Render: Tree Node
  // =============================================

  const renderTreeNode = useCallback(
    (node: TreeNode, depth: number) => {
      const isExpanded = expandedNodes.has(node.id);
      const isSelected = selectedAssetId === node.id;
      const hasChildren = node._count.children > 0;
      const children = getChildren(node.id);

      return (
        <div key={node.id} className="group/treenode">
          <div
            className={cn('w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-slate-50 cursor-pointer', isSelected && 'bg-blue-50 border-r-2 border-blue-500')}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => { setSelectedAssetId(node.id); setActiveTab('overview'); }}
          >
            {hasChildren ? (
              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors" onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}>
                <svg className={cn('w-3.5 h-3.5 transition-transform duration-200', isExpanded && 'rotate-90')} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </span>
            ) : <span className="w-5 flex-shrink-0" />}
            <span className="text-base flex-shrink-0">{getIcon(node.template.icon)}</span>
            <span className={cn('truncate flex-1 font-medium', isSelected ? 'text-blue-700' : 'text-slate-700')}>{node.name}</span>
            {hasChildren && <span className="flex-shrink-0 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{node._count.children}</span>}
            <span className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover/treenode:opacity-100 transition-opacity">
              {canCreate && <span className="w-5 h-5 flex items-center justify-center text-emerald-500 hover:text-emerald-700 rounded hover:bg-emerald-100 transition-colors" title="Create new child entity" onClick={(e) => { e.stopPropagation(); openAddDialog(node.id); }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              </span>}
              {canManageRelationships && <span className="w-5 h-5 flex items-center justify-center text-blue-500 hover:text-blue-700 rounded hover:bg-blue-100 transition-colors" title="Attach existing entity as child" onClick={(e) => { e.stopPropagation(); setAttachParentId(node.id); setError(''); setShowAttachExistingDialog(true); }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              </span>}
              {node.parentId && <span className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors" title="Unlink from parent" onClick={(e) => { e.stopPropagation(); mutations.handleUnlinkFromParent(node.id); }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </span>}
            </span>
          </div>
          {isExpanded && hasChildren && !hasActiveFilters && <div>{children.map((child) => renderTreeNode(child, depth + 1))}</div>}
        </div>
      );
    },
    [expandedNodes, selectedAssetId, toggleExpand, getChildren, hasActiveFilters, openAddDialog, canCreate, canManageRelationships, mutations],
  );

  // =============================================
  // Render: Main
  // =============================================

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Entity Explorer</h1>
          <Badge variant="secondary" className="text-xs">{treeData?.length ?? 0} entities</Badge>
        </div>
        <div className="flex items-center gap-3">
          {canCreate && <Button size="sm" onClick={() => openAddDialog()}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Entity
          </Button>}
          {canManageRelationships && <Button size="sm" variant="outline" onClick={openLinkDialog}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            Link Entities
          </Button>}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button className={cn('px-3 py-1.5 text-xs font-medium transition-colors', viewMode === 'tree' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')} onClick={() => setViewMode('tree')}>Tree</button>
            <button className={cn('px-3 py-1.5 text-xs font-medium transition-colors', viewMode === 'list' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')} onClick={() => setViewMode('list')}>List</button>
          </div>
          <Link to="/assets/templates"><Button size="sm" variant="ghost" title="Template Manager">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </Button></Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}

      {/* Main Content */}
      {viewMode === 'tree' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Tree */}
          <div className="w-80 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
            <div className="p-3 border-b border-slate-100 space-y-2">
              <Input type="text" placeholder="Search entities..." value={treeSearch} onChange={(e) => setTreeSearch(e.target.value)} className="h-9 text-sm" />
              <div className="flex gap-2">
                <Select selectSize="sm" value={treeTemplateFilter} onChange={(e) => setTreeTemplateFilter(e.target.value)} className="flex-1 text-xs">
                  <option value="">All Templates</option>
                  {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </Select>
              </div>
              <div className="flex gap-2">
                <button className="text-xs text-blue-600 hover:text-blue-800 font-medium" onClick={expandAll}>Expand All</button>
                <span className="text-slate-300">|</span>
                <button className="text-xs text-blue-600 hover:text-blue-800 font-medium" onClick={collapseAll}>Collapse All</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {treeLoading ? (
                <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" /></div>
              ) : rootNodes.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="text-3xl mb-3">{'\uD83C\uDFED'}</div>
                  <p className="text-sm font-medium text-slate-600">No entities found</p>
                  <p className="text-xs text-slate-400 mt-1">{hasActiveFilters ? 'Try adjusting your filters' : 'Create your first entity to get started'}</p>
                </div>
              ) : <div className="py-1">{rootNodes.map((node) => renderTreeNode(node, 0))}</div>}
            </div>
          </div>

          {/* Right Panel - Detail */}
          <div className="flex-1 bg-slate-50/50 overflow-y-auto">
            {selectedAssetId ? (
              detailLoading ? (
                <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" /></div>
              ) : selectedAsset ? (
                <AssetDetailPanel
                  asset={selectedAsset} parentPath={getParentPath(selectedAsset.id)} formatDateTime={formatDateTime}
                  activeTab={activeTab} setActiveTab={setActiveTab} auditRecords={auditRecords}
                  allRelationships={allRelationshipsData ?? []} treeData={treeData ?? []}
                  onEdit={openEditDialog} onLink={openLinkDialog}
                  onDelete={() => { setError(''); setShowDeleteDialog(true); }}
                  canUpdate={canUpdate} canDelete={canDelete} canCreate={canCreate} canManageRelationships={canManageRelationships}
                  onDeleteRelationship={mutations.handleDeleteRelationship}
                  onDeleteIdentifier={mutations.handleDeleteIdentifier}
                  onAddIdentifier={() => { setError(''); setShowAddIdentifierDialog(true); }}
                  onSelectAsset={(id) => { setSelectedAssetId(id); setActiveTab('overview'); }}
                  onAddChild={(parentId) => openAddDialog(parentId)}
                  onAttachExisting={(parentId) => { setAttachParentId(parentId); setError(''); setShowAttachExistingDialog(true); }}
                  onRemoveFromDiagram={mutations.handleRemoveFromDiagram}
                />
              ) : <div className="flex items-center justify-center py-20 text-slate-400">Entity not found</div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="text-5xl mb-4">{'\uD83C\uDFED'}</div>
                <h2 className="text-lg font-semibold text-slate-700 mb-2">Welcome to Entity Explorer</h2>
                <p className="text-sm text-slate-500 max-w-md mb-6">Select an entity from the tree to view its details, attributes, relationships, and identifiers. Or create a new entity to get started.</p>
                <Button onClick={() => openAddDialog()}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add Your First Entity
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center gap-3">
            <Input type="text" placeholder="Search entities..." value={listSearch} onChange={(e) => { setListSearch(e.target.value); setListPage(1); }} className="max-w-sm h-9 text-sm" />
            <Select selectSize="sm" value={treeTemplateFilter} onChange={(e) => { setTreeTemplateFilter(e.target.value); setListPage(1); }} className="w-48">
              <option value="">All Templates</option>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </Select>
          </div>
          {listLoading ? (
            <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" /></div>
          ) : (
            <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Name</TableHead><TableHead>Template</TableHead><TableHead>Parent</TableHead><TableHead>Children</TableHead><TableHead>Created</TableHead><TableHead className="w-20">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(listData?.data ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-400">No entities found</TableCell></TableRow>
                  ) : (listData?.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell><button className="flex items-center gap-2 font-medium text-blue-600 hover:text-blue-800" onClick={() => { setSelectedAssetId(item.id); setViewMode('tree'); setActiveTab('overview'); }}><span>{getIcon(item.template.icon)}</span>{item.name}</button></TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{item.template.name}</Badge></TableCell>
                      <TableCell className="text-slate-500 text-sm">{treeData?.find((n) => n.id === item.parentId)?.name ?? '-'}</TableCell>
                      <TableCell className="text-sm">{(item as any)._count?.children > 0 ? <Badge variant="secondary" className="text-xs">{(item as any)._count.children}</Badge> : <span className="text-slate-400">0</span>}</TableCell>
                      <TableCell className="text-slate-500 text-sm">{formatDateTime(item.createdAt)}</TableCell>
                      <TableCell><button className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="View details" onClick={() => { setSelectedAssetId(item.id); setViewMode('tree'); setActiveTab('overview'); }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      </button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {listData && listData.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <p className="text-sm text-slate-500">Page {listData.page} of {listData.totalPages} ({listData.total} total)</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={listData.page <= 1} onClick={() => setListPage((p) => p - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={listData.page >= listData.totalPages} onClick={() => setListPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============================================= */}
      {/* DIALOGS */}
      {/* ============================================= */}

      <AddEntityWizard open={showAddDialog} onClose={() => { setShowAddDialog(false); setAddParentId(null); }} templates={templates} flatAssetList={flatAssetList} initialParentId={addParentId} saving={saving} error={error}
        onSubmit={(templateId, asset) => mutations.handleCreateAsset(templateId, asset)} />

      <EditEntityDialog open={showEditDialog} onClose={() => setShowEditDialog(false)} selectedAsset={selectedAsset} editAsset={editAsset} setEditAsset={setEditAsset} flatAssetList={flatAssetList} selectedAssetId={selectedAssetId} saving={saving}
        onSubmit={() => mutations.handleUpdateAsset(selectedAssetId, editAsset)} />

      <DeleteEntityDialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} selectedAsset={selectedAsset} saving={saving}
        onConfirm={() => mutations.handleDeleteAsset(selectedAssetId)} />

      <LinkEntitiesDialog open={showLinkDialog} onClose={() => setShowLinkDialog(false)} initialSource={selectedAssetId ?? ''} flatAssetList={flatAssetList} saving={saving}
        onSubmit={(source, targets, type, customLabel, notes) => mutations.handleCreateRelationship(source, targets, type, customLabel, notes)} />

      <AddIdentifierDialog open={showAddIdentifierDialog} onClose={() => setShowAddIdentifierDialog(false)} saving={saving}
        onSubmit={(identifier) => mutations.handleCreateIdentifier(selectedAssetId, identifier)} />

      <AttachExistingDialog open={showAttachExistingDialog} onClose={() => { setShowAttachExistingDialog(false); setAttachParentId(''); }} parentId={attachParentId} flatAssetList={flatAssetList} saving={saving} error={error}
        onSubmit={(parentId, targetId) => mutations.handleAttachExisting(parentId, targetId)} />

      {/* Reauth Dialog */}
      <ReauthDialog open={mutations.reauth.isOpen} password={mutations.reauth.password} error={mutations.reauth.error} isVerifying={mutations.reauth.isVerifying} onPasswordChange={mutations.reauth.setPassword} onConfirm={mutations.reauth.confirm} onCancel={mutations.reauth.cancel} />
    </div>
  );
}
