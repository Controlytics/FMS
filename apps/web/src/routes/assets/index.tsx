import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

// =============================================
// Types
// =============================================

interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  templateId: string;
  status: string;
  template: { name: string; icon: string };
  _count: { children: number };
}

interface TelemetryDefinition {
  fieldName: string;
  dataType: string;
  unit?: string;
  description?: string;
}

interface AssetTemplate {
  id: string;
  name: string;
  description?: string;
  icon: string;
  version: number;
  isActive: boolean;
  attributeSchema: AttributeDefinition[];
  telemetrySchema?: TelemetryDefinition[];
  expectedIdentifiers: any[];
  maxConnections?: number;
  maxParentConnections?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  _count?: { instances: number };
}

interface AttributeDefinition {
  fieldName: string;
  dataType: string;
  required: boolean;
  defaultValue?: any;
  unit?: string;
  dropdownOptions?: string[];
  numericConstraints?: {
    enabled: boolean;
    min?: number;
    max?: number;
    resolution?: number;
  };
}

interface AssetInstance {
  id: string;
  name: string;
  description?: string;
  templateId: string;
  templateVersion: number;
  status: string;
  attributes: Record<string, any>;
  telemetryConfig?: Record<string, any>;
  customAttributes?: Record<string, any>;
  parentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  template: AssetTemplate;
  parent?: { id: string; name: string; templateId: string } | null;
  sourceRelations: AssetRelation[];
  targetRelations: AssetRelation[];
  identifiers: AssetIdentifier[];
  _count?: { sourceRelations?: number };
}

interface AssetRelation {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  relationshipType: string;
  customLabel?: string;
  notes?: string;
  createdAt: string;
  sourceAsset?: { id: string; name: string };
  targetAsset?: { id: string; name: string };
}

interface AssetIdentifier {
  id: string;
  assetId: string;
  identifierType: string;
  identifierValue: string;
  label?: string;
  isPrimary: boolean;
  createdAt: string;
}

interface AuditRecord {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeValue?: any;
  afterValue?: any;
  createdAt: string;
}

interface PaginatedInstances {
  data: (TreeNode & { description?: string; createdAt: string })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// =============================================
// Constants
// =============================================

const ICON_MAP: Record<string, string> = {
  box: '\uD83D\uDCE6',
  server: '\uD83D\uDDA5\uFE0F',
  camera: '\uD83D\uDCF9',
  thermometer: '\uD83C\uDF21\uFE0F',
  building: '\uD83C\uDFE2',
  'door-open': '\uD83D\uDEAA',
  truck: '\uD83D\uDE9B',
  wrench: '\uD83D\uDD27',
  shield: '\uD83D\uDEE1\uFE0F',
  monitor: '\uD83D\uDCFA',
  flask: '\uD83E\uDDEA',
  gauge: '\uD83D\uDCCA',
  zap: '\u26A1',
  cpu: '\uD83D\uDDA5\uFE0F',
  fan: '\uD83C\uDF00',
  droplet: '\uD83D\uDCA7',
  wind: '\uD83C\uDF2C\uFE0F',
  beaker: '\uD83E\uDDEA',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  CONTAINS: 'Contains',
  CONTAINED_IN: 'Contained In',
  CONNECTED_TO: 'Connected To',
  FEEDS: 'Feeds',
  FED_BY: 'Fed By',
  DEPENDS_ON: 'Depends On',
  DEPENDED_ON_BY: 'Depended On By',
  BACKS_UP: 'Backs Up',
  BACKED_UP_BY: 'Backed Up By',
  MONITORS: 'Monitors',
  MONITORED_BY: 'Monitored By',
  CUSTOM: 'Custom',
};

const ALL_RELATIONSHIP_TYPES = [
  'CONTAINS',
  'CONTAINED_IN',
  'CONNECTED_TO',
  'FEEDS',
  'FED_BY',
  'DEPENDS_ON',
  'DEPENDED_ON_BY',
  'BACKS_UP',
  'BACKED_UP_BY',
  'MONITORS',
  'MONITORED_BY',
  'CUSTOM',
];

const IDENTIFIER_TYPE_LABELS: Record<string, string> = {
  QR: 'QR Code',
  BARCODE: 'Barcode',
  RFID: 'RFID',
  NFC: 'NFC',
  MANUAL: 'Manual',
};

// =============================================
// Helper Functions
// =============================================

function getIcon(iconKey: string): string {
  return ICON_MAP[iconKey] || '\uD83D\uDCE6';
}


// =============================================
// ---------------------------------------------------------------------------
// FloatInput — auto-appends .0 on blur for whole numbers
// ---------------------------------------------------------------------------

function FloatInput({
  value,
  onValueChange,
  placeholder,
  className,
}: {
  value: any;
  onValueChange: (v: any) => void;
  placeholder?: string;
  className?: string;
}) {
  const fmt = (v: any) => {
    if (v === '' || v === undefined || v === null) return '';
    if (typeof v === 'number' && Number.isInteger(v)) return v.toFixed(1);
    return String(v);
  };
  const [display, setDisplay] = useState(fmt(value));

  useEffect(() => { setDisplay(fmt(value)); }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          setDisplay(raw);
          onValueChange(raw);
          return;
        }
        if (/^-?\d*\.?\d*$/.test(raw)) {
          setDisplay(raw);
          onValueChange(parseFloat(raw));
        }
      }}
      onBlur={() => {
        if (display !== '' && /^-?\d+$/.test(display)) {
          setDisplay(display + '.0');
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

// =============================================
// Main Component
// =============================================

export { AssetExplorerPage as AssetsPage };

export function AssetExplorerPage() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const reauth = useReauth();
  const { toast } = useToast();
  const { formatDateTime } = useDatetimeFormat();

  // ---- View state ----
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = useState('');
  const [treeTemplateFilter, setTreeTemplateFilter] = useState('');

  // ---- Dialog states ----
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddIdentifierDialog, setShowAddIdentifierDialog] = useState(false);
  const [showAttachExistingDialog, setShowAttachExistingDialog] = useState(false);

  // ---- Attach existing entity state ----
  const [attachParentId, setAttachParentId] = useState<string>('');
  const [attachTargetId, setAttachTargetId] = useState<string>('');
  const [attachSearch, setAttachSearch] = useState('');

  // ---- Wizard state ----
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  // ---- Form data for new entity ----
  const [newAsset, setNewAsset] = useState({
    name: '',
    description: '',
    status: 'Active',
    parentId: null as string | null,
    attributes: {} as Record<string, any>,
  });

  // ---- Edit form data ----
  const [editAsset, setEditAsset] = useState({
    name: '',
    description: '',
    status: 'Active',
    parentId: null as string | null,
    attributes: {} as Record<string, any>,
  });

  // ---- Link dialog state ----
  const [linkSource, setLinkSource] = useState<string>('');
  const [linkTargets, setLinkTargets] = useState<string[]>([]);
  const [linkType, setLinkType] = useState<string>('CONTAINS');
  const [linkCustomLabel, setLinkCustomLabel] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkTargetSearch, setLinkTargetSearch] = useState('');

  // ---- Identifier dialog state ----
  const [newIdentifier, setNewIdentifier] = useState({
    identifierType: 'MANUAL' as string,
    identifierValue: '',
    label: '',
    isPrimary: false,
  });

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

  const { data: treeData, isLoading: treeLoading } = useSWR<TreeNode[]>('/api/assets/instances/tree');

  const { data: selectedAsset, isLoading: detailLoading } = useSWR<AssetInstance>(
    selectedAssetId ? `/api/assets/instances/${selectedAssetId}` : null,
  );

  const { data: templatesData } = useSWR<{ data: AssetTemplate[] }>(
    '/api/assets/templates?limit=100',
  );

  const { data: listData, isLoading: listLoading } = useSWR<PaginatedInstances>(
    viewMode === 'list'
      ? `/api/assets/instances?page=${listPage}&limit=20${debouncedListSearch ? `&search=${encodeURIComponent(debouncedListSearch)}` : ''}${treeTemplateFilter ? `&templateId=${encodeURIComponent(treeTemplateFilter)}` : ''}&isActive=true`
      : null,
  );

  const { data: auditData } = useSWR<{ data: AuditRecord[] }>(
    selectedAssetId && activeTab === 'audit'
      ? `/api/audit?targetType=ASSET_INSTANCE&targetId=${selectedAssetId}&limit=50`
      : null,
  );

  // Fetch all relationships for the full relationship tree diagram
  const { data: allRelationshipsData } = useSWR<AssetRelation[]>(
    selectedAssetId && activeTab === 'relationships'
      ? '/api/assets/relationships'
      : null,
  );

  const { data: selectedTemplateDetail } = useSWR<AssetTemplate>(
    selectedTemplateId ? `/api/assets/templates/${selectedTemplateId}` : null,
  );

  const templates = templatesData?.data ?? [];
  const auditRecords = auditData?.data ?? [];

  // =============================================
  // Tree Logic
  // =============================================

  const filteredTree = useMemo(() => {
    if (!treeData) return [];
    let nodes = treeData;

    if (debouncedTreeSearch) {
      const search = debouncedTreeSearch.toLowerCase();
      nodes = nodes.filter((n) => n.name.toLowerCase().includes(search));
    }
    if (treeTemplateFilter) {
      nodes = nodes.filter((n) => n.templateId === treeTemplateFilter);
    }
    return nodes;
  }, [treeData, debouncedTreeSearch, treeTemplateFilter]);

  const hasActiveFilters = debouncedTreeSearch || treeTemplateFilter;

  // Build parent-to-children map from full (unfiltered) tree data
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, TreeNode[]>();
    if (!treeData) return map;
    for (const node of treeData) {
      const parentKey = node.parentId;
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(node);
    }
    return map;
  }, [treeData]);

  // When filtering, show a flat list. Otherwise, show hierarchical tree.
  const rootNodes = useMemo(() => {
    if (hasActiveFilters) return filteredTree;
    return filteredTree.filter((n) => !n.parentId);
  }, [filteredTree, hasActiveFilters]);

  const getChildren = useCallback(
    (parentId: string): TreeNode[] => {
      return childrenMap.get(parentId) ?? [];
    },
    [childrenMap],
  );

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!treeData) return;
    const allIds = new Set(treeData.filter((n) => n._count.children > 0).map((n) => n.id));
    setExpandedNodes(allIds);
  }, [treeData]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  // Build parent path for detail view
  const getParentPath = useCallback(
    (assetId: string): string[] => {
      if (!treeData) return [];
      const nodeMap = new Map(treeData.map((n) => [n.id, n]));
      const path: string[] = [];
      let current = nodeMap.get(assetId);
      while (current?.parentId) {
        const parent = nodeMap.get(current.parentId);
        if (parent) {
          path.unshift(parent.name);
          current = parent;
        } else {
          break;
        }
      }
      return path;
    },
    [treeData],
  );

  // Flat list of all entities for dropdowns (with indent info)
  const flatAssetList = useMemo(() => {
    if (!treeData) return [];
    const result: { id: string; name: string; depth: number; templateName: string; childCount: number }[] = [];
    const nodeMap = new Map(treeData.map((n) => [n.id, n]));

    function isRoot(pid: string | null | undefined): boolean {
      return pid === null || pid === undefined || pid === '';
    }
    function walk(parentId: string | null, depth: number) {
      const children = (treeData ?? []).filter((n) => parentId === null ? isRoot(n.parentId) : n.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        result.push({ id: child.id, name: child.name, depth, templateName: child.template.name, childCount: child._count?.children ?? 0 });
        walk(child.id, depth + 1);
      }
    }
    walk(null, 0);
    return result;
  }, [treeData]);

  // =============================================
  // Mutations
  // =============================================

  const mutateAssets = useCallback(() => {
    mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
  }, [mutate]);

  // ---- Create Entity ----
  const handleCreateAsset = useCallback(async () => {
    if (!selectedTemplateId || !newAsset.name.trim()) return;
    setSaving(true);
    setError('');

    const body = {
      name: newAsset.name.trim(),
      description: newAsset.description.trim() || undefined,
      templateId: selectedTemplateId,
      status: newAsset.status,
      attributes: newAsset.attributes,
      parentId: newAsset.parentId || undefined,
    };

    try {
      await reauth.execute(
        'CREATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.postWithReauth('/api/assets/instances', body, password);
          } else {
            await apiClient.post('/api/assets/instances', body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            setShowAddDialog(false);
            resetWizard();
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            setError(e?.message || 'Failed to create entity');
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || 'Unexpected error creating entity');
      setSaving(false);
    }
  }, [selectedTemplateId, newAsset, reauth, mutateAssets]);

  // ---- Update Entity ----
  const handleUpdateAsset = useCallback(async () => {
    if (!selectedAssetId || !editAsset.name.trim()) return;
    setSaving(true);
    setError('');

    const body = {
      name: editAsset.name.trim(),
      description: editAsset.description.trim() || undefined,
      status: editAsset.status,
      attributes: editAsset.attributes,
      parentId: editAsset.parentId,
    };

    try {
      await reauth.execute(
        'UPDATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/instances/${selectedAssetId}`, body, password);
          } else {
            await apiClient.put(`/api/assets/instances/${selectedAssetId}`, body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            setShowEditDialog(false);
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            setError(e?.message || 'Failed to update entity');
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || 'Unexpected error updating entity');
      setSaving(false);
    }
  }, [selectedAssetId, editAsset, reauth, mutateAssets]);

  // ---- Delete Entity ----
  const handleDeleteAsset = useCallback(async () => {
    if (!selectedAssetId) return;
    setSaving(true);
    setError('');

    try {
      await reauth.execute(
        'DELETE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/instances/${selectedAssetId}`, password);
          } else {
            await apiClient.delete(`/api/assets/instances/${selectedAssetId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            setShowDeleteDialog(false);
            setSelectedAssetId(null);
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            setError(e?.message || 'Failed to delete entity');
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || 'Unexpected error deleting entity');
      setSaving(false);
    }
  }, [selectedAssetId, reauth, mutateAssets]);

  // ---- Create Relationship ----
  const handleCreateRelationship = useCallback(async () => {
    if (!linkSource || linkTargets.length === 0 || !linkType) return;
    setSaving(true);
    setError('');

    let lastResult: any = null;
    try {
      await reauth.execute(
        'CREATE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          for (const targetId of linkTargets) {
            const body = {
              sourceAssetId: linkSource,
              targetAssetId: targetId,
              relationshipType: linkType,
              customLabel: linkType === 'CUSTOM' ? linkCustomLabel : undefined,
              notes: linkNotes || undefined,
            };
            if (password) {
              lastResult = await apiClient.postWithReauth('/api/assets/relationships', body, password);
            } else {
              lastResult = await apiClient.post('/api/assets/relationships', body);
            }
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            setExpandedNodes((prev) => new Set([...prev, linkSource]));
            setSelectedAssetId(linkSource);
            setActiveTab('relationships');
            setShowLinkDialog(false);
            resetLinkDialog();
            setSaving(false);
            const ci = lastResult?.connectionInfo?.source;
            if (ci) {
              const remaining = ci.allowed > 0 ? ci.remaining : 'unlimited';
              toast.success('Relationship Created', `${ci.used}/${ci.allowed > 0 ? ci.allowed : '\u221E'} connections used, ${remaining} remaining`);
            } else {
              toast.success('Relationship Created');
            }
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || 'Failed to create relationship';
            setError(msg);
            setSaving(false);
            if (e?.connectionInfo) {
              toast.error('Connection Limit Reached', msg);
            } else {
              toast.error('Failed to Create Relationship', msg);
            }
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      const msg = err?.message || 'Unexpected error creating relationship';
      setError(msg);
      setSaving(false);
      toast.error('Failed to Create Relationship', msg);
    }
  }, [linkSource, linkTargets, linkType, linkCustomLabel, linkNotes, reauth, mutateAssets, toast]);

  // ---- Delete Relationship ----
  const handleDeleteRelationship = useCallback(
    async (relationshipId: string) => {
      await reauth.execute(
        'DELETE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/relationships/${relationshipId}`, password);
          } else {
            await apiClient.delete(`/api/assets/relationships/${relationshipId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            toast.success('Relationship Removed');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to delete relationship';
            setError(msg);
            toast.error('Failed to Remove', msg);
          },
        },
      );
    },
    [reauth, mutateAssets, toast],
  );

  // ---- Create Identifier ----
  const handleCreateIdentifier = useCallback(async () => {
    if (!selectedAssetId || !newIdentifier.identifierValue.trim()) return;
    setSaving(true);
    setError('');

    const body = {
      assetId: selectedAssetId,
      identifierType: newIdentifier.identifierType,
      identifierValue: newIdentifier.identifierValue.trim(),
      label: newIdentifier.label.trim() || undefined,
      isPrimary: newIdentifier.isPrimary,
    };

    await reauth.execute(
      'CREATE_ASSET_IDENTIFIER',
      async (password?: string) => {
        if (password) {
          await apiClient.postWithReauth('/api/assets/identifiers', body, password);
        } else {
          await apiClient.post('/api/assets/identifiers', body);
        }
      },
      {
        onSuccess: () => {
          mutateAssets();
          setShowAddIdentifierDialog(false);
          setNewIdentifier({ identifierType: 'MANUAL', identifierValue: '', label: '', isPrimary: false });
          setSaving(false);
        },
        onError: (err: any) => {
          setError(err?.message || 'Failed to create identifier');
          setSaving(false);
        },
      },
    );
  }, [selectedAssetId, newIdentifier, mutateAssets, reauth]);

  // ---- Delete Identifier ----
  const handleDeleteIdentifier = useCallback(
    async (identifierId: string) => {
      await reauth.execute(
        'DELETE_ASSET_IDENTIFIER',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/identifiers/${identifierId}`, password);
          } else {
            await apiClient.delete(`/api/assets/identifiers/${identifierId}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
          },
          onError: (err: any) => {
            setError(err?.message || 'Failed to delete identifier');
          },
        },
      );
    },
    [mutateAssets, reauth],
  );

  // ---- Unlink from Parent (set parentId to null) ----
  const handleUnlinkFromParent = useCallback(async (assetId: string) => {
    if (!confirm('Remove this entity from its parent? The entity will become a root-level entity.')) return;
    try {
      await reauth.execute(
        'UPDATE_ASSET',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/instances/${assetId}`, { parentId: null }, password);
          } else {
            await apiClient.put(`/api/assets/instances/${assetId}`, { parentId: null });
          }
        },
        {
          onSuccess: () => mutateAssets(),
          onError: (err: any) => setError(err?.message || 'Failed to unlink entity'),
        },
      );
    } catch (err: any) {
      setError(err?.message || 'Unexpected error unlinking entity');
    }
  }, [reauth, mutateAssets]);

  // ---- Remove node from diagram tree (delete CONTAINS relationship) ----
  const handleRemoveFromDiagram = useCallback(async (
    childId: string,
    parentId: string,
    allRels: AssetRelation[],
  ) => {
    // Find the CONTAINS relationship from parent -> child
    const rel = allRels.find(
      (r) => r.sourceAssetId === parentId && r.targetAssetId === childId && r.relationshipType === 'CONTAINS',
    );
    if (!rel) {
      setError('Could not find the CONTAINS relationship to remove.');
      return;
    }
    if (!confirm('Remove this entity from the tree? This will delete the CONTAINS relationship but will not delete the entity itself.')) return;
    try {
      await reauth.execute(
        'DELETE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            await apiClient.deleteWithReauth(`/api/assets/relationships/${rel.id}`, password);
          } else {
            await apiClient.delete(`/api/assets/relationships/${rel.id}`);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            toast.success('Removed from Tree');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to remove from tree';
            setError(msg);
            toast.error('Failed to Remove', msg);
          },
        },
      );
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error removing from tree';
      setError(msg);
      toast.error('Failed to Remove', msg);
    }
  }, [reauth, mutateAssets, toast]);

  // ---- Attach existing entity as child (create CONTAINS relationship) ----
  const handleAttachExisting = useCallback(async () => {
    if (!attachParentId || !attachTargetId) return;
    setSaving(true);
    setError('');
    const body = {
      sourceAssetId: attachParentId,
      targetAssetId: attachTargetId,
      relationshipType: 'CONTAINS',
    };
    try {
      await reauth.execute(
        'CREATE_ASSET_RELATIONSHIP',
        async (password?: string) => {
          if (password) {
            return await apiClient.postWithReauth('/api/assets/relationships', body, password);
          } else {
            return await apiClient.post('/api/assets/relationships', body);
          }
        },
        {
          onSuccess: () => {
            mutateAssets();
            setShowAttachExistingDialog(false);
            setAttachParentId('');
            setAttachTargetId('');
            setAttachSearch('');
            setSaving(false);
            toast.success('Entity Attached', 'CONTAINS relationship created');
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to attach entity';
            setError(msg);
            setSaving(false);
            toast.error('Failed to Attach', msg);
          },
        },
      );
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error attaching entity';
      setError(msg);
      setSaving(false);
      toast.error('Failed to Attach', msg);
    }
  }, [attachParentId, attachTargetId, reauth, mutateAssets, toast]);

  // =============================================
  // Reset Helpers
  // =============================================

  const resetWizard = useCallback(() => {
    setWizardStep(1);
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setNewAsset({ name: '', description: '', status: 'Active', parentId: null, attributes: {} });
    setError('');
  }, []);

  const resetLinkDialog = useCallback(() => {
    setLinkSource('');
    setLinkTargets([]);
    setLinkType('CONTAINS');
    setLinkCustomLabel('');
    setLinkNotes('');
    setLinkTargetSearch('');
    setError('');
  }, []);

  // ---- Open Add Dialog ----
  const openAddDialog = useCallback(() => {
    resetWizard();
    setShowAddDialog(true);
  }, [resetWizard]);

  // ---- Open Link Dialog ----
  const openLinkDialog = useCallback(() => {
    resetLinkDialog();
    if (selectedAssetId) setLinkSource(selectedAssetId);
    setShowLinkDialog(true);
  }, [resetLinkDialog, selectedAssetId]);

  // ---- Open Edit Dialog ----
  const openEditDialog = useCallback(() => {
    if (!selectedAsset) return;
    setEditAsset({
      name: selectedAsset.name,
      description: selectedAsset.description || '',
      status: selectedAsset.status,
      parentId: selectedAsset.parentId,
      attributes: selectedAsset.attributes || {},
    });
    setError('');
    setShowEditDialog(true);
  }, [selectedAsset]);

  // ---- Initialize attributes from template defaults when template is selected ----
  useEffect(() => {
    if (selectedTemplateDetail && showAddDialog) {
      const defaults: Record<string, any> = {};
      for (const attr of selectedTemplateDetail.attributeSchema ?? []) {
        if (attr.defaultValue !== undefined && attr.defaultValue !== null) {
          defaults[attr.fieldName] = attr.defaultValue;
        } else if (attr.dataType === 'BOOLEAN') {
          defaults[attr.fieldName] = false;
        }
      }
      setNewAsset((prev) => ({ ...prev, attributes: defaults }));
    }
  }, [selectedTemplateDetail, showAddDialog]);

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
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-slate-50 cursor-pointer',
              isSelected && 'bg-blue-50 border-r-2 border-blue-500',
            )}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => {
              setSelectedAssetId(node.id);
              setActiveTab('overview');
            }}
          >
            {/* Expand/Collapse */}
            {hasChildren ? (
              <span
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.id);
                }}
              >
                <svg
                  className={cn('w-3.5 h-3.5 transition-transform duration-200', isExpanded && 'rotate-90')}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            ) : (
              <span className="w-5 flex-shrink-0" />
            )}

            {/* Icon */}
            <span className="text-base flex-shrink-0">{getIcon(node.template.icon)}</span>

            {/* Name */}
            <span className={cn('truncate flex-1 font-medium', isSelected ? 'text-blue-700' : 'text-slate-700')}>
              {node.name}
            </span>

            {/* Hover action buttons */}
            <span className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover/treenode:opacity-100 transition-opacity">
              {/* Create new child entity */}
              <span
                className="w-5 h-5 flex items-center justify-center text-emerald-500 hover:text-emerald-700 rounded hover:bg-emerald-100 transition-colors"
                title="Create new child entity"
                onClick={(e) => {
                  e.stopPropagation();
                  resetWizard();
                  setNewAsset((prev) => ({ ...prev, parentId: node.id }));
                  setShowAddDialog(true);
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </span>
              {/* Attach existing entity as child */}
              <span
                className="w-5 h-5 flex items-center justify-center text-blue-500 hover:text-blue-700 rounded hover:bg-blue-100 transition-colors"
                title="Attach existing entity as child"
                onClick={(e) => {
                  e.stopPropagation();
                  setAttachParentId(node.id);
                  setAttachTargetId('');
                  setAttachSearch('');
                  setError('');
                  setShowAttachExistingDialog(true);
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </span>
              {/* Unlink from parent */}
              {node.parentId && (
                <span
                  className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                  title="Unlink from parent"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnlinkFromParent(node.id);
                  }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              )}
            </span>

          </div>

          {/* Children */}
          {isExpanded && hasChildren && !hasActiveFilters && (
            <div>
              {children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [expandedNodes, selectedAssetId, toggleExpand, getChildren, hasActiveFilters, resetWizard],
  );

  // =============================================
  // Render: Attribute Form
  // =============================================

  /** Validate a single attribute value; returns an error message or null. */
  const validateAttrValue = useCallback(
    (attr: AttributeDefinition, value: any): string | null => {
      const c = attr.numericConstraints;
      if (attr.required && (value === undefined || value === null || value === '')) {
        return `${attr.fieldName} is required`;
      }
      if (value === undefined || value === null || value === '') return null;

      switch (attr.dataType) {
        case 'INTEGER':
          if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be a whole number';
          if (c?.enabled) {
            if (c.min !== undefined && value < c.min) return `Must be >= ${c.min}`;
            if (c.max !== undefined && value > c.max) return `Must be <= ${c.max}`;
          }
          break;
        case 'FLOAT':
          // Allow intermediate typing states like "." or "-"
          if (typeof value === 'string' && (value === '.' || value === '-' || value === '-.')) return 'Must be a valid number';
          if (typeof value === 'number' && !isFinite(value)) return 'Must be a valid number';
          if (typeof value === 'number' && c?.enabled) {
            if (c.min !== undefined && value < c.min) return `Must be >= ${c.min}`;
            if (c.max !== undefined && value > c.max) return `Must be <= ${c.max}`;
          }
          break;
        case 'URL':
          if (typeof value === 'string' && value.trim()) {
            try { new URL(value); } catch { return 'Must be a valid URL (e.g., https://...)'; }
          }
          break;
      }
      return null;
    },
    [],
  );

  /** Check if any attribute has validation errors (used to block wizard Next). */
  const hasAttributeErrors = useCallback(
    (attrSchema: AttributeDefinition[], values: Record<string, any>): boolean => {
      if (!attrSchema) return false;
      return attrSchema.some((attr) => validateAttrValue(attr, values[attr.fieldName] ?? '') !== null);
    },
    [validateAttrValue],
  );

  const renderAttributeForm = useCallback(
    (
      attrSchema: AttributeDefinition[],
      values: Record<string, any>,
      onChange: (field: string, value: any) => void,
    ) => {
      if (!attrSchema || attrSchema.length === 0) {
        return <p className="text-sm text-slate-500 italic">This template has no attributes defined.</p>;
      }

      return (
        <div className="space-y-4">
          {attrSchema.map((attr) => {
            const value = values[attr.fieldName] ?? '';
            const constraints = attr.numericConstraints;
            const errMsg = validateAttrValue(attr, value);

            return (
              <div key={attr.fieldName} className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  {attr.fieldName}
                  {attr.required && <span className="text-red-500">*</span>}
                  <Badge variant="outline" className="text-xs font-normal px-1.5 py-0.5">
                    {attr.dataType}
                  </Badge>
                  {attr.unit && (
                    <span className="text-xs text-slate-400 font-normal">({attr.unit})</span>
                  )}
                </label>

                {attr.dataType === 'TEXT' && (
                  <Input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                    placeholder={`Enter ${attr.fieldName}`}
                  />
                )}

                {attr.dataType === 'INTEGER' && (
                  <>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || v === '-') { onChange(attr.fieldName, ''); return; }
                        if (/^-?\d+$/.test(v)) onChange(attr.fieldName, parseInt(v, 10));
                      }}
                      placeholder={`Enter ${attr.fieldName} (whole numbers only)`}
                      className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                    />
                    {constraints?.enabled && (
                      <p className="text-xs text-slate-400">
                        Range: {constraints.min ?? '-\u221E'} to {constraints.max ?? '+\u221E'}
                        {constraints.resolution ? ` | Step: ${constraints.resolution}` : ''}
                      </p>
                    )}
                  </>
                )}

                {attr.dataType === 'FLOAT' && (
                  <>
                    <FloatInput
                      value={value}
                      onValueChange={(v) => onChange(attr.fieldName, v)}
                      placeholder={`Enter ${attr.fieldName} (decimal number)`}
                      className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                    />
                    {constraints?.enabled && (
                      <p className="text-xs text-slate-400">
                        Range: {constraints.min ?? '-\u221E'} to {constraints.max ?? '+\u221E'}
                        {constraints.resolution ? ` | Step: ${constraints.resolution}` : ''}
                      </p>
                    )}
                  </>
                )}

                {attr.dataType === 'DATE' && (
                  <Input
                    type="date"
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                  />
                )}

                {attr.dataType === 'DATETIME' && (
                  <Input
                    type="datetime-local"
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                  />
                )}

                {attr.dataType === 'BOOLEAN' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!value}
                      onChange={(e) => onChange(attr.fieldName, e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-600">
                      {value ? 'Yes' : 'No'}
                    </span>
                  </label>
                )}

                {attr.dataType === 'DROPDOWN' && (
                  <Select
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                  >
                    <option value="">Select...</option>
                    {(attr.dropdownOptions ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </Select>
                )}

                {attr.dataType === 'URL' && (
                  <Input
                    type="url"
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                    placeholder="https://..."
                    className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                  />
                )}

                {attr.dataType === 'FILE' && (
                  <Input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(attr.fieldName, e.target.value)}
                    placeholder="File path (upload coming soon)"
                  />
                )}

                {/* Inline validation error */}
                {errMsg && (
                  <p className="text-xs text-red-500 font-medium">{errMsg}</p>
                )}
              </div>
            );
          })}
        </div>
      );
    },
    [validateAttrValue],
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
          <Badge variant="secondary" className="text-xs">
            {treeData?.length ?? 0} entities
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={openAddDialog}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Entity
          </Button>
          <Button size="sm" variant="outline" onClick={openLinkDialog}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Link Entities
          </Button>

          {/* View Toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'tree' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
              onClick={() => setViewMode('tree')}
            >
              Tree
            </button>
            <button
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'list' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>

          {/* Template Manager Link */}
          <Link to="/assets/templates">
            <Button size="sm" variant="ghost" title="Template Manager">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Button>
          </Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      {viewMode === 'tree' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Tree */}
          <div className="w-80 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
            {/* Tree Filters */}
            <div className="p-3 border-b border-slate-100 space-y-2">
              <Input
                type="text"
                placeholder="Search entities..."
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                className="h-9 text-sm"
              />
              <div className="flex gap-2">
                <Select
                  selectSize="sm"
                  value={treeTemplateFilter}
                  onChange={(e) => setTreeTemplateFilter(e.target.value)}
                  className="flex-1 text-xs"
                >
                  <option value="">All Templates</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2">
                <button
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  onClick={expandAll}
                >
                  Expand All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  onClick={collapseAll}
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Tree Content */}
            <div className="flex-1 overflow-y-auto">
              {treeLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : rootNodes.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="text-3xl mb-3">{'\uD83C\uDFED'}</div>
                  <p className="text-sm font-medium text-slate-600">No entities found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {hasActiveFilters ? 'Try adjusting your filters' : 'Create your first entity to get started'}
                  </p>
                </div>
              ) : (
                <div className="py-1">
                  {rootNodes.map((node) => renderTreeNode(node, hasActiveFilters ? 0 : 0))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Detail */}
          <div className="flex-1 bg-slate-50/50 overflow-y-auto">
            {selectedAssetId ? (
              detailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : selectedAsset ? (
                <AssetDetailPanel
                  asset={selectedAsset}
                  parentPath={getParentPath(selectedAsset.id)}
                  formatDateTime={formatDateTime}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  auditRecords={auditRecords}
                  allRelationships={allRelationshipsData ?? []}
                  treeData={treeData ?? []}
                  onEdit={openEditDialog}
                  onLink={openLinkDialog}
                  onDelete={() => { setError(''); setShowDeleteDialog(true); }}
                  onDeleteRelationship={handleDeleteRelationship}
                  onDeleteIdentifier={handleDeleteIdentifier}
                  onAddIdentifier={() => {
                    setNewIdentifier({ identifierType: 'MANUAL', identifierValue: '', label: '', isPrimary: false });
                    setError('');
                    setShowAddIdentifierDialog(true);
                  }}
                  onSelectAsset={(id) => {
                    setSelectedAssetId(id);
                    setActiveTab('overview');
                  }}
                  onAddChild={(parentId) => {
                    resetWizard();
                    setNewAsset((prev) => ({ ...prev, parentId }));
                    setShowAddDialog(true);
                  }}
                  onAttachExisting={(parentId) => {
                    setAttachParentId(parentId);
                    setAttachTargetId('');
                    setAttachSearch('');
                    setError('');
                    setShowAttachExistingDialog(true);
                  }}
                  onRemoveFromDiagram={handleRemoveFromDiagram}
                  renderAttributeForm={renderAttributeForm}
                />
              ) : (
                <div className="flex items-center justify-center py-20 text-slate-400">
                  Entity not found
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="text-5xl mb-4">{'\uD83C\uDFED'}</div>
                <h2 className="text-lg font-semibold text-slate-700 mb-2">Welcome to Entity Explorer</h2>
                <p className="text-sm text-slate-500 max-w-md mb-6">
                  Select an entity from the tree to view its details, attributes, relationships, and identifiers. Or create a new entity to get started.
                </p>
                <Button onClick={openAddDialog}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
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
            <Input
              type="text"
              placeholder="Search entities..."
              value={listSearch}
              onChange={(e) => { setListSearch(e.target.value); setListPage(1); }}
              className="max-w-sm h-9 text-sm"
            />
            <Select
              selectSize="sm"
              value={treeTemplateFilter}
              onChange={(e) => { setTreeTemplateFilter(e.target.value); setListPage(1); }}
              className="w-48"
            >
              <option value="">All Templates</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>

          {listLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(listData?.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-slate-400">
                        No entities found
                      </TableCell>
                    </TableRow>
                  ) : (
                    (listData?.data ?? []).map((item) => {
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <button
                              className="flex items-center gap-2 font-medium text-blue-600 hover:text-blue-800"
                              onClick={() => {
                                setSelectedAssetId(item.id);
                                setViewMode('tree');
                                setActiveTab('overview');
                              }}
                            >
                              <span>{getIcon(item.template.icon)}</span>
                              {item.name}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{item.template.name}</Badge>
                          </TableCell>
                          <TableCell className="text-slate-500 text-sm">
                            {(() => {
                              const parent = treeData?.find((n) => n.id === item.parentId);
                              return parent ? parent.name : '-';
                            })()}
                          </TableCell>
                          <TableCell className="text-slate-500 text-sm">
                            {formatDateTime(item.createdAt)}
                          </TableCell>
                          <TableCell>
                            <button
                              className="text-slate-400 hover:text-blue-600 transition-colors p-1"
                              title="View details"
                              onClick={() => {
                                setSelectedAssetId(item.id);
                                setViewMode('tree');
                                setActiveTab('overview');
                              }}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {listData && listData.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <p className="text-sm text-slate-500">
                    Page {listData.page} of {listData.totalPages} ({listData.total} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={listData.page <= 1}
                      onClick={() => setListPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={listData.page >= listData.totalPages}
                      onClick={() => setListPage((p) => p + 1)}
                    >
                      Next
                    </Button>
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

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
      />

      {/* ---- Add Entity Wizard Dialog ---- */}
      <Dialog
        open={showAddDialog}
        onClose={() => { setShowAddDialog(false); resetWizard(); }}
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Add New Entity</DialogTitle>
          <DialogDescription>
            {wizardStep === 1 && 'Step 1: Select a template for your new entity'}
            {wizardStep === 2 && 'Step 2: Enter basic information'}
            {wizardStep === 3 && 'Step 3: Fill in attribute values'}
            {wizardStep === 4 && 'Step 4: Review and create'}
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                  wizardStep === step
                    ? 'bg-blue-600 text-white'
                    : wizardStep > step
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-400',
                )}
              >
                {wizardStep > step ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              {step < 4 && (
                <div className={cn('w-12 h-0.5', wizardStep > step ? 'bg-emerald-500' : 'bg-slate-200')} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Select Template */}
        {wizardStep === 1 && (
          <div className="space-y-4">
            <Input
              type="text"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="h-9 text-sm"
            />
            <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto">
              {templates
                .filter((t) =>
                  !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()),
                )
                .map((t) => (
                  <button
                    key={t.id}
                    className={cn(
                      'text-left p-4 rounded-xl border-2 transition-all duration-200',
                      selectedTemplateId === t.id
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                    onClick={() => setSelectedTemplateId(t.id)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{getIcon(t.icon)}</span>
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{t.name}</p>
                      </div>
                    </div>
                    {t.description && (
                      <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-2">
                      {(t.attributeSchema as any)?.length ?? 0} attributes
                    </p>
                  </button>
                ))}
              {templates.filter((t) =>
                !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase()),
              ).length === 0 && (
                <div className="col-span-2 text-center py-8 text-slate-400 text-sm">
                  No templates found. Create one in the Template Manager first.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Basic Info */}
        {wizardStep === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">
                Entity Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={newAsset.name}
                onChange={(e) => setNewAsset((p) => ({ ...p, name: e.target.value }))}
                placeholder="Enter entity name"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Description</label>
              <textarea
                className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
                rows={3}
                value={newAsset.description}
                onChange={(e) => setNewAsset((p) => ({ ...p, description: e.target.value }))}
                placeholder="Describe this entity..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Parent Entity</label>
              <Select
                value={newAsset.parentId ?? ''}
                onChange={(e) => setNewAsset((p) => ({ ...p, parentId: e.target.value || null }))}
              >
                <option value="">None (root level)</option>
                {flatAssetList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {/* Step 3: Attributes */}
        {wizardStep === 3 && (
          <div className="max-h-[50vh] overflow-y-auto pr-1">
            {selectedTemplateDetail ? (
              renderAttributeForm(
                selectedTemplateDetail.attributeSchema ?? [],
                newAsset.attributes,
                (field, value) =>
                  setNewAsset((p) => ({
                    ...p,
                    attributes: { ...p.attributes, [field]: value },
                  })),
              )
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
              </div>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {wizardStep === 4 && (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{selectedTemplateDetail ? getIcon(selectedTemplateDetail.icon) : ''}</span>
                  <div>
                    <p className="font-semibold text-slate-800">{newAsset.name}</p>
                    <Badge variant="secondary" className="text-xs">{selectedTemplateDetail?.name}</Badge>
                  </div>
                </div>
                {newAsset.description && (
                  <p className="text-sm text-slate-600">{newAsset.description}</p>
                )}
                <div className="text-sm">
                  <span className="text-slate-500">Parent:</span>{' '}
                  <span className="font-medium">
                    {newAsset.parentId
                      ? flatAssetList.find((a) => a.id === newAsset.parentId)?.name ?? 'Unknown'
                      : 'None'}
                  </span>
                </div>

                {/* Attributes summary */}
                {Object.keys(newAsset.attributes).length > 0 && selectedTemplateDetail && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attributes</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {(selectedTemplateDetail.attributeSchema ?? []).map((attr) => {
                        const val = newAsset.attributes[attr.fieldName];
                        if (val === undefined || val === null || val === '') return null;
                        let display: string;
                        const c = attr.numericConstraints;
                        switch (attr.dataType) {
                          case 'BOOLEAN':
                            display = val ? 'Yes' : 'No';
                            break;
                          case 'INTEGER':
                            display = String(val);
                            break;
                          case 'FLOAT':
                            if (typeof val === 'number' && Number.isInteger(val)) {
                              const precision = c?.enabled && c.resolution
                                ? Math.max(1, Math.max(0, -Math.floor(Math.log10(c.resolution))))
                                : 1;
                              display = val.toFixed(precision);
                            } else {
                              display = String(val);
                            }
                            break;
                          default:
                            display = String(val);
                        }
                        return (
                          <div key={attr.fieldName}>
                            <span className="text-slate-500">{attr.fieldName}:</span>{' '}
                            <span className="font-medium text-slate-800">{display}</span>
                            {attr.unit && <span className="text-xs text-slate-400 ml-1">{attr.unit}</span>}
                            <Badge variant="outline" className="text-[10px] ml-1.5 px-1 py-0">{attr.dataType}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Wizard Navigation */}
        <DialogFooter className="mt-6">
          <Button
            variant="outline"
            onClick={() => {
              if (wizardStep === 1) {
                setShowAddDialog(false);
                resetWizard();
              } else {
                setWizardStep((s) => s - 1);
              }
            }}
          >
            {wizardStep === 1 ? 'Cancel' : 'Previous'}
          </Button>
          {wizardStep < 4 ? (
            <Button
              onClick={() => setWizardStep((s) => s + 1)}
              disabled={
                (wizardStep === 1 && !selectedTemplateId) ||
                (wizardStep === 2 && !newAsset.name.trim()) ||
                (wizardStep === 3 && selectedTemplateDetail && hasAttributeErrors(selectedTemplateDetail.attributeSchema ?? [], newAsset.attributes))
              }
            >
              Next
            </Button>
          ) : (
            <Button onClick={handleCreateAsset} disabled={saving}>
              {saving ? 'Creating...' : 'Create Entity'}
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {/* ---- Edit Entity Dialog ---- */}
      <Dialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Edit Entity</DialogTitle>
          <DialogDescription>
            Update entity information and attribute values
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">
              Entity Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              value={editAsset.name}
              onChange={(e) => setEditAsset((p) => ({ ...p, name: e.target.value }))}
              placeholder="Enter entity name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Description</label>
            <textarea
              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
              rows={3}
              value={editAsset.description}
              onChange={(e) => setEditAsset((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe this entity..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Parent Entity</label>
            <Select
              value={editAsset.parentId ?? ''}
              onChange={(e) => setEditAsset((p) => ({ ...p, parentId: e.target.value || null }))}
            >
              <option value="">None (root level)</option>
              {flatAssetList
                .filter((a) => a.id !== selectedAssetId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})
                  </option>
                ))}
            </Select>
          </div>

          {/* Attributes */}
          {selectedAsset?.template?.attributeSchema && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-semibold text-slate-700 mb-3">Attributes</p>
              <div className="max-h-[30vh] overflow-y-auto pr-1">
                {renderAttributeForm(
                  (selectedAsset.template.attributeSchema as any) ?? [],
                  editAsset.attributes,
                  (field, value) =>
                    setEditAsset((p) => ({
                      ...p,
                      attributes: { ...p.attributes, [field]: value },
                    })),
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShowEditDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateAsset}
            disabled={
              saving ||
              !editAsset.name.trim() ||
              (selectedAsset?.template?.attributeSchema && hasAttributeErrors((selectedAsset.template.attributeSchema as any) ?? [], editAsset.attributes))
            }
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            Delete Entity
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Are you sure you want to delete <span className="font-semibold text-slate-800">{selectedAsset?.name}</span>?
          </p>
          {selectedAsset && selectedAsset.sourceRelations?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
              This entity has {selectedAsset.sourceRelations.length} relationship(s) that will also be removed.
            </div>
          )}
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            This will also deactivate all child entities. This action cannot be easily undone.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDeleteAsset} disabled={saving}>
            {saving ? 'Deleting...' : 'Delete Entity'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ---- Link Entities Dialog ---- */}
      <Dialog
        open={showLinkDialog}
        onClose={() => { setShowLinkDialog(false); resetLinkDialog(); }}
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Link Entities</DialogTitle>
          <DialogDescription>
            Create relationships between entities. Select one source and one or more targets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Source */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Source Entity</label>
            <Select
              value={linkSource}
              onChange={(e) => setLinkSource(e.target.value)}
            >
              <option value="">Select source entity...</option>
              {flatAssetList.map((a) => (
                <option key={a.id} value={a.id}>
                  {'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})
                </option>
              ))}
            </Select>
          </div>

          {/* Relationship Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Relationship Type</label>
            <div className="space-y-1">
              {ALL_RELATIONSHIP_TYPES.map((type) => (
                  <label
                    key={type}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer',
                      linkType === type
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="linkType"
                      value={type}
                      checked={linkType === type}
                      onChange={() => setLinkType(type)}
                      className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      {RELATIONSHIP_LABELS[type] || type}
                    </span>
                  </label>
              ))}
            </div>
            {linkType === 'CUSTOM' && (
              <Input
                type="text"
                placeholder="Enter custom relationship label"
                value={linkCustomLabel}
                onChange={(e) => setLinkCustomLabel(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {/* Target Entities (multi-select) */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">
              Target Entities
              {linkTargets.length > 0 && (
                <span className="ml-2 text-xs font-normal text-blue-600">
                  ({linkTargets.length} selected)
                </span>
              )}
            </label>
            {/* Selected targets as chips */}
            {linkTargets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1 max-h-24 overflow-y-auto">
                {linkTargets.map((tid) => {
                  const asset = flatAssetList.find((a) => a.id === tid);
                  return (
                    <span
                      key={tid}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700"
                    >
                      {asset?.name ?? 'Unknown'}
                      <button
                        type="button"
                        onClick={() => setLinkTargets((prev) => prev.filter((id) => id !== tid))}
                        className="ml-0.5 p-0.5 rounded hover:bg-blue-200 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {/* Search box */}
            <Input
              value={linkTargetSearch}
              onChange={(e) => setLinkTargetSearch(e.target.value)}
              placeholder="Search entities..."
              className="text-sm"
            />
            {/* Scrollable checkbox list */}
            <div className="max-h-48 overflow-y-auto rounded-xl border-2 border-slate-200 bg-white divide-y divide-slate-100">
              {flatAssetList
                .filter((a) => a.id !== linkSource)
                .filter((a) => !linkTargetSearch || a.name.toLowerCase().includes(linkTargetSearch.toLowerCase()) || a.templateName.toLowerCase().includes(linkTargetSearch.toLowerCase()))
                .map((a) => {
                  const isChecked = linkTargets.includes(a.id);
                  const isParentNode = a.childCount > 0 && linkType === 'CONTAINS';
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 transition-colors',
                        isParentNode ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50',
                        isChecked && !isParentNode && 'bg-blue-50/60',
                      )}
                      title={isParentNode ? 'Parent nodes with children cannot be a target of CONTAINS' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isParentNode}
                        onChange={() => {
                          if (isParentNode) return;
                          setLinkTargets((prev) =>
                            isChecked ? prev.filter((id) => id !== a.id) : [...prev, a.id],
                          );
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={cn('text-sm', isParentNode ? 'text-slate-400' : 'text-slate-700')}>
                        {'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name}
                      </span>
                      {isParentNode && <span className="text-xs text-amber-600 font-medium">Parent Node</span>}
                      <span className="text-xs text-slate-400 ml-auto">{a.templateName}</span>
                    </label>
                  );
                })}
              {flatAssetList.filter((a) => a.id !== linkSource).length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-400">No entities available</div>
              )}
            </div>
          </div>

          {/* Direction preview */}
          {linkSource && linkTargets.length > 0 && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-50">Preview</p>
              {linkTargets.map((tid) => (
                <p key={tid} className="text-sm text-slate-700">
                  <span className="font-medium">
                    {flatAssetList.find((a) => a.id === linkSource)?.name ?? 'Source'}
                  </span>
                  {' '}<span className="text-blue-600 font-medium">
                    ---{RELATIONSHIP_LABELS[linkType] || linkType}---&gt;
                  </span>{' '}
                  <span className="font-medium">
                    {flatAssetList.find((a) => a.id === tid)?.name ?? 'Target'}
                  </span>
                </p>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Notes (optional)</label>
            <textarea
              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
              rows={2}
              value={linkNotes}
              onChange={(e) => setLinkNotes(e.target.value)}
              placeholder="Add notes about this relationship..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowLinkDialog(false); resetLinkDialog(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateRelationship}
            disabled={saving || !linkSource || linkTargets.length === 0 || linkTargets.includes(linkSource)}
          >
            {saving ? 'Linking...' : `Link ${linkTargets.length > 1 ? `${linkTargets.length} Entities` : 'Entities'}`}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ---- Add Identifier Dialog ---- */}
      <Dialog
        open={showAddIdentifierDialog}
        onClose={() => setShowAddIdentifierDialog(false)}
      >
        <DialogHeader>
          <DialogTitle>Add Identifier</DialogTitle>
          <DialogDescription>
            Attach a physical identifier to this entity
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Type</label>
            <Select
              value={newIdentifier.identifierType}
              onChange={(e) => setNewIdentifier((p) => ({ ...p, identifierType: e.target.value }))}
            >
              <option value="QR">QR Code</option>
              <option value="BARCODE">Barcode</option>
              <option value="RFID">RFID</option>
              <option value="NFC">NFC</option>
              <option value="MANUAL">Manual</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">
              Value <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              value={newIdentifier.identifierValue}
              onChange={(e) => setNewIdentifier((p) => ({ ...p, identifierValue: e.target.value }))}
              placeholder="Scan or enter identifier value"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Label</label>
            <Input
              type="text"
              value={newIdentifier.label}
              onChange={(e) => setNewIdentifier((p) => ({ ...p, label: e.target.value }))}
              placeholder="e.g., Front Panel QR"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newIdentifier.isPrimary}
              onChange={(e) => setNewIdentifier((p) => ({ ...p, isPrimary: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700 font-medium">Primary identifier</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddIdentifierDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateIdentifier}
            disabled={saving || !newIdentifier.identifierValue.trim()}
          >
            {saving ? 'Adding...' : 'Add Identifier'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ---- Attach Existing Entity Dialog ---- */}
      <Dialog
        open={showAttachExistingDialog}
        onClose={() => { setShowAttachExistingDialog(false); setAttachParentId(''); setAttachTargetId(''); setAttachSearch(''); }}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Attach Existing Entity</DialogTitle>
          <DialogDescription>
            Link an existing entity as a child of{' '}
            <span className="font-semibold text-slate-700">
              {flatAssetList.find((a) => a.id === attachParentId)?.name ?? 'this entity'}
            </span>{' '}
            using a CONTAINS relationship.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Search */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Select Entity</label>
            <Input
              value={attachSearch}
              onChange={(e) => setAttachSearch(e.target.value)}
              placeholder="Search entities by name or template..."
              className="text-sm"
              autoFocus
            />
          </div>

          {/* Entity list */}
          <div className="max-h-64 overflow-y-auto rounded-xl border-2 border-slate-200 bg-white divide-y divide-slate-100">
            {flatAssetList
              .filter((a) => a.id !== attachParentId)
              .filter((a) => !attachSearch || a.name.toLowerCase().includes(attachSearch.toLowerCase()) || a.templateName.toLowerCase().includes(attachSearch.toLowerCase()))
              .map((a) => {
                const isSelected = attachTargetId === a.id;
                const isParentNode = a.childCount > 0;
                return (
                  <label
                    key={a.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 transition-colors',
                      isParentNode ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50',
                      isSelected && !isParentNode && 'bg-blue-50/60 border-l-2 border-blue-500',
                    )}
                    title={isParentNode ? 'Parent nodes with children cannot be attached as a child' : undefined}
                  >
                    <input
                      type="radio"
                      name="attachTarget"
                      checked={isSelected}
                      onChange={() => !isParentNode && setAttachTargetId(a.id)}
                      disabled={isParentNode}
                      className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={cn('text-sm font-medium truncate block', isParentNode ? 'text-slate-400' : 'text-slate-700')}>
                        {'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name}
                      </span>
                    </div>
                    {isParentNode && <span className="text-xs text-amber-600 font-medium flex-shrink-0">Parent Node</span>}
                    <span className="text-xs text-slate-400 flex-shrink-0">{a.templateName}</span>
                  </label>
                );
              })}
            {flatAssetList.filter((a) => a.id !== attachParentId).length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-slate-400">No entities available to attach</div>
            )}
          </div>

          {/* Preview */}
          {attachTargetId && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Preview</p>
              <p className="text-sm text-slate-700">
                <span className="font-medium">{flatAssetList.find((a) => a.id === attachParentId)?.name ?? 'Parent'}</span>
                {' '}<span className="text-emerald-600 font-medium">---Contains---&gt;</span>{' '}
                <span className="font-medium">{flatAssetList.find((a) => a.id === attachTargetId)?.name ?? 'Target'}</span>
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAttachExistingDialog(false); setAttachParentId(''); setAttachTargetId(''); setAttachSearch(''); }}>
            Cancel
          </Button>
          <Button
            onClick={handleAttachExisting}
            disabled={saving || !attachTargetId || attachTargetId === attachParentId}
          >
            {saving ? 'Attaching...' : 'Attach Entity'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// =============================================
// Entity Detail Panel Component
// =============================================

interface AssetDetailPanelProps {
  asset: AssetInstance;
  parentPath: string[];
  formatDateTime: (value: string | Date) => string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  auditRecords: AuditRecord[];
  allRelationships: AssetRelation[];
  treeData: TreeNode[];
  onEdit: () => void;
  onLink: () => void;
  onDelete: () => void;
  onDeleteRelationship: (id: string) => void;
  onDeleteIdentifier: (id: string) => void;
  onAddIdentifier: () => void;
  onSelectAsset: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAttachExisting: (parentId: string) => void;
  onRemoveFromDiagram: (childId: string, parentId: string, allRels: AssetRelation[]) => void;
  renderAttributeForm: (
    schema: AttributeDefinition[],
    values: Record<string, any>,
    onChange: (field: string, value: any) => void,
  ) => React.ReactNode;
}

function AssetDetailPanel({
  asset,
  parentPath,
  formatDateTime,
  activeTab,
  setActiveTab,
  auditRecords,
  allRelationships,
  treeData: treeNodes,
  onEdit,
  onLink,
  onDelete,
  onDeleteRelationship,
  onDeleteIdentifier,
  onAddIdentifier,
  onSelectAsset,
  onAddChild,
  onAttachExisting,
  onRemoveFromDiagram,
}: AssetDetailPanelProps) {
  const attrSchema = (asset.template?.attributeSchema as AttributeDefinition[]) ?? [];

  // Inverse relationship map — used to deduplicate bidirectional pairs
  const INVERSE_MAP: Record<string, string> = {
    CONTAINS: 'CONTAINED_IN', CONTAINED_IN: 'CONTAINS',
    FEEDS: 'FED_BY', FED_BY: 'FEEDS',
    DEPENDS_ON: 'DEPENDED_ON_BY', DEPENDED_ON_BY: 'DEPENDS_ON',
    BACKS_UP: 'BACKED_UP_BY', BACKED_UP_BY: 'BACKS_UP',
    MONITORS: 'MONITORED_BY', MONITORED_BY: 'MONITORS',
    CONNECTED_TO: 'CONNECTED_TO',
  };

  // Combine source and target relations for display, deduplicating inverse pairs
  const allRelations = useMemo(() => {
    const relations: {
      id: string;
      type: string;
      direction: 'outgoing' | 'incoming';
      relatedAsset: { id: string; name: string };
      customLabel?: string;
    }[] = [];

    // Outgoing first (these take priority)
    for (const r of asset.sourceRelations ?? []) {
      if (r.targetAsset) {
        relations.push({
          id: r.id,
          type: r.relationshipType,
          direction: 'outgoing',
          relatedAsset: r.targetAsset,
          customLabel: r.customLabel,
        });
      }
    }

    // Track which entity+type combos are already covered by outgoing
    const outgoingPairs = new Set(
      relations.map((r) => `${r.relatedAsset.id}:${r.type}`),
    );

    // Only add incoming if there's no matching outgoing inverse to the same entity
    for (const r of asset.targetRelations ?? []) {
      if (r.sourceAsset) {
        const inverseType = INVERSE_MAP[r.relationshipType];
        const hasDuplicate = inverseType && outgoingPairs.has(`${r.sourceAsset.id}:${inverseType}`);
        if (!hasDuplicate) {
          relations.push({
            id: r.id,
            type: r.relationshipType,
            direction: 'incoming',
            relatedAsset: r.sourceAsset,
            customLabel: r.customLabel,
          });
        }
      }
    }
    return relations;
  }, [asset.sourceRelations, asset.targetRelations]);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'attributes', label: 'Attributes' },
    { key: 'telemetry', label: 'Telemetry' },
    { key: 'relationships', label: `Relationships (${allRelations.length})` },
    { key: 'identifiers', label: `Identifiers (${asset.identifiers?.length ?? 0})` },
    { key: 'audit', label: 'Audit History' },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{getIcon(asset.template?.icon)}</span>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{asset.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">{asset.template?.name}</Badge>
              </div>
              {parentPath.length > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  {parentPath.join(' > ')} &gt; {asset.name}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onEdit} title="Edit">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Button>
            <Button size="sm" variant="ghost" onClick={onLink} title="Link">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="text-red-500 hover:text-red-700 hover:bg-red-50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Name</p>
              <p className="text-sm font-medium text-slate-800">{asset.name}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Template</p>
              <p className="text-sm font-medium text-slate-800">{asset.template?.name}</p>
              <p className="text-xs text-slate-400">v{asset.templateVersion}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Parent</p>
              {asset.parent ? (
                <button
                  className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  onClick={() => onSelectAsset(asset.parent!.id)}
                >
                  {asset.parent.name}
                </button>
              ) : (
                <p className="text-sm text-slate-500">None (root level)</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Description</p>
              <p className="text-sm text-slate-700">{asset.description || 'No description'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Children</p>
              <p className="text-sm font-medium text-slate-800">
                {(asset as any)._count?.children ?? '-'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Created</p>
              <p className="text-sm text-slate-700">{formatDateTime(asset.createdAt)}</p>
              <p className="text-xs text-slate-400">by {asset.createdBy}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Last Modified</p>
              <p className="text-sm text-slate-700">{formatDateTime(asset.updatedAt)}</p>
              {asset.updatedBy && <p className="text-xs text-slate-400">by {asset.updatedBy}</p>}
            </CardContent>
          </Card>
          {/* Connection cards */}
          {(() => {
            const maxConn = asset.template?.maxConnections ?? 10;
            const usedConn = asset._count?.sourceRelations ?? 0;
            const isUnlimited = maxConn === 0;
            const pct = isUnlimited ? 0 : Math.min(100, Math.round((usedConn / maxConn) * 100));
            const atLimit = !isUnlimited && usedConn >= maxConn;

            const maxParent = asset.template?.maxParentConnections ?? 1;
            const parentUsed = (asset.targetRelations || []).filter((r) => r.relationshipType === 'CONTAINS').length;
            const parentNoLimit = maxParent === 0;
            const parentPct = parentNoLimit ? 0 : maxParent > 0 ? Math.min(100, Math.round((parentUsed / maxParent) * 100)) : 0;
            const parentAtLimit = !parentNoLimit && parentUsed >= maxParent;

            return (
              <>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Connections Allowed</p>
                    <p className="text-sm font-medium text-slate-800">{isUnlimited ? 'Unlimited' : maxConn}</p>
                    <p className="text-xs text-slate-400">max total connections (all types)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Connections Used</p>
                    <p className="text-sm font-medium text-slate-800">
                      {usedConn}{!isUnlimited && ` / ${maxConn}`}
                    </p>
                    {!isUnlimited && (
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', atLimit ? 'bg-red-500' : 'bg-emerald-500')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Parent Connections Allowed</p>
                    <p className="text-sm font-medium text-slate-800">{parentNoLimit ? 'Not Allowed' : maxParent}</p>
                    <p className="text-xs text-slate-400">max CONTAINS parent connections</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Parent Connections Used</p>
                    <p className="text-sm font-medium text-slate-800">
                      {parentUsed}{!parentNoLimit && ` / ${maxParent}`}
                    </p>
                    {!parentNoLimit && maxParent > 0 && (
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', parentAtLimit ? 'bg-red-500' : 'bg-emerald-500')}
                          style={{ width: `${parentPct}%` }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>
      )}

      {/* Attributes Tab */}
      {activeTab === 'attributes' && (
        <div>
          {attrSchema.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No attributes defined for this template.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field Name</TableHead>
                  <TableHead>Data Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrSchema.map((attr) => {
                  const value = asset.attributes?.[attr.fieldName];
                  const constraints = attr.numericConstraints;
                  let displayValue: string;

                  if (value === undefined || value === null || value === '') {
                    displayValue = '-';
                  } else if (attr.dataType === 'BOOLEAN') {
                    displayValue = value ? 'Yes' : 'No';
                  } else if (attr.dataType === 'FLOAT' && typeof value === 'number') {
                    const precision = constraints?.resolution
                      ? Math.max(0, -Math.floor(Math.log10(constraints.resolution)))
                      : 2;
                    displayValue = value.toFixed(precision);
                  } else {
                    displayValue = String(value);
                  }

                  return (
                    <TableRow key={attr.fieldName}>
                      <TableCell className="font-medium">
                        {attr.fieldName}
                        {attr.required && <span className="text-red-500 ml-1">*</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{attr.dataType}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-800">{displayValue}</TableCell>
                      <TableCell className="text-slate-500">{attr.unit || '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Telemetry Tab */}
      {activeTab === 'telemetry' && (
        <div>
          {(() => {
            const telSchema = (asset.template as any)?.telemetrySchema as TelemetryDefinition[] | undefined;
            const telConfig = asset.telemetryConfig ?? {};
            if (!telSchema || telSchema.length === 0) {
              return (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500">No telemetry points defined in this entity's template.</p>
                </div>
              );
            }
            return (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="font-semibold text-slate-600">Field Name</TableHead>
                    <TableHead className="font-semibold text-slate-600">Data Type</TableHead>
                    <TableHead className="font-semibold text-slate-600">Unit</TableHead>
                    <TableHead className="font-semibold text-slate-600">Description</TableHead>
                    <TableHead className="font-semibold text-slate-600">Config Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {telSchema.map((tel, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-slate-800">{tel.fieldName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{tel.dataType}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-500">{tel.unit || '-'}</TableCell>
                      <TableCell className="text-slate-500">{tel.description || '-'}</TableCell>
                      <TableCell className="text-slate-800">
                        {telConfig[tel.fieldName] !== undefined ? String(telConfig[tel.fieldName]) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            );
          })()}
        </div>
      )}

      {/* Relationships Tab */}
      {activeTab === 'relationships' && (() => {
        const outgoing = allRelations.filter((r) => r.direction === 'outgoing');
        const incoming = allRelations.filter((r) => r.direction === 'incoming');
        return (
        <div>
          <div className="mb-4">
            <Button size="sm" variant="outline" onClick={onLink}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Relationship
            </Button>
          </div>

          {/* ---- Hierarchical Tree Diagram ---- */}
          {allRelations.length > 0 && (() => {
            // Build lookup maps from treeData
            const templateLookup = new Map<string, string>();
            for (const n of treeNodes) templateLookup.set(n.id, n.template.name);

            // Only use forward relationship types to avoid duplicate inverse edges
            const FORWARD_TYPES = new Set(['CONTAINS','CONNECTED_TO','FEEDS','DEPENDS_ON','BACKS_UP','MONITORS','CUSTOM']);

            // Build adjacency: sourceId -> [{ id, name, type, label }]
            const childMap = new Map<string, { id: string; name: string; type: string; label?: string }[]>();
            for (const rel of allRelationships) {
              if (!FORWARD_TYPES.has(rel.relationshipType)) continue;
              const list = childMap.get(rel.sourceAssetId) ?? [];
              list.push({
                id: rel.targetAssetId,
                name: rel.targetAsset?.name ?? rel.targetAssetId,
                type: rel.relationshipType,
                label: rel.customLabel,
              });
              childMap.set(rel.sourceAssetId, list);
            }

            // Walk up from current entity to find topmost root
            const parentMap = new Map<string, { id: string; name: string }>();
            for (const rel of allRelationships) {
              if (!FORWARD_TYPES.has(rel.relationshipType)) continue;
              if (!parentMap.has(rel.targetAssetId)) {
                parentMap.set(rel.targetAssetId, {
                  id: rel.sourceAssetId,
                  name: rel.sourceAsset?.name ?? rel.sourceAssetId,
                });
              }
            }
            let rootId = asset.id;
            let rootName = asset.name;
            const walked = new Set<string>();
            while (parentMap.has(rootId) && !walked.has(rootId)) {
              walked.add(rootId);
              const p = parentMap.get(rootId)!;
              rootId = p.id;
              rootName = p.name;
            }

            // Recursive tree node renderer
            function renderDiagNode(
              nodeId: string,
              nodeName: string,
              relLabel: string | null,
              parentNodeId: string | null,
              visited: Set<string>,
            ): React.ReactNode {
              const isCurrent = nodeId === asset.id;
              const children = (childMap.get(nodeId) ?? []).filter((c) => !visited.has(c.id));
              const tplName = templateLookup.get(nodeId);
              const nextVisited = new Set(visited);
              nextVisited.add(nodeId);

              return (
                <div key={nodeId} className="flex flex-col items-center group/diagnode">
                  {/* Relationship label above the node (except root) */}
                  {relLabel && (
                    <div className="mb-1 flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[9px] font-semibold text-emerald-600 whitespace-nowrap">
                        {relLabel}
                      </span>
                    </div>
                  )}

                  {/* Node box with hover actions */}
                  <div className="relative">
                    <button
                      onClick={() => !isCurrent && onSelectAsset(nodeId)}
                      className={cn(
                        'flex flex-col items-center px-4 py-2.5 rounded-xl border-2 shadow-sm transition-all min-w-[100px] max-w-[140px]',
                        isCurrent
                          ? 'border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-200 cursor-default'
                          : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50 hover:shadow-md cursor-pointer',
                      )}
                    >
                      <svg className={cn('w-5 h-5 mb-0.5', isCurrent ? 'text-blue-500' : 'text-slate-400')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <span className={cn('text-xs font-bold text-center truncate w-full', isCurrent ? 'text-blue-800' : 'text-slate-700')}>{nodeName}</span>
                      {tplName && (
                        <span className={cn('text-[9px] mt-0.5', isCurrent ? 'text-blue-500' : 'text-slate-400')}>{tplName}</span>
                      )}
                    </button>
                    {/* Hover action buttons */}
                    <div className="absolute -top-2 -right-2 flex gap-0.5 opacity-0 group-hover/diagnode:opacity-100 transition-opacity z-10">
                      {/* Create new child */}
                      <button
                        className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm hover:bg-emerald-600 transition-colors"
                        title="Create new child"
                        onClick={(e) => { e.stopPropagation(); onAddChild(nodeId); }}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                      </button>
                      {/* Attach existing entity as child */}
                      <button
                        className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-sm hover:bg-blue-600 transition-colors"
                        title="Attach existing entity"
                        onClick={(e) => { e.stopPropagation(); onAttachExisting(nodeId); }}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      </button>
                      {/* Remove from tree (delete CONTAINS relationship) */}
                      {parentNodeId && (
                        <button
                          className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm hover:bg-red-600 transition-colors"
                          title="Remove from tree"
                          onClick={(e) => { e.stopPropagation(); onRemoveFromDiagram(nodeId, parentNodeId, allRelationships); }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Connector lines + children */}
                  {children.length > 0 && (
                    <div className="flex flex-col items-center w-full">
                      {/* Vertical line down from parent */}
                      <div className="w-px h-5 bg-slate-300" />
                      {/* Arrow head */}
                      <svg className="w-3 h-2 text-slate-400 -mt-px" viewBox="0 0 12 8">
                        <path d="M0 0 L6 8 L12 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>

                      {children.length === 1 ? (
                        /* Single child: straight vertical line */
                        <div className="flex flex-col items-center">
                          <div className="w-px h-3 bg-slate-300" />
                          {renderDiagNode(
                            children[0].id,
                            children[0].name,
                            children[0].label || RELATIONSHIP_LABELS[children[0].type] || children[0].type,
                            nodeId,
                            nextVisited,
                          )}
                        </div>
                      ) : (
                        /* Multiple children: horizontal bar + vertical drops */
                        <div className="flex flex-col items-center w-full">
                          {/* Horizontal bar */}
                          <div className="relative flex justify-center" style={{ minWidth: `${children.length * 150}px` }}>
                            {/* The horizontal line spanning from first to last child center */}
                            <div className="absolute top-0 h-px bg-slate-300" style={{
                              left: `${100 / (children.length * 2)}%`,
                              right: `${100 / (children.length * 2)}%`,
                            }} />
                            {/* Children in a row */}
                            <div className="flex justify-center gap-4 w-full">
                              {children.map((child) => (
                                <div key={child.id} className="flex flex-col items-center flex-1 min-w-[120px]">
                                  {/* Vertical drop from horizontal bar */}
                                  <div className="w-px h-4 bg-slate-300" />
                                  {/* Arrow head */}
                                  <svg className="w-3 h-2 text-slate-400 -mt-px" viewBox="0 0 12 8">
                                    <path d="M0 0 L6 8 L12 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <div className="h-1" />
                                  {renderDiagNode(
                                    child.id,
                                    child.name,
                                    child.label || RELATIONSHIP_LABELS[child.type] || child.type,
                                    nodeId,
                                    nextVisited,
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="mb-6 rounded-xl border-2 border-slate-200 bg-gradient-to-b from-slate-50/50 to-white p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Hierarchy Diagram</p>
                <div className="overflow-x-auto pb-2">
                  <div className="flex justify-center min-w-fit">
                    {renderDiagNode(rootId, rootName, null, null, new Set())}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded border-2 border-blue-500 bg-blue-50 ring-1 ring-blue-200" />
                    <span className="text-[10px] text-slate-500">Current entity</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded border-2 border-slate-300 bg-white" />
                    <span className="text-[10px] text-slate-500">Related entity</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[8px] text-emerald-600 font-semibold">Label</span>
                    <span className="text-[10px] text-slate-500">Relationship</span>
                  </div>
                  <span className="text-[10px] text-slate-400 ml-auto">Click to navigate</span>
                </div>
              </div>
            );
          })()}

          {/* ---- Relationship Table ---- */}
          {allRelations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No relationships defined for this entity.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Related Entity</TableHead>
                  <TableHead className="w-16">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allRelations.map((rel) => (
                  <TableRow key={`${rel.id}-${rel.direction}`}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {rel.customLabel || RELATIONSHIP_LABELS[rel.type] || rel.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        'text-xs font-medium',
                        rel.direction === 'outgoing' ? 'text-blue-600' : 'text-purple-600',
                      )}>
                        {rel.direction === 'outgoing' ? '\u2192 Outgoing' : '\u2190 Incoming'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        onClick={() => onSelectAsset(rel.relatedAsset.id)}
                      >
                        {rel.relatedAsset.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        onClick={() => onDeleteRelationship(rel.id)}
                        title="Remove relationship"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        );
      })()}

      {/* Identifiers Tab */}
      {activeTab === 'identifiers' && (
        <div>
          <div className="mb-4">
            <Button size="sm" variant="outline" onClick={onAddIdentifier}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Identifier
            </Button>
          </div>
          {(!asset.identifiers || asset.identifiers.length === 0) ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No identifiers attached to this entity.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Primary</TableHead>
                  <TableHead className="w-16">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {asset.identifiers.map((ident) => (
                  <TableRow key={ident.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {IDENTIFIER_TYPE_LABELS[ident.identifierType] || ident.identifierType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{ident.identifierValue}</TableCell>
                    <TableCell className="text-slate-500">{ident.label || '-'}</TableCell>
                    <TableCell>
                      {ident.isPrimary && (
                        <Badge variant="success" className="text-xs">Primary</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        onClick={() => onDeleteIdentifier(ident.id)}
                        title="Remove identifier"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Audit History Tab */}
      {activeTab === 'audit' && (
        <div>
          {auditRecords.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No audit history available.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(record.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {record.action.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{record.userId}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                      {record.afterValue
                        ? typeof record.afterValue === 'string'
                          ? record.afterValue
                          : JSON.stringify(record.afterValue).substring(0, 100)
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
