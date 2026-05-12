import React, { useMemo, useState, useRef, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BulkUploadFiltersDialog } from '@/routes/filter-management/components/bulk-upload-filters-dialog';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { RELATIONSHIP_LABELS, IDENTIFIER_TYPE_LABELS, getIcon } from '../constants';
import type {
  AssetInstance,
  AssetRelation,
  AssetIdentifier,
  AuditRecord,
  TreeNode,
  AttributeDefinition,
  TelemetryDefinition,
} from '../types';
import { useAuth } from '@/hooks/use-auth';
import { useEntityWebSocket } from '@/hooks/use-entity-websocket';
import {
  AttributesTab,
  TelemetryTab,
  ConnectivityTab,
  AlarmsTab,
  ChecklistHistoryTab,
  QrCodeTab,
  AssignmentsTab,
} from './tabs';
import { ImagesTab } from './tabs/images-tab';

export interface AssetDetailPanelProps {
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
  canUpdate?: boolean;
  canDelete?: boolean;
  canCreate?: boolean;
  canManageRelationships?: boolean;
  onAttachExisting: (parentId: string) => void;
  onRemoveFromDiagram: (childId: string, parentId: string, allRels: AssetRelation[]) => void;
}

export function AssetDetailPanel({
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
  canUpdate = false,
  canDelete = false,
  canCreate = false,
  canManageRelationships = false,
  onAttachExisting,
  onRemoveFromDiagram,
}: AssetDetailPanelProps) {
  const attrSchema = (asset.template?.attributeSchema as AttributeDefinition[]) ?? [];
  const { user } = useAuth();
  const { connected: wsConnected } = useEntityWebSocket(asset.id);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const isAhu = asset.template?.name?.toLowerCase() === 'ahu';

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
    { key: 'connectivity', label: 'Connectivity' },
    { key: 'relationships', label: `Relationships (${allRelations.length})` },
    { key: 'identifiers', label: `Identifiers (${asset.identifiers?.length ?? 0})` },
    { key: 'alarms', label: 'Alarms' },
    { key: 'checklist-history', label: 'Checklists' },
    { key: 'qr-code', label: 'QR Code' },
    { key: 'images', label: 'Images' },
    { key: 'assignments', label: 'Assignments' },
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
            {isAhu && canCreate && (
              <Button size="sm" variant="outline" onClick={() => setBulkUploadOpen(true)} title="Bulk Upload Filters" className="text-xs gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                Bulk Upload
              </Button>
            )}
            {canUpdate && <Button size="sm" variant="ghost" onClick={onEdit} title="Edit">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Button>}
            {canManageRelationships && <Button size="sm" variant="ghost" onClick={onLink} title="Link">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </Button>}
            {canDelete && <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="text-red-500 hover:text-red-700 hover:bg-red-50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>}
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
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Children {(asset as any)._count?.children > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold px-1">{(asset as any)._count.children}</span>}
              </p>
              {(() => {
                const childNodes = treeNodes.filter((n: any) => n.parentId === asset.id);
                if (childNodes.length === 0) return <p className="text-sm text-slate-400">No children</p>;
                return (
                  <div className="space-y-1 mt-1">
                    {childNodes.slice(0, 10).map((child: any) => (
                      <button key={child.id} onClick={() => onSelectAsset(child.id)} className="flex items-center gap-2 w-full text-left text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded px-1.5 py-0.5 transition-colors">
                        <span className="text-xs">{getIcon(child.template?.icon)}</span>
                        <span className="truncate">{child.name}</span>
                      </button>
                    ))}
                    {childNodes.length > 10 && <p className="text-xs text-slate-400 pl-1">+{childNodes.length - 10} more</p>}
                  </div>
                );
              })()}
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
        <AttributesTab entityId={asset.id} template={asset.template} attributes={asset.attributes} formatDateTime={formatDateTime} wsConnected={wsConnected} userRole={user?.role} />
      )}

      {/* Telemetry Tab */}
      {activeTab === 'telemetry' && (
        <TelemetryTab entityId={asset.id} template={asset.template} telemetryConfig={asset.telemetryConfig ?? {}} formatDateTime={formatDateTime} wsConnected={wsConnected} userRole={user?.role} />
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
                  <TableHead>Actions</TableHead>
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
                      <div className="flex items-center gap-2">
                        {ident.identifierType === 'QR' && (
                          <button
                            className="text-cyan-400 hover:text-cyan-300 transition-colors px-2 py-1 text-xs border border-cyan-800 rounded flex items-center gap-1"
                            onClick={() => {
                              const val = ident.identifierValue;
                              const name = asset.name;
                              const label = ident.label || "";
                              const qrImgUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(val);
                              const w = window.open("", "_blank", "width=420,height=600");
                              if (!w) return;
                              w.document.write(`<!DOCTYPE html><html><head><title>QR - ${name}</title>
                              <style>body{text-align:center;font-family:Arial,sans-serif;padding:30px;background:#0f172a;color:white;margin:0}.qr-box{background:white;display:inline-block;padding:24px;border-radius:12px;margin:20px 0}.qr-box img{display:block}.name{font-size:20px;font-weight:bold;margin:16px 0 4px}.val{font-size:22px;font-family:monospace;color:#22d3ee;margin:8px 0 4px}.type{font-size:13px;color:#94a3b8;margin-bottom:20px}.btns{display:flex;gap:10px;justify-content:center}button{padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}.print-btn{background:#0891b2;color:white}.close-btn{background:#374151;color:#d1d5db}@media print{body{background:white;color:black;padding:20px}.val{color:#0891b2}.btns{display:none}}</style></head><body>
                              <div class="qr-box"><img src="${qrImgUrl}" width="200" height="200" alt="QR Code"/></div>
                              <div class="name">${name}</div><div class="val">${val}</div>
                              <div class="type">QR Code${label ? " | " + label : ""}</div>
                              <div class="btns"><button class="print-btn" onclick="window.print()">Print Label</button><button class="close-btn" onclick="window.close()">Close</button></div>
                              </body></html>`);
                              w.document.close();
                            }}
                            title="View & Print QR Code"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} /><circle cx="17.5" cy="17.5" r="3.5" strokeWidth={2} /></svg>
                            View QR
                          </button>
                        )}
                        {ident.identifierType === 'BARCODE' && (
                          <button
                            className="text-cyan-400 hover:text-cyan-300 transition-colors px-2 py-1 text-xs border border-cyan-800 rounded flex items-center gap-1"
                            onClick={() => {
                              const val = ident.identifierValue;
                              const name = asset.name;
                              const label = ident.label || "";
                              const w = window.open("", "_blank", "width=420,height=500");
                              if (!w) return;
                              w.document.write(`<!DOCTYPE html><html><head><title>Barcode - ${name}</title>
                              <style>body{text-align:center;font-family:Arial,sans-serif;padding:30px;background:#0f172a;color:white;margin:0}.bc-box{background:white;display:inline-block;padding:24px 32px;border-radius:12px;margin:20px 0}.bars{display:inline-flex;align-items:end;gap:1px;height:70px}.bar{background:black}.space{background:white}.name{font-size:20px;font-weight:bold;margin:16px 0 4px}.val{font-size:22px;font-family:monospace;color:#22d3ee;margin:8px 0;letter-spacing:3px}.type{font-size:13px;color:#94a3b8;margin-bottom:20px}.btns{display:flex;gap:10px;justify-content:center}button{padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}.print-btn{background:#0891b2;color:white}.close-btn{background:#374151;color:#d1d5db}@media print{body{background:white;color:black;padding:20px}.val{color:#0891b2}.btns{display:none}}</style></head><body>
                              <div class="bc-box"><div class="bars">${val.split('').map((c,i)=>{const w=(c.charCodeAt(0)%3)+1;const cls=i%3===2?'space':'bar';return '<div class="'+cls+'" style="width:'+w+'px;height:100%"></div>';}).join('')}</div><div style="font-family:monospace;font-size:14px;margin-top:8px;color:#333;letter-spacing:3px">${val}</div></div>
                              <div class="name">${name}</div><div class="val">${val}</div>
                              <div class="type">Barcode${label ? " | " + label : ""}</div>
                              <div class="btns"><button class="print-btn" onclick="window.print()">Print Label</button><button class="close-btn" onclick="window.close()">Close</button></div>
                              </body></html>`);
                              w.document.close();
                            }}
                            title="View & Print Barcode"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h2v12H4zM8 6h1v12H8zM11 6h3v12h-3zM16 6h2v12h-2zM20 6h1v12h-1z" /></svg>
                            View Barcode
                          </button>
                        )}
                        {(ident.identifierType === 'RFID' || ident.identifierType === 'NFC') && (
                          <span className="text-slate-500 px-2 py-1 text-xs border border-slate-700 rounded flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" /></svg>
                            {ident.identifierType}
                          </span>
                        )}
                        <button
                          className="text-slate-400 hover:text-red-500 transition-colors p-1"
                          onClick={() => onDeleteIdentifier(ident.id)}
                          title="Remove identifier"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Connectivity Tab */}
      {activeTab === 'connectivity' && (
        <ConnectivityTab entityId={asset.id} entityName={asset.name} formatDateTime={formatDateTime} />
      )}

      {/* Alarms Tab */}
      {activeTab === 'alarms' && (
        <AlarmsTab entityId={asset.id} formatDateTime={formatDateTime} />
      )}

      {/* Checklist History Tab */}
      {activeTab === 'checklist-history' && (
        <ChecklistHistoryTab entityId={asset.id} formatDateTime={formatDateTime} userRole={user?.role} checklistSchema={asset.template?.checklistSchema} />
      )}

      {/* QR Code Tab */}
      {activeTab === 'qr-code' && (
        <QrCodeTab entityId={asset.id} entityName={asset.name} />
      )}

      {activeTab === 'images' && (
        <ImagesTab entityId={asset.id} />
      )}

      {/* Assignments Tab */}
      {activeTab === 'assignments' && (
        <AssignmentsTab entityId={asset.id} />
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
                      {formatDateTime(record.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {record.action.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{record.userId}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                      {record.reason || record.signatureMeaning || (record.afterValue
                        ? typeof record.afterValue === 'string'
                          ? record.afterValue
                          : JSON.stringify(record.afterValue).substring(0, 120)
                        : '-')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
      {/* Bulk Upload Filters Dialog */}
      {isAhu && (
        <BulkUploadFiltersDialog
          open={bulkUploadOpen}
          onClose={() => setBulkUploadOpen(false)}
          ahuId={asset.id}
          ahuName={asset.name}
          onSuccess={() => {
            mutate(`/api/assets/instances/${asset.id}`);
            mutate((key: string) => typeof key === 'string' && key.includes('/api/assets/'), undefined, { revalidate: true });
          }}
        />
      )}
    </div>
  );
}
