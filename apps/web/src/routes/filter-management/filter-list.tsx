import { useState, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { FILTER_STATE_COLORS } from '@/lib/filter-constants';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { useAuth } from '@/hooks/use-auth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { api } from '@/lib/api-client';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { themeGradientBr, themeButton } from '@/lib/theme-styles';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  INSTALLED: { label: 'Installed', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  WASH_IN: { label: 'Wash In', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  WASH_OUT: { label: 'Wash Out', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  DRY_IN: { label: 'Dry In', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  DRY_OUT: { label: 'Dry Out', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  STORAGE_IN: { label: 'Storage In', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  STORAGE_OUT: { label: 'Storage Out', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  IN_USE: { label: 'In Use', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RETIRED: { label: 'Retired', color: 'bg-red-50 text-red-700 border-red-200' },
};

const LIFECYCLE_STATE_OPTIONS = [
  { value: 'INSTALLED', label: 'Installed', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'WASH_IN', label: 'Wash In', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'WASH_OUT', label: 'Wash Out', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'DRY_IN', label: 'Dry In', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'DRY_OUT', label: 'Dry Out', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'STORAGE_IN', label: 'Storage In', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 'STORAGE_OUT', label: 'Storage Out', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 'IN_USE', label: 'In Use', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

export function FilterListPage() {
  const { formatDate } = useDatetimeFormat();
  const { toast } = useToast();
  const reauth = useReauth();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const hasPerm = (p: string) => isSuperAdmin || perms.includes(p);
  const canCreate = hasPerm('FILTER_HIERARCHY_CREATE');
  const canBulkUpload = hasPerm('FILTER_BULK_UPLOAD');
  const canCreateFilter = hasPerm('FILTER_CREATE') || hasPerm('ASSET_CREATE');
  const canEditFilter = hasPerm('FILTER_EDIT') || hasPerm('ASSET_UPDATE');
  const canDeleteFilter = hasPerm('FILTER_DELETE') || hasPerm('ASSET_DELETE');
  const canEditHierarchy = hasPerm('FILTER_HIERARCHY_EDIT') || hasPerm('ASSET_UPDATE');
  const canDeleteHierarchy = hasPerm('FILTER_HIERARCHY_DELETE') || hasPerm('ASSET_DELETE');
  const canRetire = hasPerm('FILTER_RETIRE');
  const canReplace = hasPerm('FILTER_REPLACE');
  const canStatusUpdate = hasPerm('FILTER_STATUS_UPDATE');
  const canRfid = hasPerm('FILTER_RFID_MANAGE');
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [panelFilter, setPanelFilter] = useState<{ id: string; name: string } | null>(null);
  const [panelAction, setPanelAction] = useState<'retire' | 'replace'>('retire');
  const [panelRemarks, setPanelRemarks] = useState('');
  const [panelSubmitting, setPanelSubmitting] = useState(false);

  // Lifecycle state update panel
  const [statusPanelFilter, setStatusPanelFilter] = useState<{ id: string; name: string; currentState: string | null } | null>(null);
  const [statusPanelState, setStatusPanelState] = useState('');
  const [statusPanelRemarks, setStatusPanelRemarks] = useState('');
  const [statusPanelSubmitting, setStatusPanelSubmitting] = useState(false);

  // RFID tag panel
  const [rfidPanel, setRfidPanel] = useState<{ id: string; name: string } | null>(null);
  const [rfidTagValue, setRfidTagValue] = useState('');
  const [rfidSubmitting, setRfidSubmitting] = useState(false);

  // Multi-select
  const [selectedFilterIds, setSelectedFilterIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'status' | 'retire' | 'replace' | null>(null);

  // Pagination
  const paginationOptions = usePaginationConfig();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0] ?? 10);

  // Bulk upload
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  // Hierarchy node edit/delete (areas, AHUs — reuses the same instance routes)
  const [hierarchyEditDialog, setHierarchyEditDialog] = useState<{ id: string; name: string; entityType: string } | null>(null);
  const [hierarchyEditName, setHierarchyEditName] = useState('');
  const [hierarchyEditSubmitting, setHierarchyEditSubmitting] = useState(false);
  const [hierarchyEditError, setHierarchyEditError] = useState('');
  const [hierarchyDeleteDialog, setHierarchyDeleteDialog] = useState<{ id: string; name: string; entityType: string } | null>(null);
  const [hierarchyDeleteSubmitting, setHierarchyDeleteSubmitting] = useState(false);
  // Edit filter dialog
  const [editFilterDialog, setEditFilterDialog] = useState<{ id: string; name: string; filterSet?: string } | null>(null);
  const [editFilterName, setEditFilterName] = useState('');
  const [editFilterSet, setEditFilterSet] = useState<'A' | 'B'>('A');
  const [editFilterSubmitting, setEditFilterSubmitting] = useState(false);
  const [editFilterError, setEditFilterError] = useState('');
  // Delete filter dialog
  const [deleteFilterDialog, setDeleteFilterDialog] = useState<{ id: string; name: string } | null>(null);
  const [deleteFilterSubmitting, setDeleteFilterSubmitting] = useState(false);
  // Single-filter create dialog
  const [createFilterOpen, setCreateFilterOpen] = useState(false);
  const [createFilterAhu, setCreateFilterAhu] = useState('');
  const [createFilterName, setCreateFilterName] = useState('');
  const [createFilterSet, setCreateFilterSet] = useState<'A' | 'B'>('A');
  const [createFilterProfile, setCreateFilterProfile] = useState('');
  const [createFilterSubmitting, setCreateFilterSubmitting] = useState(false);
  const [createFilterError, setCreateFilterError] = useState('');
  const [bulkUploadAhu, setBulkUploadAhu] = useState('');
  const [bulkUploadFile, setBulkUploadFile] = useState<File | null>(null);
  const [bulkUploadStep, setBulkUploadStep] = useState<'select' | 'preview' | 'uploading' | 'results'>('select');
  const [bulkUploadRows, setBulkUploadRows] = useState<any[]>([]);
  const [bulkUploadError, setBulkUploadError] = useState('');
  const [bulkUploadResults, setBulkUploadResults] = useState<any[]>([]);
  const [bulkUploadCreated, setBulkUploadCreated] = useState(0);
  const [bulkUploadFailed, setBulkUploadFailed] = useState(0);

  const [blockTab, setBlockTab] = useState<'view' | 'filters'>('view');
  // Diagram click filter: narrows filters tab to a specific node
  const [diagramFilter, setDiagramFilter] = useState<{ type: 'block' | 'area' | 'ahu' | 'filter'; id: string; name: string } | null>(null);
  const [createDialog, setCreateDialog] = useState<{ type: 'block' | 'area' | 'ahu'; parentId?: string; parentName?: string } | null>(null);
  const [createName, setCreateName] = useState('');
  const [createAttrs, setCreateAttrs] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  // Block deletion
  const [deleteBlockDialog, setDeleteBlockDialog] = useState<{ id: string; name: string } | null>(null);
  const [deletingBlock, setDeletingBlock] = useState(false);

  const { data: templatesData } = useSWR('/api/assets/templates?limit=100');
  const { data: instancesData, isLoading } = useSWR('/api/assets/instances?limit=500', { refreshInterval: 30000 });

  // Fetch all identifiers to show RFID tags on filters
  const { data: identifiersData } = useSWR('/api/assets/identifiers?limit=1000');

  const templates = (templatesData?.data ?? []) as any[];
  const instances = (instancesData?.data ?? []) as any[];

  const blockTemplateId = templates.find((t: any) => t.name === 'Block')?.id;
  const filterTemplateId = templates.find((t: any) => t.name === 'Filter')?.id;
  const ahuTemplateId = templates.find((t: any) => t.name === 'AHU')?.id;

  const blocks = useMemo(() =>
    instances.filter((i: any) => i.templateId === blockTemplateId),
    [instances, blockTemplateId]
  );

  const instanceMap = useMemo(() => {
    const map = new Map<string, any>();
    instances.forEach((i: any) => map.set(i.id, i));
    return map;
  }, [instances]);

  const blockIds = useMemo(() => new Set(blocks.map((b: any) => b.id)), [blocks]);

  const allFilters = useMemo(() =>
    instances.filter((i: any) => i.templateId === filterTemplateId && i.isActive !== false && i.status !== 'Retired'),
    [instances, filterTemplateId]
  );

  // Map of assetId -> identifiers (for RFID tag display)
  const identifiersByAsset = useMemo(() => {
    const map = new Map<string, any[]>();
    const items = (identifiersData as any)?.data ?? (Array.isArray(identifiersData) ? identifiersData : []);
    for (const id of items) {
      if (!map.has(id.assetId)) map.set(id.assetId, []);
      map.get(id.assetId)!.push(id);
    }
    return map;
  }, [identifiersData]);

  const areaTemplateId = templates.find((t: any) => t.name === 'Area' && t.isActive)?.id;

  // Build tree data: block -> areas -> AHUs -> filters
  const treeData = useMemo(() => {
    return blocks.map((block: any) => {
      const blockChildren = instances.filter((i: any) => i.parentId === block.id && i.isActive !== false && i.status !== 'Retired');
      const areas = blockChildren.filter((i: any) => i.templateId === areaTemplateId);
      const directAhus = blockChildren.filter((i: any) => i.templateId === ahuTemplateId);

      const areaNodes = areas.map((area: any) => {
        const areaChildren = instances.filter((i: any) => i.parentId === area.id && i.isActive !== false && i.status !== 'Retired');
        const ahus = areaChildren.filter((i: any) => i.templateId === ahuTemplateId);
        return {
          ...area, type: 'area' as const,
          ahus: ahus.map((ahu: any) => ({
            ...ahu, type: 'ahu' as const,
            filters: instances.filter((f: any) => f.parentId === ahu.id && f.templateId === filterTemplateId && f.isActive !== false && f.status !== 'Retired'),
          })),
        };
      });

      // AHUs directly under block (no area level)
      const directAhuNodes = directAhus.map((ahu: any) => ({
        ...ahu, type: 'ahu' as const,
        filters: instances.filter((f: any) => f.parentId === ahu.id && f.templateId === filterTemplateId && f.isActive !== false && f.status !== 'Retired'),
      }));

      return { ...block, type: 'block' as const, areas: areaNodes, directAhus: directAhuNodes };
    });
  }, [blocks, instances, areaTemplateId, ahuTemplateId, filterTemplateId]);

  const getTemplateIdForType = (type: string) => {
    if (type === 'block') return blockTemplateId;
    if (type === 'area') return areaTemplateId;
    if (type === 'ahu') return ahuTemplateId;
    return '';
  };

  const getTemplateSchema = (type: string): any[] => {
    const tid = getTemplateIdForType(type);
    const tpl = templates.find((t: any) => t.id === tid);
    return tpl?.attributeSchema ?? [];
  };

  const handleCreate = async () => {
    if (!createDialog || !createName.trim()) return;
    setCreating(true);
    try {
      const templateId = getTemplateIdForType(createDialog.type);

      // Build attributes from form fields, convert types
      const schema = getTemplateSchema(createDialog.type);
      const attributes: Record<string, any> = {};
      for (const field of schema) {
        const val = createAttrs[field.fieldName] ?? '';
        if (field.dataType === 'FLOAT' || field.dataType === 'NUMBER') {
          attributes[field.fieldName] = val ? Number(val) : undefined;
        } else {
          attributes[field.fieldName] = val || undefined;
        }
      }

      const body: any = { name: createName.trim(), templateId, status: 'Active', attributes };
      if (createDialog.parentId) body.parentId = createDialog.parentId;

      await api.post('/api/assets/instances', body);
      toast.success('Created', `${createDialog.type.toUpperCase()} "${createName.trim()}" created`);
      setCreateDialog(null); setCreateName(''); setCreateAttrs({});
      mutate('/api/assets/instances?limit=500');
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setCreating(false);
  };

  const handleDeleteBlock = async () => {
    if (!deleteBlockDialog || deletingBlock) return;
    setDeletingBlock(true);
    try {
      await reauth.execute('DELETE_ASSET', async (password?) => {
        if (password) await api.deleteWithReauth(`/api/assets/instances/${deleteBlockDialog.id}`, password);
        else await api.delete(`/api/assets/instances/${deleteBlockDialog.id}`);
      }, {
        onSuccess: () => {
          toast.success('Deleted', `Block "${deleteBlockDialog.name}" deleted`);
          setDeleteBlockDialog(null);
          if (selectedBlock === deleteBlockDialog.id) setSelectedBlock(null);
          mutate('/api/assets/instances?limit=500');
          setDeletingBlock(false);
        },
        onError: (err: unknown) => {
          toast.error('Error', (err as any)?.message ?? 'Failed to delete block');
          setDeletingBlock(false);
        },
      });
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'Failed to delete block');
      setDeletingBlock(false);
    }
  };

  // Walk up parent chain to find Block, Area and AHU ancestors
  const resolveAncestors = (filterId: string) => {
    let ahuId: string | null = null;
    let ahuName = '-';
    let areaId: string | null = null;
    let areaName = '-';
    let blockId: string | null = null;
    let blockName = '-';
    let currentId = instanceMap.get(filterId)?.parentId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entity = instanceMap.get(currentId);
      if (!entity) break;
      if (entity.templateId === ahuTemplateId && !ahuId) {
        ahuId = entity.id;
        ahuName = entity.name;
      }
      if (entity.templateId === areaTemplateId && !areaId) {
        areaId = entity.id;
        areaName = entity.name;
      }
      if (blockIds.has(entity.id)) {
        blockId = entity.id;
        blockName = entity.name;
        break;
      }
      currentId = entity.parentId;
    }
    return { ahuId, ahuName, areaId, areaName, blockId, blockName };
  };

  const enrichedFilters = useMemo(() => {
    return allFilters.map((f: any) => {
      const { ahuId, ahuName, areaId, areaName, blockId, blockName } = resolveAncestors(f.id);
      return {
        id: f.id, name: f.name, filterSet: f.filterSet,
        currentState: f.currentLifecycleState,
        status: f.status ?? 'Active',
        ahuId, ahuName, areaId, areaName, blockId, blockName,
        filterType: f.attributes?.filterType ?? '-',
        filterSize: f.attributes?.filterSize ?? '-',
        ahuType: f.attributes?.ahuType ?? '-',
        lastCleaningDate: f.attributes?.lastCleaningDate ?? null,
      };
    });
  }, [allFilters, instanceMap, ahuTemplateId, blockIds]);

  // Count filters per block
  const blockCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    enrichedFilters.forEach(f => {
      if (f.blockId) counts[f.blockId] = (counts[f.blockId] ?? 0) + 1;
    });
    return counts;
  }, [enrichedFilters]);

  // Filters for the selected block, further narrowed by diagram click
  const blockFilters = useMemo(() => {
    if (!selectedBlock) return [];
    let filtered = enrichedFilters.filter(f => f.blockId === selectedBlock);
    if (diagramFilter) {
      if (diagramFilter.type === 'area') filtered = filtered.filter(f => f.areaId === diagramFilter.id);
      else if (diagramFilter.type === 'ahu') filtered = filtered.filter(f => f.ahuId === diagramFilter.id);
      else if (diagramFilter.type === 'filter') filtered = filtered.filter(f => f.id === diagramFilter.id);
      // 'block' shows all — no extra filter
    }
    return filtered;
  }, [enrichedFilters, selectedBlock, diagramFilter]);

  const selectedBlockName = selectedBlock ? (instanceMap.get(selectedBlock)?.name ?? 'Block') : '';

  // Pagination computed
  const totalPages = Math.max(1, Math.ceil(blockFilters.length / perPage));
  const paginatedFilters = useMemo(() => {
    const start = (page - 1) * perPage;
    return blockFilters.slice(start, start + perPage);
  }, [blockFilters, page, perPage]);

  const openStatusPanel = (filter: { id: string; name: string; currentState: string | null }) => {
    closePanel(); // close retire panel if open
    setStatusPanelFilter(filter);
    setStatusPanelState(filter.currentState ?? 'INSTALLED');
    setStatusPanelRemarks('');
  };

  const closeStatusPanel = () => {
    setStatusPanelFilter(null);
    setStatusPanelRemarks('');
    setStatusPanelSubmitting(false);
  };

  const handleStatusSubmit = () => {
    if (!statusPanelFilter || !statusPanelRemarks.trim() || !statusPanelState) return;
    if (statusPanelState === (statusPanelFilter.currentState ?? '')) return;
    setStatusPanelSubmitting(true);

    reauth.execute(
      'UPDATE_ASSET',
      async (password?: string) => {
        const body = { lifecycleState: statusPanelState, remarks: statusPanelRemarks.trim() };
        if (password) {
          await api.patchWithReauth(`/api/assets/instances/${statusPanelFilter.id}/lifecycle-state`, body, password);
        } else {
          await api.patch(`/api/assets/instances/${statusPanelFilter.id}/lifecycle-state`, body);
        }
      },
      {
        onSuccess: () => {
          const label = LIFECYCLE_STATE_OPTIONS.find(o => o.value === statusPanelState)?.label ?? statusPanelState;
          toast.success('Status Updated', `${statusPanelFilter.name} updated to ${label}`);
          closeStatusPanel();
          mutate('/api/assets/instances?limit=500');
        },
        onError: (err: any) => {
          toast.error('Update Failed', err.message ?? 'Something went wrong');
          setStatusPanelSubmitting(false);
        },
      },
    );
  };

  const openPanel = (filter: { id: string; name: string }) => {
    closeStatusPanel(); // close status panel if open
    setPanelFilter(filter);
    setPanelAction('retire');
    setPanelRemarks('');
  };

  const closePanel = () => {
    setPanelFilter(null);
    setPanelRemarks('');
    setPanelSubmitting(false);
  };

  // RFID Tag handlers
  const openRfidPanel = (filter: { id: string; name: string }) => {
    closePanel(); closeStatusPanel();
    setRfidPanel(filter);
    setRfidTagValue('');
  };
  const closeRfidPanel = () => { setRfidPanel(null); setRfidTagValue(''); setRfidSubmitting(false); };

  const handleAssignRfid = async () => {
    if (!rfidPanel || !rfidTagValue.trim()) return;
    setRfidSubmitting(true);
    reauth.execute('CREATE_ASSET_IDENTIFIER', async (password?: string) => {
      const body = { assetId: rfidPanel.id, identifierType: 'RFID', identifierValue: rfidTagValue.trim(), isPrimary: true };
      if (password) await api.postWithReauth('/api/assets/identifiers', body, password);
      else await api.post('/api/assets/identifiers', body);
    }, {
      onSuccess: () => {
        toast.success('RFID Assigned', `Tag "${rfidTagValue.trim()}" assigned to ${rfidPanel!.name}`);
        setRfidTagValue(''); setRfidSubmitting(false);
        mutate('/api/assets/identifiers?limit=1000');
      },
      onError: (e: any) => { toast.error('Error', e?.message ?? 'Failed to assign tag'); setRfidSubmitting(false); },
    });
  };

  const handleUnassignRfid = async (identifierId: string) => {
    setRfidSubmitting(true);
    reauth.execute('DELETE_ASSET_IDENTIFIER', async (password?: string) => {
      if (password) await api.deleteWithReauth(`/api/assets/identifiers/${identifierId}`, password);
      else await api.delete(`/api/assets/identifiers/${identifierId}`);
    }, {
      onSuccess: () => {
        toast.success('RFID Removed', 'Tag unassigned from filter');
        setRfidSubmitting(false);
        mutate('/api/assets/identifiers?limit=1000');
      },
      onError: (e: any) => { toast.error('Error', e?.message ?? 'Failed to remove tag'); setRfidSubmitting(false); },
    });
  };

  const handlePanelSubmit = async () => {
    if (!panelFilter || !panelRemarks.trim()) return;
    setPanelSubmitting(true);
    try {
      const endpoint = panelAction === 'retire'
        ? `/api/filters/${panelFilter.id}/retire`
        : `/api/filters/${panelFilter.id}/replace`;
      const result = await api.post<any>(endpoint, { remarks: panelRemarks.trim() });
      if (panelAction === 'replace' && result.newFilterName) {
        toast.success('Filter Replaced', `New filter created: ${result.newFilterName}`);
      } else {
        toast.success('Filter Retired', `${panelFilter.name} has been retired`);
      }
      closePanel();
      mutate('/api/assets/instances?limit=500');
    } catch (err: any) {
      toast.error('Action Failed', err.message ?? 'Something went wrong');
    } finally {
      setPanelSubmitting(false);
    }
  };

  // ── Multi-select helpers ──
  const toggleFilterSelect = (id: string) => {
    setSelectedFilterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectableFilters = blockFilters.filter(f => f.currentState !== 'RETIRED');
  const allSelected = selectableFilters.length > 0 && selectableFilters.every(f => selectedFilterIds.has(f.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedFilterIds(new Set());
    } else {
      setSelectedFilterIds(new Set(selectableFilters.map(f => f.id)));
    }
  };

  const openBulkStatusPanel = () => {
    if (selectedFilterIds.size === 0) return;
    closePanel(); closeRfidPanel();
    setBulkAction('status');
    setStatusPanelState('INSTALLED');
    setStatusPanelRemarks('');
  };

  const openBulkRetirePanel = (action: 'retire' | 'replace') => {
    if (selectedFilterIds.size === 0) return;
    closeStatusPanel(); closeRfidPanel();
    setBulkAction(action);
    setPanelAction(action);
    setPanelRemarks('');
  };

  const closeBulkPanel = () => {
    setBulkAction(null);
    setStatusPanelRemarks('');
    setPanelRemarks('');
    setStatusPanelSubmitting(false);
    setPanelSubmitting(false);
  };

  const handleBulkStatusSubmit = () => {
    if (!statusPanelState || !statusPanelRemarks.trim() || selectedFilterIds.size === 0) return;
    setStatusPanelSubmitting(true);
    const ids = Array.from(selectedFilterIds);
    let completed = 0;
    let failed = 0;

    reauth.execute(
      'UPDATE_ASSET',
      async (password?: string) => {
        for (const id of ids) {
          try {
            const body = { lifecycleState: statusPanelState, remarks: statusPanelRemarks.trim() };
            if (password) {
              await api.patchWithReauth(`/api/assets/instances/${id}/lifecycle-state`, body, password);
            } else {
              await api.patch(`/api/assets/instances/${id}/lifecycle-state`, body);
            }
            completed++;
          } catch { failed++; }
        }
      },
      {
        onSuccess: () => {
          const label = LIFECYCLE_STATE_OPTIONS.find(o => o.value === statusPanelState)?.label ?? statusPanelState;
          toast.success('Bulk Status Update', `${completed} filter(s) updated to ${label}${failed ? `, ${failed} failed` : ''}`);
          closeBulkPanel();
          setSelectedFilterIds(new Set());
          mutate('/api/assets/instances?limit=500');
        },
        onError: (err: any) => {
          toast.error('Update Failed', err.message ?? 'Something went wrong');
          setStatusPanelSubmitting(false);
        },
      },
    );
  };

  const handleBulkRetireSubmit = async () => {
    if (!panelRemarks.trim() || selectedFilterIds.size === 0) return;
    setPanelSubmitting(true);
    const ids = Array.from(selectedFilterIds);
    let completed = 0;
    let failed = 0;
    const action = bulkAction === 'replace' ? 'replace' : 'retire';

    for (const id of ids) {
      try {
        await api.post(`/api/filters/${id}/${action}`, { remarks: panelRemarks.trim() });
        completed++;
      } catch { failed++; }
    }

    toast.success(
      action === 'retire' ? 'Bulk Retirement' : 'Bulk Replacement',
      `${completed} filter(s) ${action === 'retire' ? 'retired' : 'replaced'}${failed ? `, ${failed} failed` : ''}`,
    );
    closeBulkPanel();
    setSelectedFilterIds(new Set());
    mutate('/api/assets/instances?limit=500');
  };

  // ── Bulk upload helpers ──
  // Get Filter template attributeSchema for dynamic CSV columns
  const filterTemplateSchema = useMemo(() => {
    const tpl = templates.find((t: any) => t.name === 'Filter');
    if (!tpl?.attributeSchema) return [];
    const schema = Array.isArray(tpl.attributeSchema) ? tpl.attributeSchema : [];
    return schema as { fieldName: string; dataType?: string; required?: boolean; dropdownOptions?: string[]; unit?: string }[];
  }, [templates]);

  // AHUs available for bulk upload — scoped by current diagram filter
  const bulkUploadAhus = useMemo(() => {
    if (!selectedBlock) return [];
    const blockTree = treeData.find((b: any) => b.id === selectedBlock);
    if (!blockTree) return [];
    const allAhus: { id: string; name: string }[] = [];
    if (diagramFilter?.type === 'ahu') {
      // Single AHU context
      allAhus.push({ id: diagramFilter.id, name: diagramFilter.name });
    } else if (diagramFilter?.type === 'area') {
      // AHUs under this area
      const area = blockTree.areas.find((a: any) => a.id === diagramFilter.id);
      if (area) area.ahus.forEach((h: any) => allAhus.push({ id: h.id, name: h.name }));
    } else {
      // All AHUs in the block
      blockTree.areas.forEach((a: any) => a.ahus.forEach((h: any) => allAhus.push({ id: h.id, name: h.name })));
      blockTree.directAhus.forEach((h: any) => allAhus.push({ id: h.id, name: h.name }));
    }
    return allAhus;
  }, [selectedBlock, treeData, diagramFilter]);

  // ── Hierarchy edit/delete helpers ──
  const openHierarchyEdit = (node: { id: string; name: string; entityType: string }) => {
    setHierarchyEditDialog(node);
    setHierarchyEditName(node.name);
    setHierarchyEditError('');
  };

  const submitHierarchyEdit = async () => {
    if (!hierarchyEditDialog || !hierarchyEditName.trim()) {
      setHierarchyEditError('Name is required.');
      return;
    }
    setHierarchyEditSubmitting(true);
    setHierarchyEditError('');
    const id = hierarchyEditDialog.id;
    await reauth.execute('EDIT_HIERARCHY_NODE', async (password?: string) => {
      const body = { name: hierarchyEditName.trim() };
      if (password) await api.putWithReauth(`/api/assets/instances/${id}`, body, password);
      else await api.put(`/api/assets/instances/${id}`, body);
    }, {
      onSuccess: () => {
        toast.success('Updated', `"${hierarchyEditName}" saved`);
        setHierarchyEditDialog(null);
        mutate('/api/assets/instances?limit=500');
        setHierarchyEditSubmitting(false);
      },
      onError: (err: any) => {
        setHierarchyEditError(err?.message ?? 'Failed to update');
        setHierarchyEditSubmitting(false);
      },
    });
  };

  const submitHierarchyDelete = async () => {
    if (!hierarchyDeleteDialog) return;
    setHierarchyDeleteSubmitting(true);
    const { id, name, entityType } = hierarchyDeleteDialog;
    await reauth.execute('DELETE_HIERARCHY_NODE', async (password?: string) => {
      if (password) await api.deleteWithReauth(`/api/assets/instances/${id}`, password);
      else await api.delete(`/api/assets/instances/${id}`);
    }, {
      onSuccess: () => {
        toast.success('Deleted', `${entityType} "${name}" removed`);
        setHierarchyDeleteDialog(null);
        mutate('/api/assets/instances?limit=500');
        setHierarchyDeleteSubmitting(false);
      },
      onError: (err: any) => {
        toast.error('Delete failed', err?.message ?? 'Could not delete');
        setHierarchyDeleteSubmitting(false);
      },
    });
  };

  // ── Edit filter helpers ──
  const openEditFilter = (f: { id: string; name: string; filterSet?: string }) => {
    setEditFilterDialog(f);
    setEditFilterName(f.name);
    setEditFilterSet((f.filterSet === 'B' ? 'B' : 'A') as 'A' | 'B');
    setEditFilterError('');
  };

  const submitEditFilter = async () => {
    if (!editFilterDialog || !editFilterName.trim()) {
      setEditFilterError('Filter name is required.');
      return;
    }
    setEditFilterSubmitting(true);
    setEditFilterError('');
    const id = editFilterDialog.id;
    await reauth.execute('EDIT_FILTER', async (password?: string) => {
      const body = { name: editFilterName.trim(), filterSet: editFilterSet };
      if (password) await api.putWithReauth(`/api/assets/instances/${id}`, body, password);
      else await api.put(`/api/assets/instances/${id}`, body);
    }, {
      onSuccess: () => {
        toast.success('Filter Updated', `"${editFilterName}" saved`);
        setEditFilterDialog(null);
        mutate('/api/assets/instances?limit=500');
        setEditFilterSubmitting(false);
      },
      onError: (err: any) => {
        setEditFilterError(err?.message ?? 'Failed to update filter');
        setEditFilterSubmitting(false);
      },
    });
  };

  // ── Delete filter helpers ──
  const submitDeleteFilter = async () => {
    if (!deleteFilterDialog) return;
    setDeleteFilterSubmitting(true);
    const { id, name } = deleteFilterDialog;
    await reauth.execute('DELETE_FILTER', async (password?: string) => {
      if (password) await api.deleteWithReauth(`/api/assets/instances/${id}`, password);
      else await api.delete(`/api/assets/instances/${id}`);
    }, {
      onSuccess: () => {
        toast.success('Filter Deleted', `"${name}" removed`);
        setDeleteFilterDialog(null);
        setSelectedFilterIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        mutate('/api/assets/instances?limit=500');
        setDeleteFilterSubmitting(false);
      },
      onError: (err: any) => {
        toast.error('Delete failed', err?.message ?? 'Could not delete filter');
        setDeleteFilterSubmitting(false);
      },
    });
  };

  // ── Single-filter create helpers ──
  const openCreateFilter = () => {
    setCreateFilterOpen(true);
    setCreateFilterAhu(bulkUploadAhus.length === 1 ? bulkUploadAhus[0].id : '');
    setCreateFilterName('');
    setCreateFilterSet('A');
    setCreateFilterProfile('');
    setCreateFilterError('');
  };

  const submitCreateFilter = async () => {
    if (!createFilterAhu || !createFilterName.trim() || !filterTemplateId) {
      setCreateFilterError('Please choose an AHU and enter a filter name.');
      return;
    }
    setCreateFilterSubmitting(true);
    setCreateFilterError('');
    try {
      await reauth.execute('CREATE_FILTER', async (password?: string) => {
        const body = {
          name: createFilterName.trim(),
          templateId: filterTemplateId,
          parentId: createFilterAhu,
          filterSet: createFilterSet,
          ...(createFilterProfile && { filterProfileId: createFilterProfile }),
        };
        if (password) await api.postWithReauth('/api/assets/instances', body, password);
        else await api.post('/api/assets/instances', body);
      }, {
        onSuccess: () => {
          toast.success('Filter Created', `"${createFilterName}" added`);
          setCreateFilterOpen(false);
          mutate('/api/assets/instances?limit=500');
          setCreateFilterSubmitting(false);
        },
        onError: (err: any) => {
          setCreateFilterError(err?.message ?? 'Failed to create filter');
          setCreateFilterSubmitting(false);
        },
      });
    } catch (err: any) {
      setCreateFilterError(err?.message ?? 'Failed to create filter');
      setCreateFilterSubmitting(false);
    }
  };

  const openBulkUpload = () => {
    setBulkUploadOpen(true);
    setBulkUploadStep('select');
    setBulkUploadAhu(bulkUploadAhus.length === 1 ? bulkUploadAhus[0].id : '');
    setBulkUploadFile(null);
    setBulkUploadRows([]);
    setBulkUploadError('');
    setBulkUploadResults([]);
    setBulkUploadCreated(0);
    setBulkUploadFailed(0);
  };

  const closeBulkUpload = () => { setBulkUploadOpen(false); };

  const handleBulkUploadFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBulkUploadFile(f);
    setBulkUploadError('');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setBulkUploadError('CSV must have a header and at least one data row'); return; }
        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
        const colMap: Record<string, number> = {};
        header.forEach((h, i) => { colMap[h] = i; });
        const nameIdx = colMap['name'] ?? colMap['filtername'] ?? colMap['filterid'] ?? -1;
        const setIdx = colMap['filterset'] ?? -1;
        if (nameIdx === -1) { setBulkUploadError('CSV must have a "name" column'); return; }
        if (setIdx === -1) { setBulkUploadError('CSV must have a "filterSet" column'); return; }
        const getCol = (cols: string[], key: string) => { const idx = colMap[key]; return idx !== undefined && idx < cols.length ? cols[idx].trim() : ''; };
        // Build list of template field names (lowercase keys for matching)
        const templateFieldKeys = filterTemplateSchema.map(f => f.fieldName.toLowerCase().replace(/\s+/g, ''));
        const rows: any[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          const name = cols[nameIdx] || '';
          if (!name) continue;
          const row: any = { name, filterSet: cols[setIdx] || '' };
          // Parse all template fields dynamically
          for (const f of filterTemplateSchema) {
            const key = f.fieldName.toLowerCase().replace(/\s+/g, '');
            row[f.fieldName] = getCol(cols, key);
          }
          rows.push(row);
        }
        if (rows.length === 0) { setBulkUploadError('No valid rows found'); return; }
        if (rows.length > 200) { setBulkUploadError('Maximum 200 filters per upload'); return; }
        setBulkUploadRows(rows);
        setBulkUploadStep('preview');
      } catch { setBulkUploadError('Failed to parse CSV file'); }
    };
    reader.readAsText(f);
  };

  const handleBulkUploadSubmit = async () => {
    if (!bulkUploadFile || !bulkUploadAhu) return;
    setBulkUploadStep('uploading');
    try {
      const formData = new FormData();
      formData.append('file', bulkUploadFile);
      formData.append('ahuId', bulkUploadAhu);
      if (selectedBlock) formData.append('blockId', selectedBlock);
      const token = sessionStorage.getItem('access_token');
      const res = await fetch('/api/assets/instances/bulk-upload-filters', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkUploadResults([{ row: 0, name: '', status: 'error', error: data.message || 'Upload failed' }]);
        setBulkUploadFailed(1);
        setBulkUploadStep('results');
        return;
      }
      setBulkUploadResults(data.results || []);
      setBulkUploadCreated(data.created || 0);
      setBulkUploadFailed(data.failed || 0);
      setBulkUploadStep('results');
      if (data.created > 0) mutate('/api/assets/instances?limit=500');
    } catch (e: any) {
      setBulkUploadResults([{ row: 0, name: '', status: 'error', error: e.message || 'Network error' }]);
      setBulkUploadFailed(1);
      setBulkUploadStep('results');
    }
  };

  const downloadBulkTemplate = () => {
    // Build header: name, filterSet, then all fields from Filter template attributeSchema
    const extraCols = filterTemplateSchema.map(f => f.fieldName);
    const header = ['name', 'filterSet', ...extraCols];
    // Build a sample row with hints
    const sampleValues: Record<string, string> = { name: 'HEPA-A-001', filterSet: 'A' };
    for (const f of filterTemplateSchema) {
      if (f.dropdownOptions?.length) sampleValues[f.fieldName] = f.dropdownOptions[0];
      else if (f.dataType === 'INTEGER' || f.dataType === 'FLOAT') sampleValues[f.fieldName] = '0';
      else if (f.dataType === 'BOOLEAN') sampleValues[f.fieldName] = 'true';
      else if (f.dataType === 'DATE' || f.dataType === 'DATETIME') sampleValues[f.fieldName] = '';
      else sampleValues[f.fieldName] = '';
    }
    const sampleRow = header.map(h => sampleValues[h] ?? '');
    const csv = header.join(',') + '\n' + sampleRow.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'filter-upload-template.csv';
    a.click();
  };

  // Navigate from diagram node to filters tab
  const navigateFromDiagram = (type: 'block' | 'area' | 'ahu' | 'filter', id: string, name: string) => {
    setDiagramFilter({ type, id, name });
    setBlockTab('filters');
    setPage(1);
    setSelectedFilterIds(new Set());
  };

  // ── Diagram node renderers (entities-style hierarchy) ──

  function renderFilterDiagNode(f: any) {
    const rfidTags = (identifiersByAsset.get(f.id) ?? []).filter((i: any) => i.identifierType === 'RFID');
    const stateInfo = STATUS_LABELS[f.currentLifecycleState ?? ''] ?? { label: f.currentLifecycleState?.replace(/_/g, ' ') ?? 'Idle', color: 'bg-slate-100 text-slate-500 border-slate-300' };
    return (
      <div key={f.id} className="flex flex-col items-center">
        <button onClick={() => navigateFromDiagram('filter', f.id, f.name)}
          className="flex flex-col items-center px-3 py-2 rounded-xl border-2 border-slate-300 bg-white shadow-sm min-w-[100px] max-w-[130px] hover:border-[var(--theme-primary)] hover:bg-[var(--theme-primary-light)] hover:shadow-md cursor-pointer transition-all">
          <svg className="w-4 h-4 mb-0.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="text-[10px] font-bold text-center text-slate-700 truncate w-full">{f.name}</span>
          <span className={`text-[8px] mt-0.5 px-1.5 py-0.5 rounded-full border font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
          {rfidTags.length > 0 && <span className="text-[7px] font-mono mt-0.5 truncate w-full text-center text-theme-primary">{rfidTags[0].identifierValue}</span>}
          {f.filterSet && <span className="text-[7px] text-slate-400 mt-0.5">{f.filterSet.replace('_', ' ')}</span>}
        </button>
      </div>
    );
  }

  function renderChildrenConnector(children: React.ReactNode[], minWidth: number = 150) {
    if (children.length === 0) return null;
    return (
      <div className="flex flex-col items-center w-full">
        <div className="w-px h-5 bg-slate-300" />
        <svg className="w-3 h-2 text-slate-400 -mt-px" viewBox="0 0 12 8">
          <path d="M0 0 L6 8 L12 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {children.length === 1 ? (
          <div className="flex flex-col items-center">
            <div className="w-px h-3 bg-slate-300" />
            {children[0]}
          </div>
        ) : (
          <div className="flex flex-col items-center w-full">
            <div className="relative flex justify-center" style={{ minWidth: `${children.length * minWidth}px` }}>
              <div className="absolute top-0 h-px bg-slate-300" style={{
                left: `${100 / (children.length * 2)}%`,
                right: `${100 / (children.length * 2)}%`,
              }} />
              <div className="flex justify-center gap-4 w-full">
                {children.map((child, i) => (
                  <div key={i} className="flex flex-col items-center flex-1" style={{ minWidth: `${minWidth - 20}px` }}>
                    <div className="w-px h-4 bg-slate-300" />
                    <svg className="w-3 h-2 text-slate-400 -mt-px" viewBox="0 0 12 8">
                      <path d="M0 0 L6 8 L12 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="h-1" />
                    {child}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderAhuDiagNode(ahu: any, blockId: string, blockName: string) {
    const filterNodes = (ahu.filters ?? []).map((f: any) => renderFilterDiagNode(f));
    return (
      <div key={ahu.id} className="flex flex-col items-center group/ahu">
        <div className="relative">
          <button onClick={() => navigateFromDiagram('ahu', ahu.id, ahu.name)}
            className="flex flex-col items-center px-4 py-2.5 rounded-xl border-2 border-teal-500 bg-teal-50 shadow-sm min-w-[110px] max-w-[150px] hover:bg-teal-100 hover:shadow-md cursor-pointer transition-all">
            <svg className="w-5 h-5 mb-0.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-bold text-center text-teal-800 truncate w-full">{ahu.name}</span>
            <span className="text-[9px] mt-0.5 text-teal-500">AHU</span>
          </button>
          <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover/ahu:opacity-100 transition-opacity">
            {canEditHierarchy && (
              <button onClick={(e) => { e.stopPropagation(); openHierarchyEdit({ id: ahu.id, name: ahu.name, entityType: 'AHU' }); }}
                className="w-6 h-6 rounded-full bg-white border border-amber-300 text-amber-600 hover:bg-amber-50 shadow-sm flex items-center justify-center" title="Edit AHU">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
            )}
            {canDeleteHierarchy && (
              <button onClick={(e) => { e.stopPropagation(); setHierarchyDeleteDialog({ id: ahu.id, name: ahu.name, entityType: 'AHU' }); }}
                className="w-6 h-6 rounded-full bg-white border border-red-300 text-red-600 hover:bg-red-50 shadow-sm flex items-center justify-center" title="Delete AHU">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
          </div>
        </div>
        {filterNodes.length > 0 && renderChildrenConnector(filterNodes, 130)}
      </div>
    );
  }

  function renderAreaDiagNode(area: any) {
    const ahuNodes = (area.ahus ?? []).map((ahu: any) => renderAhuDiagNode(ahu, '', ''));
    return (
      <div key={area.id} className="flex flex-col items-center group/area">
        <div className="relative">
          <button onClick={() => navigateFromDiagram('area', area.id, area.name)}
            className="flex flex-col items-center px-4 py-2.5 rounded-xl border-2 border-purple-500 bg-purple-50 shadow-sm min-w-[110px] max-w-[150px] hover:bg-purple-100 hover:shadow-md cursor-pointer transition-all">
            <svg className="w-5 h-5 mb-0.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
            </svg>
            <span className="text-xs font-bold text-center text-purple-800 truncate w-full">{area.name}</span>
            <span className="text-[9px] mt-0.5 text-purple-500">Area</span>
          </button>
          {/* Hover: Add AHU / Edit / Delete */}
          <div className="absolute -top-2 -right-2 flex gap-0.5 opacity-0 group-hover/area:opacity-100 transition-opacity z-10">
            {canCreate && (
              <button
                className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center shadow-sm hover:bg-teal-600 transition-colors"
                title="Add AHU"
                onClick={(e) => { e.stopPropagation(); setCreateDialog({ type: 'ahu', parentId: area.id, parentName: area.name }); }}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              </button>
            )}
            {canEditHierarchy && (
              <button
                className="w-6 h-6 rounded-full bg-white border border-amber-300 text-amber-600 hover:bg-amber-50 shadow-sm flex items-center justify-center"
                title="Edit Area"
                onClick={(e) => { e.stopPropagation(); openHierarchyEdit({ id: area.id, name: area.name, entityType: 'Area' }); }}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
            )}
            {canDeleteHierarchy && (
              <button
                className="w-6 h-6 rounded-full bg-white border border-red-300 text-red-600 hover:bg-red-50 shadow-sm flex items-center justify-center"
                title="Delete Area"
                onClick={(e) => { e.stopPropagation(); setHierarchyDeleteDialog({ id: area.id, name: area.name, entityType: 'Area' }); }}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
          </div>
        </div>
        {ahuNodes.length > 0 && renderChildrenConnector(ahuNodes, 160)}
      </div>
    );
  }

  // Summary stats for header
  const totalAhus = useMemo(() => {
    return instances.filter((i: any) => i.templateId === ahuTemplateId && i.isActive !== false).length;
  }, [instances, ahuTemplateId]);

  return (
    <div className="p-6 space-y-6">

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {selectedBlock && (
            <button onClick={() => { setSelectedBlock(null); setBlockTab('view'); setSelectedFilterIds(new Set()); setDiagramFilter(null); }}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {selectedBlock ? selectedBlockName : 'Filter Management'}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedBlock
                ? `${blockFilters.length} filter(s) in this block`
                : `${enrichedFilters.length} filters across ${blocks.length} blocks`
              }
            </p>
          </div>
        </div>

        {/* Tab toggle when block is selected */}
        {selectedBlock && (
          <div className="flex items-center bg-slate-100 rounded-lg p-1">
            <button onClick={() => { setBlockTab('view'); setDiagramFilter(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                blockTab === 'view'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Structure
            </button>
            <button onClick={() => { setBlockTab('filters'); setDiagramFilter(null); setPage(1); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                blockTab === 'filters'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
            </button>
          </div>
        )}
      </div>

      {/* ── Summary Stats (block list screen only) ── */}
      {!selectedBlock && !isLoading && blocks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Blocks', value: blocks.length, color: 'text-[var(--theme-primary-dark)]', bg: 'bg-[var(--theme-primary-light)] border-[var(--theme-primary-light)]' },
            { label: 'Total AHUs', value: totalAhus, color: 'text-teal-700', bg: 'bg-teal-50 border-teal-100' },
            { label: 'Active Filters', value: enrichedFilters.length, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100' },
            { label: 'With RFID', value: enrichedFilters.filter(f => (identifiersByAsset.get(f.id) ?? []).some((i: any) => i.identifierType === 'RFID')).length, color: 'text-violet-700', bg: 'bg-violet-50 border-violet-100' },
          ].map(stat => (
            <div key={stat.label} className={`rounded-xl border px-4 py-3.5 ${stat.bg}`}>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{stat.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Block Selection Grid ── */}
      {!selectedBlock && (
        <>
          {isLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-20 text-center">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-slate-400">Loading blocks...</p>
            </div>
          ) : blocks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-20 text-center">
              <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <p className="text-slate-600 font-medium mb-1">No blocks found</p>
              <p className="text-sm text-slate-400 mb-4">{canCreate ? 'Create your first block to get started.' : 'No blocks available.'}</p>
              {canCreate && (
                <button onClick={() => setCreateDialog({ type: 'block' })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-sm font-semibold hover:shadow-xl transition-all"
                  style={themeButton}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                  Create Block
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {/* New Block card */}
              {canCreate && <button
                onClick={() => setCreateDialog({ type: 'block' })}
                className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-[var(--theme-primary)] hover:bg-[var(--theme-primary-light)] transition-all group flex flex-col items-center justify-center min-h-[140px]"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-[var(--theme-primary-light)] flex items-center justify-center mb-2 transition-colors">
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-[var(--theme-primary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-500 group-hover:text-[var(--theme-primary-dark)] transition-colors">New Block</span>
              </button>}
              {blocks.map((block: any) => {
                const count = blockCounts[block.id] ?? 0;
                const blockTree = treeData.find((b: any) => b.id === block.id);
                const ahuCount = blockTree ? blockTree.areas.reduce((s: number, a: any) => s + a.ahus.length, 0) + blockTree.directAhus.length : 0;
                return (
                  <button
                    key={block.id}
                    onClick={() => { setSelectedBlock(block.id); setBlockTab('view'); setSelectedFilterIds(new Set()); setPage(1); }}
                    className="bg-white border border-slate-200 rounded-xl p-5 text-left hover:border-[var(--theme-primary)] hover:shadow-md transition-all group"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow" style={themeGradientBr}>
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-800 truncate flex-1">{block.name}</h3>
                      {hasPerm('ASSET_DELETE') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteBlockDialog({ id: block.id, name: block.name }); }}
                          className="w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete block"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-2xl font-bold text-slate-800">{count}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Filters</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-slate-500">{ahuCount}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">AHUs</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Selected Block Content ── */}
      {selectedBlock && (
        <>
          {/* ── Structure Tab ── */}
          {blockTab === 'view' && (() => {
            const block = treeData.find((b: any) => b.id === selectedBlock);
            if (!block) return null;
            const allBlockChildren: { id: string; name: string; type: 'area' | 'ahu'; ahus?: any[]; filters?: any[] }[] = [
              ...block.areas.map((a: any) => ({ ...a, type: 'area' as const })),
              ...block.directAhus.map((h: any) => ({ ...h, type: 'ahu' as const })),
            ];
            return (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <span className="text-sm font-semibold text-slate-700">Hierarchy</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 inline-block" style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }} /> Block</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 border-purple-500 bg-purple-50 inline-block" /> Area</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 border-teal-500 bg-teal-50 inline-block" /> AHU</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 border-slate-300 bg-white inline-block" /> Filter</span>
                  </div>
                </div>
                <div className="px-6 py-8 overflow-x-auto min-h-[400px] flex items-start justify-center">
                  <div className="flex justify-center min-w-fit">
                    <div className="flex flex-col items-center group/block">
                      <div className="relative">
                        <button onClick={() => navigateFromDiagram('block', block.id, block.name)}
                          className="flex flex-col items-center px-5 py-3 rounded-xl border-2 shadow-md ring-2 min-w-[130px] max-w-[170px] hover:shadow-lg cursor-pointer transition-all"
                          style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)', '--tw-ring-color': 'var(--theme-primary-light)' } as React.CSSProperties}>
                          <svg className="w-5 h-5 mb-1 text-theme-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          <span className="text-xs font-bold text-center truncate w-full" style={{ color: 'var(--theme-primary-dark)' }}>{block.name}</span>
                          <span className="text-[9px] mt-0.5 text-theme-primary">Block</span>
                        </button>
                        {canCreate && (
                          <div className="absolute -top-2 -right-2 flex gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
                            <button className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center shadow-sm hover:bg-purple-600 transition-colors" title="Add Area"
                              onClick={() => setCreateDialog({ type: 'area', parentId: block.id, parentName: block.name })}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                            </button>
                            <button className="w-5 h-5 rounded-full bg-teal-500 text-white flex items-center justify-center shadow-sm hover:bg-teal-600 transition-colors" title="Add AHU"
                              onClick={() => setCreateDialog({ type: 'ahu', parentId: block.id, parentName: block.name })}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                            </button>
                          </div>
                        )}
                      </div>
                      {allBlockChildren.length > 0 && renderChildrenConnector(
                        allBlockChildren.map((child) =>
                          child.type === 'area'
                            ? renderAreaDiagNode(child as any)
                            : renderAhuDiagNode(child as any, block.id, block.name)
                        ), 180,
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Filters Tab ── */}
          {blockTab === 'filters' && (
          <>
          {/* Filters tab toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Active diagram filter chip */}
              {diagramFilter && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Showing:</span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border font-medium text-xs ${
                    diagramFilter.type === 'block' ? 'bg-[var(--theme-primary-light)] text-[var(--theme-primary-dark)] border-[var(--theme-primary)]'
                    : diagramFilter.type === 'area' ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : diagramFilter.type === 'ahu' ? 'bg-teal-50 text-teal-700 border-teal-200'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}>
                    {diagramFilter.type.toUpperCase()}: {diagramFilter.name}
                    <button onClick={() => { setDiagramFilter(null); setPage(1); }} className="ml-0.5 hover:text-red-500 transition-colors" title="Show all">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </span>
                </div>
              )}
            </div>
            {canCreateFilter && bulkUploadAhus.length > 0 && (
              <button onClick={openCreateFilter}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-sm transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Create Filter
              </button>
            )}
            {canBulkUpload && (
              <button onClick={openBulkUpload}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-white rounded-lg text-xs font-semibold shadow-sm hover:shadow-md transition-all"
                style={themeButton}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                Bulk Upload
              </button>
            )}
          </div>

          {/* Bulk action bar */}
          {selectedFilterIds.size > 0 && (
            <div className="rounded-xl px-5 py-3 flex items-center justify-between" style={{ backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-dark)' }}>{selectedFilterIds.size} filter(s) selected</span>
              <div className="flex items-center gap-2">
                {canStatusUpdate && (
                  <button onClick={openBulkStatusPanel}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    Update Status
                  </button>
                )}
                {canRetire && (
                  <button onClick={() => openBulkRetirePanel('retire')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    Retire
                  </button>
                )}
                {canReplace && (
                  <button onClick={() => openBulkRetirePanel('replace')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white text-xs font-semibold rounded-lg hover:bg-orange-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Replace
                  </button>
                )}
                <button onClick={() => setSelectedFilterIds(new Set())}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors">
                  Clear
                </button>
              </div>
            </div>
          )}

          {blockFilters.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
              <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <p className="text-slate-600 font-medium mb-1">No filters in this block</p>
              <p className="text-sm text-slate-400">Filters will appear here once assigned to AHUs in this block.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="w-10 px-3 py-3">
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-[var(--theme-primary)] focus:ring-[var(--theme-focus-ring)] cursor-pointer" />
                      </th>
                      <th className="w-14 text-center px-2 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">S.No</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">AHU</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">AHU Type</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Filter</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Set</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Last Cleaned</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">RFID</th>
                      <th className="text-right px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedFilters.map((f, idx) => {
                      const stateInfo = STATUS_LABELS[f.currentState ?? ''] ?? { label: f.currentState?.replace(/_/g, ' ') ?? 'Idle', color: 'bg-slate-100 text-slate-500 border-slate-300' };
                      const tags = (identifiersByAsset.get(f.id) ?? []).filter((i: any) => i.identifierType === 'RFID');
                      const isSelected = selectedFilterIds.has(f.id);
                      const isRetired = f.currentState === 'RETIRED';
                      return (
                        <tr key={f.id} className={`transition-colors ${isSelected ? 'bg-[var(--theme-primary-light)]' : 'hover:bg-slate-50/50'}`}>
                          <td className="w-10 px-3 py-3.5">
                            {!isRetired ? (
                              <input type="checkbox" checked={isSelected} onChange={() => toggleFilterSelect(f.id)}
                                className="w-4 h-4 rounded border-slate-300 text-[var(--theme-primary)] focus:ring-[var(--theme-focus-ring)] cursor-pointer" />
                            ) : <div className="w-4 h-4" />}
                          </td>
                          <td className="w-14 text-center px-2 py-3.5 text-sm text-slate-400 font-medium">{(page - 1) * perPage + idx + 1}</td>
                          <td className="px-5 py-3.5">
                            {f.ahuId ? (
                              <Link to={`/ahus/${f.ahuId}`} className="text-sm hover:opacity-80 font-medium text-theme-primary">{f.ahuName}</Link>
                            ) : (
                              <span className="text-sm text-slate-400">--</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-500">{f.ahuType !== '-' ? f.ahuType : '--'}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${FILTER_STATE_COLORS[f.currentState ?? ''] ?? 'bg-gray-400'}`} />
                              <span className="text-sm font-medium text-slate-800">{f.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-500">{f.filterType}</td>
                          <td className="px-5 py-3.5">
                            {f.filterSet ? (
                              <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${f.filterSet === 'SET_A' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                                {f.filterSet === 'SET_A' ? 'Set A' : 'Set B'}
                              </span>
                            ) : <span className="text-sm text-slate-300">--</span>}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-500">{f.lastCleaningDate ? formatDate(f.lastCleaningDate) : '--'}</td>
                          <td className="px-5 py-3.5">
                            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            {tags.length > 0 ? (
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md" style={{ color: 'var(--theme-primary-dark)', backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>{tags[0].identifierValue}</span>
                            ) : (
                              <span className="text-sm text-slate-300">--</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-end gap-0.5">
                              <Link to={`/filters/${f.id}/trace`}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-[var(--theme-primary)] hover:bg-[var(--theme-primary-light)] transition-colors" title="History">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </Link>
                              {!isRetired && (
                                <>
                                  {canEditFilter && (
                                    <button onClick={() => openEditFilter({ id: f.id, name: f.name, filterSet: f.filterSet })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Edit Filter">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                  )}
                                  {canDeleteFilter && (
                                    <button onClick={() => setDeleteFilterDialog({ id: f.id, name: f.name })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete Filter">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  )}
                                  {canStatusUpdate && (
                                    <button onClick={() => openStatusPanel({ id: f.id, name: f.name, currentState: f.currentState })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Update Status">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                  )}
                                  {(canRetire || canReplace) && (
                                    <button onClick={() => openPanel({ id: f.id, name: f.name })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors" title="Retire / Replace">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0" />
                                      </svg>
                                    </button>
                                  )}
                                  {canRfid && (
                                    <button onClick={() => openRfidPanel({ id: f.id, name: f.name })}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-[var(--theme-primary)] hover:bg-[var(--theme-primary-light)] transition-colors" title="RFID Tag">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
                                      </svg>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination Footer */}
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span>Rows per page:</span>
                  <div className="flex items-center gap-1">
                    {paginationOptions.map(opt => (
                      <button key={opt} onClick={() => { setPerPage(opt); setPage(1); }}
                        className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
                          perPage === opt ? 'bg-[var(--theme-primary)] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                        }`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  <span className="text-slate-300">|</span>
                  <span>
                    Page <span className="font-semibold text-slate-800">{page}</span> of{' '}
                    <span className="font-semibold text-slate-800">{totalPages}</span>
                    <span className="text-slate-400 ml-2">({blockFilters.length} total{selectedFilterIds.size > 0 ? ` \u00b7 ${selectedFilterIds.size} selected` : ''})</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button disabled={page <= 1} onClick={() => setPage(1)}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                  </button>
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Prev
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pn: number;
                    if (totalPages <= 5) pn = i + 1;
                    else if (page <= 3) pn = i + 1;
                    else if (page >= totalPages - 2) pn = totalPages - 4 + i;
                    else pn = page - 2 + i;
                    return (
                      <button key={pn} onClick={() => setPage(pn)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                          pn === page ? 'bg-[var(--theme-primary)] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                        }`}>
                        {pn}
                      </button>
                    );
                  })}
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Next
                  </button>
                  <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </>
      )}
      {/* Update Status Side Panel */}
      {statusPanelFilter && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeStatusPanel} />
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Update Filter Status</h3>
              <button onClick={closeStatusPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Filter ID</label>
                <input type="text" value={statusPanelFilter.name} readOnly className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Current Status</label>
                <input
                  type="text"
                  value={statusPanelFilter.currentState ? (STATUS_LABELS[statusPanelFilter.currentState]?.label ?? statusPanelFilter.currentState.replace(/_/g, ' ')) : 'Idle'}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  New Status <span className="text-red-500">*</span>
                </label>
                <select
                  value={statusPanelState}
                  onChange={e => setStatusPanelState(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {LIFECYCLE_STATE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {statusPanelState === (statusPanelFilter.currentState ?? '') && (
                <div className="rounded-lg p-3 text-xs bg-amber-50 text-amber-700 border border-amber-200">
                  Please select a different status from the current one.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={statusPanelRemarks}
                  onChange={e => setStatusPanelRemarks(e.target.value)}
                  placeholder="Enter reason for status change..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button
                onClick={closeStatusPanel}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusSubmit}
                disabled={!statusPanelRemarks.trim() || statusPanelState === (statusPanelFilter.currentState ?? '') || statusPanelSubmitting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {statusPanelSubmitting ? 'Processing...' : 'Update Status'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Block Confirmation Dialog */}
      {deleteBlockDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteBlockDialog(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Delete Block</h3>
                  <p className="text-[12px] text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-5">
                Are you sure you want to delete <strong>{deleteBlockDialog.name}</strong>? All child areas, AHUs, and filters under this block will also be removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteBlockDialog(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleDeleteBlock} disabled={deletingBlock}
                  className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-red-500/25">
                  {deletingBlock ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update Status"
      />

      {/* Retire / Replace Side Panel */}
      {panelFilter && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closePanel} />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Retire / Replace Filter</h3>
              <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Filter ID (read-only) */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Filter ID</label>
                <input
                  type="text"
                  value={panelFilter.name}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                />
              </div>
              {/* Action dropdown */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Action</label>
                <select
                  value={panelAction}
                  onChange={e => setPanelAction(e.target.value as 'retire' | 'replace')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[var(--theme-focus-ring)] focus:border-[var(--theme-primary)]"
                >
                  <option value="retire">Retirement</option>
                  <option value="replace">Replacement</option>
                </select>
              </div>
              {/* Info box */}
              <div className={`rounded-lg p-3 text-xs ${panelAction === 'retire' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {panelAction === 'retire'
                  ? 'This will permanently retire the filter. It will be removed from the active filter list and cannot perform cleaning operations.'
                  : 'This will retire the current filter and create a new replacement filter with the same details and an incremented suffix number.'}
              </div>
              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={panelRemarks}
                  onChange={e => setPanelRemarks(e.target.value)}
                  placeholder="Enter reason for retirement/replacement..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-[var(--theme-focus-ring)] focus:border-[var(--theme-primary)]"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button
                onClick={closePanel}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePanelSubmit}
                disabled={!panelRemarks.trim() || panelSubmitting}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  panelAction === 'retire'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[var(--theme-primary)] hover:opacity-90'
                }`}
              >
                {panelSubmitting ? 'Processing...' : panelAction === 'retire' ? 'Retire Filter' : 'Replace Filter'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Block/Area/AHU Dialog */}
      {createDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className={`h-1.5 ${createDialog.type === 'block' ? '' : createDialog.type === 'area' ? 'bg-gradient-to-r from-purple-500 to-violet-500' : 'bg-gradient-to-r from-teal-500 to-emerald-500'}`} style={createDialog.type === 'block' ? { background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' } : undefined} />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${createDialog.type === 'area' ? 'bg-purple-50' : createDialog.type === 'ahu' ? 'bg-teal-50' : ''}`} style={createDialog.type === 'block' ? { backgroundColor: 'var(--theme-primary-light)' } : undefined}>
                  <svg className={`w-5 h-5 ${createDialog.type === 'area' ? 'text-purple-600' : createDialog.type === 'ahu' ? 'text-teal-600' : ''}`} style={createDialog.type === 'block' ? { color: 'var(--theme-primary)' } : undefined} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Create {createDialog.type === 'block' ? 'Block' : createDialog.type === 'area' ? 'Area' : 'AHU'}</h3>
                  {createDialog.parentName && <p className="text-[12px] text-slate-400">Under {createDialog.parentName}</p>}
                </div>
              </div>
              <div className="space-y-3 mb-5 max-h-[50vh] overflow-y-auto">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Name <span className="text-red-500">*</span></label>
                  <input value={createName} onChange={e => setCreateName(e.target.value)} autoFocus
                    placeholder={`Enter ${createDialog.type} name...`}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-800 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none" />
                </div>
                {/* Dynamic attribute fields from template schema */}
                {getTemplateSchema(createDialog.type).map((field: any) => (
                  <div key={field.fieldName}>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
                      {field.fieldName.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
                      {field.unit && <span className="text-slate-400 normal-case font-normal"> ({field.unit})</span>}
                      {field.required && <span className="text-red-500"> *</span>}
                    </label>
                    {field.dataType === 'DROPDOWN' ? (
                      <select
                        value={createAttrs[field.fieldName] ?? ''}
                        onChange={e => setCreateAttrs(p => ({ ...p, [field.fieldName]: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-800 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none"
                      >
                        <option value="">Select...</option>
                        {(field.dropdownOptions ?? []).map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.dataType === 'BOOLEAN' ? (
                      <select
                        value={createAttrs[field.fieldName] ?? ''}
                        onChange={e => setCreateAttrs(p => ({ ...p, [field.fieldName]: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-800 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none"
                      >
                        <option value="">Select...</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : field.dataType === 'DATE' ? (
                      <input
                        type="date"
                        value={createAttrs[field.fieldName] ?? ''}
                        onChange={e => setCreateAttrs(p => ({ ...p, [field.fieldName]: e.target.value }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-800 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none"
                      />
                    ) : (
                      <input
                        type={field.dataType === 'FLOAT' || field.dataType === 'NUMBER' || field.dataType === 'INTEGER' ? 'number' : 'text'}
                        step={field.dataType === 'FLOAT' ? 'any' : undefined}
                        value={createAttrs[field.fieldName] ?? ''}
                        onChange={e => setCreateAttrs(p => ({ ...p, [field.fieldName]: e.target.value }))}
                        placeholder={field.fieldName.replace(/_/g, ' ')}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] text-slate-800 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setCreateDialog(null); setCreateName(''); setCreateAttrs({}); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleCreate} disabled={creating || !createName.trim()}
                  className={`flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg ${
                    createDialog.type === 'block' ? ''
                    : createDialog.type === 'area' ? 'bg-gradient-to-r from-purple-600 to-violet-600 shadow-purple-500/25'
                    : 'bg-gradient-to-r from-teal-600 to-emerald-600 shadow-teal-500/25'
                  }`}
                  style={createDialog.type === 'block' ? themeButton : undefined}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RFID Tag Panel */}
      {rfidPanel && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={closeRfidPanel} />
          <div className="fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ ...themeGradientBr, boxShadow: '0 4px 14px -3px color-mix(in srgb, var(--theme-primary) 20%, transparent)' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">RFID Tag Management</h3>
                  <p className="text-[12px] text-slate-400">{rfidPanel.name}</p>
                </div>
              </div>
              <button onClick={closeRfidPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Current Tags */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Assigned Tags</h4>
                {(() => {
                  const tags = identifiersByAsset.get(rfidPanel.id) ?? [];
                  const rfidTags = tags.filter((t: any) => t.identifierType === 'RFID');
                  const otherTags = tags.filter((t: any) => t.identifierType !== 'RFID');
                  return (
                    <div className="space-y-2">
                      {rfidTags.length === 0 && otherTags.length === 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                          <p className="text-sm text-slate-400">No tags assigned to this filter</p>
                        </div>
                      )}
                      {rfidTags.map((tag: any) => (
                        <div key={tag.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>
                          <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-theme-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" />
                            </svg>
                            <div>
                              <div className="text-sm font-bold font-mono" style={{ color: 'var(--theme-primary-dark)' }}>{tag.identifierValue}</div>
                              <div className="text-[10px] text-theme-primary">RFID Tag</div>
                            </div>
                          </div>
                          <button onClick={() => handleUnassignRfid(tag.id)} disabled={rfidSubmitting}
                            className="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-[11px] font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                            Unassign
                          </button>
                        </div>
                      ))}
                      {otherTags.map((tag: any) => (
                        <div key={tag.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                          <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            <div>
                              <div className="text-sm font-medium text-slate-700">{tag.identifierValue}</div>
                              <div className="text-[10px] text-slate-400">{tag.identifierType}{tag.label ? ` — ${tag.label}` : ''}</div>
                            </div>
                          </div>
                          <button onClick={() => handleUnassignRfid(tag.id)} disabled={rfidSubmitting}
                            className="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-[11px] font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Assign New Tag */}
              <div className="border-t border-slate-200 pt-5">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Assign New RFID Tag</h4>
                <p className="text-[12px] text-slate-400 mb-3">Scan an RFID tag or enter the tag ID manually.</p>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={rfidTagValue}
                      onChange={e => setRfidTagValue(e.target.value)}
                      data-rfid="true"
                      placeholder="Scan RFID tag or type tag ID..."
                      autoFocus
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-800 font-mono bg-white focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-focus-ring)] outline-none pr-12"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
                      </svg>
                    </div>
                  </div>
                  <button
                    onClick={handleAssignRfid}
                    disabled={rfidSubmitting || !rfidTagValue.trim()}
                    className="w-full py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg hover:opacity-90 transition-all"
                    style={themeButton}
                  >
                    {rfidSubmitting ? 'Assigning...' : 'Assign Tag'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Bulk Status Update Panel */}
      {bulkAction === 'status' && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeBulkPanel} />
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Bulk Status Update</h3>
              <button onClick={closeBulkPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="rounded-lg p-3 text-xs bg-blue-50 text-blue-700 border border-blue-200">
                Updating <strong>{selectedFilterIds.size} filter(s)</strong> to the selected status.
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Selected Filters</label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {blockFilters.filter(f => selectedFilterIds.has(f.id)).map(f => (
                    <div key={f.id} className="text-xs text-slate-600 px-2 py-1 bg-slate-50 rounded">{f.name}</div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">New Status <span className="text-red-500">*</span></label>
                <select value={statusPanelState} onChange={e => setStatusPanelState(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  {LIFECYCLE_STATE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Remarks <span className="text-red-500">*</span></label>
                <textarea value={statusPanelRemarks} onChange={e => setStatusPanelRemarks(e.target.value)}
                  placeholder="Enter reason for status change..." rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={closeBulkPanel} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleBulkStatusSubmit} disabled={!statusPanelRemarks.trim() || statusPanelSubmitting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {statusPanelSubmitting ? 'Processing...' : `Update ${selectedFilterIds.size} Filter(s)`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk Retire / Replace Panel */}
      {(bulkAction === 'retire' || bulkAction === 'replace') && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeBulkPanel} />
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Bulk {bulkAction === 'retire' ? 'Retirement' : 'Replacement'}</h3>
              <button onClick={closeBulkPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className={`rounded-lg p-3 text-xs border ${bulkAction === 'retire' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                {bulkAction === 'retire'
                  ? <>This will permanently retire <strong>{selectedFilterIds.size} filter(s)</strong>. They will be removed from the active filter list.</>
                  : <>This will retire <strong>{selectedFilterIds.size} filter(s)</strong> and create replacement filters with incremented suffix numbers.</>
                }
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Selected Filters</label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {blockFilters.filter(f => selectedFilterIds.has(f.id)).map(f => (
                    <div key={f.id} className="text-xs text-slate-600 px-2 py-1 bg-slate-50 rounded">{f.name}</div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Remarks <span className="text-red-500">*</span></label>
                <textarea value={panelRemarks} onChange={e => setPanelRemarks(e.target.value)}
                  placeholder={`Enter reason for ${bulkAction === 'retire' ? 'retirement' : 'replacement'}...`} rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-[var(--theme-focus-ring)] focus:border-[var(--theme-primary)]" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={closeBulkPanel} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleBulkRetireSubmit} disabled={!panelRemarks.trim() || panelSubmitting}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  bulkAction === 'retire' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'
                }`}>
                {panelSubmitting ? 'Processing...' : `${bulkAction === 'retire' ? 'Retire' : 'Replace'} ${selectedFilterIds.size} Filter(s)`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Filter Dialog */}
      {createFilterOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
            <div className="px-6 py-4 shrink-0 flex items-center justify-between" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              <div>
                <h2 className="text-lg font-bold text-white">Create Filter</h2>
                <p className="text-white/70 text-sm">Add a single filter under an AHU</p>
              </div>
              <button onClick={() => setCreateFilterOpen(false)} className="text-white/80 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {createFilterError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{createFilterError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">AHU <span className="text-red-500">*</span></label>
                <select value={createFilterAhu} onChange={e => setCreateFilterAhu(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500">
                  <option value="">Select AHU...</option>
                  {bulkUploadAhus.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Filter Name <span className="text-red-500">*</span></label>
                <input type="text" value={createFilterName} onChange={e => setCreateFilterName(e.target.value)}
                  placeholder="e.g., Pre-Filter-01"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Filter Set <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  {(['A', 'B'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setCreateFilterSet(s)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        createFilterSet === s ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}>
                      Set {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => setCreateFilterOpen(false)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={submitCreateFilter} disabled={createFilterSubmitting || !createFilterAhu || !createFilterName.trim()}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={themeButton}>
                {createFilterSubmitting ? 'Creating...' : 'Create Filter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchy Edit Dialog */}
      {hierarchyEditDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
            <div className="px-6 py-4 shrink-0 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500">
              <div>
                <h2 className="text-lg font-bold text-white">Edit {hierarchyEditDialog.entityType}</h2>
                <p className="text-white/70 text-sm">Rename this hierarchy node</p>
              </div>
              <button onClick={() => setHierarchyEditDialog(null)} className="text-white/80 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {hierarchyEditError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{hierarchyEditError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input type="text" value={hierarchyEditName} onChange={e => setHierarchyEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => setHierarchyEditDialog(null)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={submitHierarchyEdit} disabled={hierarchyEditSubmitting || !hierarchyEditName.trim()}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {hierarchyEditSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchy Delete Dialog */}
      {hierarchyDeleteDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-100 text-red-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-800">Delete {hierarchyDeleteDialog.entityType}</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Permanently delete <strong>"{hierarchyDeleteDialog.name}"</strong>? Any child entities will also be removed. This cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => setHierarchyDeleteDialog(null)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={submitHierarchyDelete} disabled={hierarchyDeleteSubmitting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {hierarchyDeleteSubmitting ? 'Deleting...' : `Delete ${hierarchyDeleteDialog.entityType}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Filter Dialog */}
      {editFilterDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
            <div className="px-6 py-4 shrink-0 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500">
              <div>
                <h2 className="text-lg font-bold text-white">Edit Filter</h2>
                <p className="text-white/70 text-sm">Update filter name and set</p>
              </div>
              <button onClick={() => setEditFilterDialog(null)} className="text-white/80 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {editFilterError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{editFilterError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Filter Name <span className="text-red-500">*</span></label>
                <input type="text" value={editFilterName} onChange={e => setEditFilterName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Filter Set</label>
                <div className="flex gap-2">
                  {(['A', 'B'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setEditFilterSet(s)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        editFilterSet === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}>
                      Set {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => setEditFilterDialog(null)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={submitEditFilter} disabled={editFilterSubmitting || !editFilterName.trim()}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {editFilterSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Filter Confirmation */}
      {deleteFilterDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-100 text-red-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-800">Delete Filter</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Permanently delete <strong>"{deleteFilterDialog.name}"</strong>? This cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => setDeleteFilterDialog(null)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={submitDeleteFilter} disabled={deleteFilterSubmitting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {deleteFilterSubmitting ? 'Deleting...' : 'Delete Filter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload Dialog */}
      {bulkUploadOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 shrink-0 flex items-center justify-between" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              <div>
                <h2 className="text-lg font-bold text-white">Bulk Upload Filters</h2>
                <p className="text-white/70 text-sm">
                  {diagramFilter?.type === 'ahu' ? `Into ${diagramFilter.name}`
                    : diagramFilter?.type === 'area' ? `Into ${diagramFilter.name} area`
                    : `Into ${selectedBlockName}`}
                </p>
              </div>
              <button onClick={closeBulkUpload} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">

              {/* Step: Select AHU + file */}
              {bulkUploadStep === 'select' && (
                <>
                  {/* AHU selector — skip if single AHU context */}
                  {bulkUploadAhus.length !== 1 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Target AHU <span className="text-red-500">*</span></label>
                      {bulkUploadAhus.length === 0 ? (
                        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                          No AHUs found in this scope. Create an AHU first in the Structure view.
                        </div>
                      ) : (
                        <select value={bulkUploadAhu} onChange={e => setBulkUploadAhu(e.target.value)}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[var(--theme-focus-ring)] focus:border-[var(--theme-primary)]">
                          <option value="">Select AHU...</option>
                          {bulkUploadAhus.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}

                  {bulkUploadAhus.length === 1 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Target AHU</label>
                      <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">{bulkUploadAhus[0].name}</div>
                    </div>
                  )}

                  {/* CSV format info — dynamic from Filter template */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-slate-600 mb-2">CSV Columns</h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="font-mono text-theme-primary">name</span><span className="text-slate-400">Filter ID/Name (required)</span>
                      <span className="font-mono text-theme-primary">filterSet</span><span className="text-slate-400">A or B (required)</span>
                      {filterTemplateSchema.map((f, fi) => (
                        <Fragment key={f.fieldName}>
                          <span className="font-mono text-theme-primary">{f.fieldName}</span>
                          <span className="text-slate-400">
                            {f.dropdownOptions?.length ? f.dropdownOptions.join(', ') : f.dataType || 'Text'}
                            {f.required ? ' (required)' : ''}
                            {f.unit ? ` (${f.unit})` : ''}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button onClick={downloadBulkTemplate}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Download Template
                    </button>
                  </div>

                  {/* File upload */}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">CSV File <span className="text-red-500">*</span></label>
                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-[var(--theme-primary)] transition-colors cursor-pointer"
                      onClick={() => document.getElementById('bulk-upload-file-input')?.click()}>
                      <svg className="w-8 h-8 mx-auto text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      <p className="text-sm text-slate-500">{bulkUploadFile ? bulkUploadFile.name : 'Click to select CSV file'}</p>
                      <input id="bulk-upload-file-input" type="file" accept=".csv,text/csv" className="hidden" onChange={handleBulkUploadFileSelect} />
                    </div>
                  </div>
                  {bulkUploadError && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{bulkUploadError}</div>}
                </>
              )}

              {/* Step: Preview */}
              {bulkUploadStep === 'preview' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-600"><strong>{bulkUploadRows.length}</strong> filter(s) ready to upload into <strong>{bulkUploadAhus.find(h => h.id === bulkUploadAhu)?.name}</strong></p>
                    <button onClick={() => { setBulkUploadStep('select'); setBulkUploadFile(null); setBulkUploadRows([]); }}
                      className="text-xs hover:opacity-80 font-medium text-theme-primary">Change file</button>
                  </div>
                  <div className="max-h-64 overflow-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-slate-500 font-medium">#</th>
                          <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                          <th className="text-left px-3 py-2 text-slate-500 font-medium">Set</th>
                          {filterTemplateSchema.map(f => (
                            <th key={f.fieldName} className="text-left px-3 py-2 text-slate-500 font-medium">{f.fieldName}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bulkUploadRows.map((r: any, i: number) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
                            <td className="px-3 py-1.5 text-slate-600">{r.filterSet}</td>
                            {filterTemplateSchema.map(f => (
                              <td key={f.fieldName} className="px-3 py-1.5 text-slate-500">{r[f.fieldName] || '--'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Step: Uploading */}
              {bulkUploadStep === 'uploading' && (
                <div className="flex flex-col items-center py-10 gap-4">
                  <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
                  <p className="text-sm text-slate-500">Creating {bulkUploadRows.length} filters...</p>
                </div>
              )}

              {/* Step: Results */}
              {bulkUploadStep === 'results' && (
                <>
                  <div className="flex gap-4">
                    {bulkUploadCreated > 0 && (
                      <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-green-600">{bulkUploadCreated}</div>
                        <div className="text-xs text-green-500">Created</div>
                      </div>
                    )}
                    {bulkUploadFailed > 0 && (
                      <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-red-600">{bulkUploadFailed}</div>
                        <div className="text-xs text-red-500">Failed</div>
                      </div>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Row</th>
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Name</th>
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Status</th>
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkUploadResults.map((r: any, i: number) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-4 py-2 text-slate-400">{r.row}</td>
                            <td className="px-4 py-2 text-slate-700">{r.name}</td>
                            <td className="px-4 py-2">
                              {r.status === 'success'
                                ? <span className="text-green-600 font-medium">Created</span>
                                : <span className="text-red-600 font-medium">Failed</span>}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-400">{r.error || (r.id ? r.id.slice(0, 8) : '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3 shrink-0">
              {bulkUploadStep === 'results' ? (
                <button onClick={closeBulkUpload} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 transition-colors">Close</button>
              ) : (
                <>
                  <button onClick={closeBulkUpload} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                  {bulkUploadStep === 'preview' && (
                    <button onClick={handleBulkUploadSubmit} disabled={!bulkUploadAhu}
                      className="flex-1 py-2.5 text-white rounded-lg font-semibold disabled:opacity-50 hover:opacity-90 transition-all flex items-center justify-center gap-2"
                      style={themeButton}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      Upload {bulkUploadRows.length} Filters
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
