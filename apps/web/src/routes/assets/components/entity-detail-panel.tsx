import React, { useMemo, useState, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { QRCodeSVG } from 'qrcode.react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Attributes Tab
   ═══════════════════════════════════════════════════════════ */
function AttributesTab({ entityId, template, attributes, formatDateTime, wsConnected, userRole }: { entityId: string; template: any; attributes: Record<string, any> | undefined; formatDateTime: (v: string | Date) => string; wsConnected?: boolean; userRole?: string }) {
  const attrSchema = (template?.attributeSchema as AttributeDefinition[]) ?? [];

  // Time range state
  const [timePreset, setTimePreset] = useState('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteOlderDays, setDeleteOlderDays] = useState(30);
  const [deleting, setDeleting] = useState(false);

  // Calculate from/to
  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return { from: customFrom || new Date(Date.now() - 86400000).toISOString(), to: customTo || new Date().toISOString() };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  // Fetch live device-reported attributes
  const { data: liveAttrs, isLoading } = useSWR<Array<{ key: string; value: any; updatedBy?: string; lastUpdated: string }>>(
    `/api/attributes/${entityId}/all`,
    { refreshInterval: 10000 }
  );

  // Fetch attribute history (server-side pagination)
  const histParams = new URLSearchParams({ from: timeRange.from, to: timeRange.to, page: String(historyPage), limit: String(HPAGE_SIZE) });
  const { data: historyData, isLoading: histLoading, mutate: mutateHistory } = useSWR<{ data: any[]; total: number; page: number; limit: number }>(
    `/api/attributes/${entityId}/history?${histParams}`,
    { refreshInterval: 30000 }
  );

  // Build lookup of live attributes
  const liveMap = useMemo(() => {
    const map: Record<string, { value: any; updatedBy?: string; lastUpdated: string }> = {};
    if (liveAttrs) {
      for (const row of liveAttrs) {
        map[row.key] = { value: row.value, updatedBy: row.updatedBy, lastUpdated: row.lastUpdated };
      }
    }
    return map;
  }, [liveAttrs]);

  const schemaKeys = new Set(attrSchema.map(a => a.fieldName));
  const extraKeys = liveAttrs?.filter(a => !schemaKeys.has(a.key)) ?? [];
  const totalHistoryPages = historyData ? Math.max(1, Math.ceil(historyData.total / HPAGE_SIZE)) : 1;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', { dataType: 'attributes', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
      mutateHistory();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {wsConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && (
          <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {['1h', '6h', '24h', '7d', '30d', 'custom'].map(p => (
          <button key={p} onClick={() => { setTimePreset(p); setHistoryPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', timePreset === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="datetime-local" value={customFrom ? customFrom.slice(0, 16) : ''} onChange={e => { setCustomFrom(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
            <span className="text-xs text-slate-400">to</span>
            <input type="datetime-local" value={customTo ? customTo.slice(0, 16) : ''} onChange={e => { setCustomTo(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
          </div>
        )}
      </div>

      {/* Live Device-Reported Attributes */}
      {liveAttrs && liveAttrs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-slate-800">Device-Reported Attributes</h4>
            {isLoading && (
              <svg className="w-4 h-4 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            )}
            {!isLoading && (
              <span className="text-[10px] text-slate-400">{wsConnected ? 'Real-time via WebSocket' : 'Auto-refreshes every 10s'}</span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {liveAttrs.map((attr) => {
              const schema = attrSchema.find(s => s.fieldName === attr.key);
              const displayVal = attr.value === null || attr.value === undefined ? '-'
                : typeof attr.value === 'boolean' ? (attr.value ? 'Yes' : 'No')
                : typeof attr.value === 'object' ? JSON.stringify(attr.value)
                : String(attr.value);
              return (
                <div key={attr.key} className="bg-gradient-to-br from-slate-50 to-white rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{attr.key}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">
                    {displayVal}
                    {schema?.unit && <span className="text-xs font-normal text-slate-400 ml-1">{schema.unit}</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(attr.lastUpdated)}</p>
                  {!schemaKeys.has(attr.key) && (
                    <Badge variant="outline" className="text-[9px] mt-1">device-reported</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Schema-Defined Attributes Table */}
      {attrSchema.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Attribute Schema</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field Name</TableHead>
                <TableHead>Data Type</TableHead>
                <TableHead>Schema Value</TableHead>
                <TableHead>Live Value</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attrSchema.map((attr) => {
                const staticValue = attributes?.[attr.fieldName];
                const live = liveMap[attr.fieldName];
                const constraints = attr.numericConstraints;
                let displayValue: string;

                if (staticValue === undefined || staticValue === null || staticValue === '') {
                  displayValue = '-';
                } else if (attr.dataType === 'BOOLEAN') {
                  displayValue = staticValue ? 'Yes' : 'No';
                } else if (attr.dataType === 'FLOAT' && typeof staticValue === 'number') {
                  const precision = constraints?.resolution
                    ? Math.max(0, -Math.floor(Math.log10(constraints.resolution)))
                    : 2;
                  displayValue = staticValue.toFixed(precision);
                } else {
                  displayValue = String(staticValue);
                }

                const liveDisplay = live
                  ? (live.value === null || live.value === undefined ? '-'
                    : typeof live.value === 'boolean' ? (live.value ? 'Yes' : 'No')
                    : String(live.value))
                  : '-';

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
                    <TableCell className="text-slate-800 font-medium">
                      {live ? liveDisplay : <span className="text-slate-400">-</span>}
                    </TableCell>
                    <TableCell className="text-slate-500">{attr.unit || '-'}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {live ? formatDateTime(live.lastUpdated) : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Extra Device-Reported Attributes (not in schema) */}
      {extraKeys.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Additional Device-Reported Attributes</h4>
          <p className="text-xs text-slate-500 mb-3">These attributes were reported by the device but are not defined in the template schema.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {extraKeys.map((attr) => (
                <TableRow key={attr.key}>
                  <TableCell className="font-medium font-mono text-sm">{attr.key}</TableCell>
                  <TableCell className="text-slate-800">{attr.value === null ? '-' : typeof attr.value === 'object' ? JSON.stringify(attr.value) : String(attr.value)}</TableCell>
                  <TableCell className="text-xs text-slate-400">{formatDateTime(attr.lastUpdated)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Attribute History Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Attribute History</h4>
        {histLoading ? (
          <div className="text-center py-4"><svg className="w-5 h-5 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : (!historyData?.data || historyData.data.length === 0) ? (
          <p className="text-sm text-slate-500">No attribute history in selected time range.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Key</TableHead>
                  <TableHead className="font-semibold text-slate-600">Value</TableHead>
                  <TableHead className="font-semibold text-slate-600">Scope</TableHead>
                  <TableHead className="font-semibold text-slate-600">Updated By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.data.map((row: any, idx: number) => {
                  const val = row.valueJson ?? row.valueBool ?? row.valueNum ?? row.valueStr ?? '-';
                  return (
                    <TableRow key={idx}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.time)}</TableCell>
                      <TableCell className="font-medium text-sm">{row.key}</TableCell>
                      <TableCell className="text-sm">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.scope || '-'}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-500">{row.updatedBy || '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-slate-500">{historyData.total} total records</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-500">Page {historyPage} of {totalHistoryPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {attrSchema.length === 0 && (!liveAttrs || liveAttrs.length === 0) && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No attributes defined for this template and no device-reported attributes received.</p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Attribute Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete attribute history data within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.from).toLocaleString()}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.to).toLocaleString()}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Telemetry Tab
   ═══════════════════════════════════════════════════════════ */
function TelemetryTab({ entityId, template, telemetryConfig, formatDateTime, wsConnected, userRole }: { entityId: string; template: any; telemetryConfig: Record<string, any>; formatDateTime: (v: string | Date) => string; wsConnected?: boolean; userRole?: string }) {
  const telSchema = template?.telemetrySchema as TelemetryDefinition[] | undefined;

  // Time range state
  const [timePreset, setTimePreset] = useState('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteOlderDays, setDeleteOlderDays] = useState(30);
  const [deleting, setDeleting] = useState(false);

  // Calculate from/to based on preset
  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return { from: customFrom || new Date(Date.now() - 86400000).toISOString(), to: customTo || new Date().toISOString() };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  // Fetch live telemetry data
  const { data: liveData, isLoading: liveLoading } = useSWR<Array<{ key: string; valueNum: number | null; valueStr: string | null; valueBool: boolean | null; valueJson: any; lastUpdated: string }>>(
    `/api/telemetry/${entityId}/latest`,
    { refreshInterval: 10000 }
  );

  // Fetch historical telemetry (client-side pagination)
  const { data: historyData, isLoading: histLoading, mutate: mutateHistory } = useSWR<{ data: any[]; meta: any }>(
    `/api/telemetry/${entityId}/timeseries?from=${encodeURIComponent(timeRange.from)}&to=${encodeURIComponent(timeRange.to)}&limit=500`,
    { refreshInterval: 30000 }
  );

  // Build a lookup map for live data
  const liveMap = useMemo(() => {
    const map: Record<string, { value: any; lastUpdated: string }> = {};
    if (liveData) {
      for (const row of liveData) {
        const value = row.valueNum !== null ? row.valueNum
          : row.valueBool !== null ? row.valueBool
          : row.valueStr !== null ? row.valueStr
          : row.valueJson !== null ? JSON.stringify(row.valueJson)
          : null;
        map[row.key] = { value, lastUpdated: row.lastUpdated };
      }
    }
    return map;
  }, [liveData]);

  // Paginate history client-side
  const historyRows = historyData?.data ?? [];
  const totalHistoryPages = Math.max(1, Math.ceil(historyRows.length / HPAGE_SIZE));
  const pagedHistory = historyRows.slice((historyPage - 1) * HPAGE_SIZE, historyPage * HPAGE_SIZE);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', { dataType: 'telemetry', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
      mutateHistory();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {wsConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && (
          <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {['1h', '6h', '24h', '7d', '30d', 'custom'].map(p => (
          <button key={p} onClick={() => { setTimePreset(p); setHistoryPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', timePreset === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="datetime-local" value={customFrom ? customFrom.slice(0, 16) : ''} onChange={e => { setCustomFrom(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
            <span className="text-xs text-slate-400">to</span>
            <input type="datetime-local" value={customTo ? customTo.slice(0, 16) : ''} onChange={e => { setCustomTo(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
          </div>
        )}
      </div>

      {/* Live Telemetry Data */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-800">Live Telemetry Data</h4>
          {liveLoading && (
            <svg className="w-4 h-4 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          )}
          {!liveLoading && liveData && liveData.length > 0 && (
            <span className="text-[10px] text-slate-400">{wsConnected ? 'Real-time via WebSocket' : 'Auto-refreshes every 10s'}</span>
          )}
        </div>
        {(!liveData || liveData.length === 0) && !liveLoading ? (
          <p className="text-sm text-slate-500">No telemetry data received yet. Send data using the code snippets from the Connectivity tab.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {(liveData ?? []).map((row) => {
              const value = row.valueNum !== null ? row.valueNum
                : row.valueBool !== null ? String(row.valueBool)
                : row.valueStr !== null ? row.valueStr
                : row.valueJson !== null ? JSON.stringify(row.valueJson)
                : '-';
              const schema = telSchema?.find(t => t.fieldName === row.key);
              return (
                <div key={row.key} className="bg-gradient-to-br from-slate-50 to-white rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{row.key}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">
                    {typeof value === 'number' ? value.toLocaleString() : value}
                    {schema?.unit && <span className="text-xs font-normal text-slate-400 ml-1">{schema.unit}</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(row.lastUpdated)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Telemetry History Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Telemetry History</h4>
        {histLoading ? (
          <div className="text-center py-4"><svg className="w-5 h-5 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : pagedHistory.length === 0 ? (
          <p className="text-sm text-slate-500">No telemetry data in selected time range.</p>
        ) : (
          <>
            {historyData?.meta?.aggregated && (
              <p className="text-xs text-amber-600 mb-2">Data has been aggregated (interval: {historyData.meta.interval}). Showing averaged values.</p>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Key</TableHead>
                  <TableHead className="font-semibold text-slate-600">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHistory.map((row: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.time || row.bucket)}</TableCell>
                    <TableCell className="font-medium text-sm">{row.key}</TableCell>
                    <TableCell className="text-sm">{row.value_num ?? row.value_str ?? row.value ?? String(row.value_bool ?? '-')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-slate-500">{historyData?.meta?.totalPoints ?? historyRows.length} total points</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-500">Page {historyPage} of {totalHistoryPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Schema Definition */}
      {telSchema && telSchema.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Telemetry Schema</h4>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="font-semibold text-slate-600">Field Name</TableHead>
                <TableHead className="font-semibold text-slate-600">Data Type</TableHead>
                <TableHead className="font-semibold text-slate-600">Unit</TableHead>
                <TableHead className="font-semibold text-slate-600">Description</TableHead>
                <TableHead className="font-semibold text-slate-600">Live Value</TableHead>
                <TableHead className="font-semibold text-slate-600">Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {telSchema.map((tel, idx) => {
                const live = liveMap[tel.fieldName];
                return (
                  <TableRow key={idx}>
                    <TableCell className="font-medium text-slate-800">{tel.fieldName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{tel.dataType}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-500">{tel.unit || '-'}</TableCell>
                    <TableCell className="text-slate-500">{tel.description || '-'}</TableCell>
                    <TableCell className="text-slate-800 font-medium">
                      {live ? (typeof live.value === 'number' ? live.value.toLocaleString() : String(live.value ?? '-')) : <span className="text-slate-400">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {live ? formatDateTime(live.lastUpdated) : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {(!telSchema || telSchema.length === 0) && (!liveData || liveData.length === 0) && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No telemetry points defined for this template and no live data received.</p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Telemetry Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete telemetry data within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.from).toLocaleString()}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.to).toLocaleString()}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Connectivity Tab
   ═══════════════════════════════════════════════════════════ */
function ConnectivityTab({ entityId, entityName, formatDateTime }: { entityId: string; entityName: string; formatDateTime: (v: string | Date) => string }) {
  // Single fetch for status + credential + unsPath + topics
  const { data, isLoading, mutate } = useSWR<{
    connectivity: { status: string; lastActivityAt?: string; lastConnectedAt?: string; lastDisconnectedAt?: string; protocol?: string; sourceIp?: string };
    credential: { token: string; isActive: boolean; createdAt: string; lastUsedAt?: string; allowedIps?: string[]; maxDataRatePerMin?: number; allowedTopics?: string[] } | null;
    unsPath?: string;
    topics?: string[];
  }>(`/api/connectivity/${entityId}`);

  const status = data?.connectivity;
  const credential = data?.credential;
  const topics = data?.topics ?? credential?.allowedTopics ?? [];
  const unsPath = data?.unsPath;

  // Fetch all snippets at once
  const { data: snippetsData, mutate: mutateSnippets } = useSWR<{ snippets: Record<string, string> }>(`/api/connectivity/${entityId}/snippets`);
  const [snippetProto, setSnippetProto] = useState('curl');

  // Test connection
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Token management
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showFullToken, setShowFullToken] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [editTokenValue, setEditTokenValue] = useState('');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ reachable: boolean; tokenStatus: string; protocol?: string; lastActivityAt?: string }>(`/api/connectivity/${entityId}/test`, { ts: Date.now() });
      setTestResult({
        success: res.reachable,
        message: res.reachable
          ? 'Device is online and reachable'
          : `Not reachable \u2014 Token status: ${res.tokenStatus}`,
      });
    } catch {
      setTestResult({ success: false, message: 'Test failed \u2014 could not reach connectivity endpoint' });
    } finally {
      setTesting(false);
    }
  };

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    setNewToken(null);
    try {
      const res = await apiClient.post<{ token: string; createdAt: string }>(`/api/connectivity/${entityId}/token`, {});
      setNewToken(res.token);
      setShowFullToken(true);
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to generate token. Ensure you have ADMIN permissions.' });
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!confirm('Are you sure you want to revoke the device token? The device will no longer be able to connect.')) return;
    setRevoking(true);
    try {
      await apiClient.delete(`/api/connectivity/${entityId}/token`);
      setNewToken(null);
      setShowFullToken(false);
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to revoke token.' });
    } finally {
      setRevoking(false);
    }
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToken = async () => {
    if (!editTokenValue.trim() || editTokenValue.trim().length < 8) return;
    setGeneratingToken(true);
    try {
      const res = await apiClient.post<{ token: string; createdAt: string }>(`/api/connectivity/${entityId}/token`, { customToken: editTokenValue.trim() });
      setNewToken(res.token);
      setShowFullToken(true);
      setEditingToken(false);
      setEditTokenValue('');
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to save custom token.' });
    } finally {
      setGeneratingToken(false);
    }
  };

  const statusColors: Record<string, string> = {
    ONLINE: 'bg-emerald-500',
    OFFLINE: 'bg-red-500',
    UNKNOWN: 'bg-slate-400',
  };

  if (isLoading) return <div className="text-center py-8"><svg className="w-6 h-6 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>;

  const displayToken = newToken ?? credential?.token;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={cn('w-3 h-3 rounded-full', statusColors[status?.status ?? 'UNKNOWN'] ?? 'bg-slate-400')} />
          <span className="font-semibold text-slate-800">{status?.status ?? 'UNKNOWN'}</span>
          {status?.protocol && <Badge variant="outline" className="text-xs">{status.protocol}</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-slate-500">Last Activity:</span><br/>{status?.lastActivityAt ? formatDateTime(status.lastActivityAt) : 'Never'}</div>
          <div><span className="text-slate-500">Source IP:</span><br/>{status?.sourceIp ?? 'N/A'}</div>
          <div><span className="text-slate-500">Last Connected:</span><br/>{status?.lastConnectedAt ? formatDateTime(status.lastConnectedAt) : 'Never'}</div>
          <div><span className="text-slate-500">Last Disconnected:</span><br/>{status?.lastDisconnectedAt ? formatDateTime(status.lastDisconnectedAt) : 'Never'}</div>
        </div>
      </div>

      {/* Device Credentials + Token Management Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Device Credentials</h4>
        {credential ? (
          <div className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Access Token:</span>
                <div className="flex items-center gap-2 flex-1">
                  {editingToken ? (
                    <>
                      <input
                        type="text"
                        value={editTokenValue}
                        onChange={(e) => setEditTokenValue(e.target.value)}
                        className="bg-white border border-slate-300 px-2 py-1 rounded text-xs font-mono flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Enter custom token (min 8 chars)"
                      />
                      <button
                        onClick={handleSaveToken}
                        disabled={editTokenValue.trim().length < 8 || generatingToken}
                        className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
                      >
                        {generatingToken ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingToken(false); setEditTokenValue(''); }}
                        className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <code className="bg-slate-100 px-2 py-1 rounded text-xs font-mono flex-1 truncate">
                        {showFullToken && displayToken
                          ? displayToken
                          : displayToken
                            ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + displayToken.slice(-6)
                            : 'N/A'}
                      </code>
                      {displayToken && (
                        <>
                          <button
                            onClick={() => setShowFullToken(!showFullToken)}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title={showFullToken ? 'Hide token' : 'Show full token'}
                          >
                            {showFullToken ? 'Hide' : 'Show'}
                          </button>
                          <button
                            onClick={() => handleCopyToken(displayToken)}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title="Copy token"
                          >
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            onClick={() => { setEditingToken(true); setEditTokenValue(displayToken); }}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title="Edit token"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Status:</span>
                <Badge variant={credential.isActive ? 'default' : 'secondary'} className="text-xs">{credential.isActive ? 'ACTIVE' : 'REVOKED'}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Rate Limit:</span>
                <span>{credential.maxDataRatePerMin ?? 600} msg/min</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Created:</span>
                <span>{credential.createdAt ? formatDateTime(credential.createdAt) : 'N/A'}</span>
              </div>
            </div>
            {newToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>New token generated.</strong> Copy it now — it won't be shown in full again.
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={handleGenerateToken} disabled={generatingToken} size="sm" variant="outline">
                {generatingToken ? 'Generating...' : 'Regenerate Token'}
              </Button>
              {credential.isActive && (
                <Button onClick={handleRevokeToken} disabled={revoking} size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                  {revoking ? 'Revoking...' : 'Revoke Token'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">No device credentials configured. Generate a token to enable device connectivity.</p>
            <Button onClick={handleGenerateToken} disabled={generatingToken} size="sm" className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
              {generatingToken ? 'Generating...' : 'Generate Token'}
            </Button>
            {newToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Token generated!</strong> Copy it now — it won't be shown in full again.
                <div className="mt-2 flex items-center gap-2">
                  <code className="bg-white px-2 py-1 rounded text-xs font-mono flex-1 break-all border">{newToken}</code>
                  <button
                    onClick={() => handleCopyToken(newToken)}
                    className="px-3 py-1 text-xs rounded bg-amber-200 hover:bg-amber-300 text-amber-900 whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* UNS Topics Card */}
      {topics.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">MQTT Topics</h4>
          {unsPath && (
            <div className="mb-3 text-sm">
              <span className="text-slate-500">UNS Path:</span>{' '}
              <code className="bg-slate-100 px-2 py-0.5 rounded text-xs font-mono">{unsPath}</code>
            </div>
          )}
          <div className="space-y-1.5">
            {topics.map((topic: string, idx: number) => {
              const suffix = topic.split('/').pop() ?? '';
              const purposeMap: Record<string, string> = {
                telemetry: 'Send sensor/measurement data',
                attributes: 'Send device attributes & metadata',
                events: 'Send device events & alerts',
                'rpc/request': 'Receive RPC commands from server',
                'rpc/response': 'Send RPC command responses',
              };
              const topicSuffix = topic.includes('/rpc/') ? topic.split('/').slice(-2).join('/') : suffix;
              return (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                  <code className="text-xs font-mono text-slate-700 flex-1">{topic}</code>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">{purposeMap[topicSuffix] ?? ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Test Connection */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Test Connection</h4>
        <Button onClick={handleTest} disabled={testing} className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
          {testing ? 'Testing...' : 'Test Connection'}
        </Button>
        {testResult && (
          <div className={cn('mt-3 p-3 rounded-lg text-sm', testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Code Snippets */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Code Snippets</h4>
        <div className="flex gap-2 mb-3">
          {['curl', 'python', 'nodejs', 'arduino'].map(p => (
            <button key={p} onClick={() => setSnippetProto(p)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', snippetProto === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {p}
            </button>
          ))}
        </div>
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs overflow-x-auto max-h-64">
          {snippetsData?.snippets?.[snippetProto] ?? 'Loading...'}
        </pre>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Alarms Tab
   ═══════════════════════════════════════════════════════════ */
function AlarmsTab({ entityId, formatDateTime }: { entityId: string; formatDateTime: (v: string | Date) => string }) {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');

  // Time range state
  const [timePreset, setTimePreset] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [alarmPage, setAlarmPage] = useState(1);

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Calculate from/to (empty = all time)
  const timeRange = useMemo(() => {
    if (!timePreset || timePreset === 'all') return { from: '', to: '' };
    if (timePreset === 'custom') {
      return { from: customFrom || '', to: customTo || '' };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  const params = new URLSearchParams({ entityId, page: String(alarmPage), pageSize: '20' });
  if (statusFilter) params.set('status', statusFilter);
  if (timeRange.from) params.set('from', timeRange.from);
  if (timeRange.to) params.set('to', timeRange.to);

  const { data, isLoading, mutate: mutateAlarms } = useSWR<{ data: any[]; total: number; totalPages?: number }>(`/api/alarms?${params}`);
  const alarms = data?.data ?? [];
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  const severityColors: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700 border-red-200',
    MAJOR: 'bg-orange-100 text-orange-700 border-orange-200',
    MINOR: 'bg-amber-100 text-amber-700 border-amber-200',
    WARNING: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    INFO: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  const statusBadgeColors: Record<string, string> = {
    ACTIVE: 'bg-red-100 text-red-700',
    ACKNOWLEDGED: 'bg-amber-100 text-amber-700',
    CLEARED: 'bg-emerald-100 text-emerald-700',
  };

  const handleDeleteAlarms = async () => {
    if (!timeRange.from || !timeRange.to) {
      alert('Please select a time range first (not All Time).');
      return;
    }
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', { dataType: 'alarms', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
      mutateAlarms();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) return <div className="text-center py-8"><svg className="w-6 h-6 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>;

  return (
    <div>
      {/* Controls Row */}
      <div className="flex items-center justify-between mb-4">
        <div />
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && timeRange.from && timeRange.to && (
          <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {['all', '1h', '6h', '24h', '7d', '30d', 'custom'].map(p => (
          <button key={p} onClick={() => { setTimePreset(p); setAlarmPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', (timePreset || 'all') === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {p === 'all' ? 'All Time' : p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="datetime-local" value={customFrom ? customFrom.slice(0, 16) : ''} onChange={e => { setCustomFrom(new Date(e.target.value).toISOString()); setAlarmPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
            <span className="text-xs text-slate-400">to</span>
            <input type="datetime-local" value={customTo ? customTo.slice(0, 16) : ''} onChange={e => { setCustomTo(new Date(e.target.value).toISOString()); setAlarmPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
          </div>
        )}
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2 mb-4">
        {['', 'ACTIVE', 'ACKNOWLEDGED', 'CLEARED'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setAlarmPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', statusFilter === s ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {alarms.length === 0 ? (
        <div className="text-center py-8"><p className="text-sm text-slate-500">No alarms found for this entity.</p></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alarms.map((alarm: any) => (
              <TableRow key={alarm.id}>
                <TableCell><Badge className={cn('text-xs border', severityColors[alarm.severity] ?? '')}>{alarm.severity}</Badge></TableCell>
                <TableCell className="text-sm font-medium">{alarm.alarmType}</TableCell>
                <TableCell><Badge className={cn('text-xs', statusBadgeColors[alarm.status] ?? '')}>{alarm.status}</Badge></TableCell>
                <TableCell className="text-sm whitespace-nowrap">{formatDateTime(alarm.createdAt)}</TableCell>
                <TableCell className="text-xs text-slate-500 max-w-xs truncate">{alarm.triggerDetails ? JSON.stringify(alarm.triggerDetails).substring(0, 80) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-slate-500">Showing {alarms.length} of {data.total} alarms</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setAlarmPage(p => Math.max(1, p - 1))} disabled={alarmPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
            <span className="text-xs text-slate-500">Page {alarmPage} of {totalPages}</span>
            <button onClick={() => setAlarmPage(p => Math.min(totalPages, p + 1))} disabled={alarmPage >= totalPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Alarm Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete alarms within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.from).toLocaleString()}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.to).toLocaleString()}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDeleteAlarms} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Checklist History Tab (time range, table, pagination, delete)
   ═══════════════════════════════════════════════════════════ */
function ChecklistHistoryTab({ entityId, formatDateTime, userRole, checklistSchema }: { entityId: string; formatDateTime: (v: string | Date) => string; userRole?: string; checklistSchema?: any }) {
  const [timePreset, setTimePreset] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const questionMap = useMemo(() => {
    const map: Record<string, string> = {};
    const questions = Array.isArray(checklistSchema) ? checklistSchema : checklistSchema?.questions ?? [];
    questions.forEach((q: any, idx: number) => {
      const id = q.id || `q_${idx}`;
      map[id] = q.question || q.label || `Question ${idx + 1}`;
    });
    return map;
  }, [checklistSchema]);

  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return {
        from: customFrom || new Date(Date.now() - 86400000).toISOString(),
        to: customTo || new Date().toISOString(),
      };
    }
    const now = new Date();
    const ms: Record<string, number> = {
      '1h': 3600000,
      '6h': 21600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000,
    };
    return {
      from: new Date(now.getTime() - (ms[timePreset] || 604800000)).toISOString(),
      to: now.toISOString(),
    };
  }, [timePreset, customFrom, customTo]);

  const { data: historyData, isLoading, mutate } = useSWR<{ data: any[]; meta: any }>(
    `/api/checklist/${entityId}/history?from=${encodeURIComponent(timeRange.from)}&to=${encodeURIComponent(timeRange.to)}&limit=500`,
    { refreshInterval: 30000 }
  );

  const historyRows = historyData?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(historyRows.length / HPAGE_SIZE));
  const pagedRows = historyRows.slice(
    (historyPage - 1) * HPAGE_SIZE,
    historyPage * HPAGE_SIZE
  );

  const stepColors: Record<string, string> = {
    SUBMITTED: 'bg-blue-100 text-blue-700',
    CHECKED: 'bg-amber-100 text-amber-700',
    VERIFIED: 'bg-emerald-100 text-emerald-700',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700',
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', {
        dataType: 'checklists',
        from: timeRange.from,
        to: timeRange.to,
        entityId,
        confirmed: true,
      });
      mutate();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-800">Checklist Submissions</h3>
        {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && historyRows.length > 0 && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {['1h', '6h', '24h', '7d', '30d', 'custom'].map((p) => (
          <button
            key={p}
            onClick={() => { setTimePreset(p); setHistoryPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              timePreset === p
                ? 'bg-cyan-100 text-cyan-700'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="datetime-local"
              value={customFrom ? customFrom.slice(0, 16) : ''}
              onChange={(e) => {
                setCustomFrom(new Date(e.target.value).toISOString());
                setHistoryPage(1);
              }}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="datetime-local"
              value={customTo ? customTo.slice(0, 16) : ''}
              onChange={(e) => {
                setCustomTo(new Date(e.target.value).toISOString());
                setHistoryPage(1);
              }}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-2 text-sm text-slate-500">Loading history...</span>
        </div>
      ) : pagedRows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">
          No checklist submissions in selected time range.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Submitted By</TableHead>
                  <TableHead className="font-semibold text-slate-600">Status</TableHead>
                  <TableHead className="font-semibold text-slate-600">Answers</TableHead>
                  <TableHead className="font-semibold text-slate-600">ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((row: any) => (
                  <React.Fragment key={row.checklistId}>
                    <TableRow
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpandedRow(expandedRow === row.checklistId ? null : row.checklistId)}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateTime(row.time)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.submittedBy}</TableCell>
                      <TableCell>
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          stepColors[row.currentStep] ?? 'bg-slate-100 text-slate-700'
                        )}>
                          {row.currentStep}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {row.answersCount} items
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">
                        {(row.checklistId || '').substring(0, 8)}
                      </TableCell>
                    </TableRow>
                    {expandedRow === row.checklistId && row.answers && (
                      <TableRow key={`${row.checklistId}-detail`}>
                        <TableCell colSpan={5} className="bg-slate-50 p-3">
                          <div className="space-y-2">
                            {Object.entries(row.answers).map(([key, val]: [string, any]) => (
                              <div key={key} className="flex items-start gap-2 text-xs">
                                <span className="font-medium text-slate-600 shrink-0 max-w-[60%]">{questionMap[key] || key}:</span>
                                <span className="text-slate-800">
                                  {typeof val === 'string' && val.startsWith('data:image/')
                                    ? <img src={val} className="w-20 h-20 object-cover rounded border border-slate-200" alt="Photo" />
                                    : typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {historyData?.meta?.totalPoints ?? historyRows.length} total submissions
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                disabled={historyPage <= 1}
                className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-slate-500">
                Page {historyPage} of {totalPages}
              </span>
              <button
                onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                disabled={historyPage >= totalPages}
                className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-96 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Checklist Data</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete checklist submissions and their review
              records within the selected time range. This action cannot be undone.
            </p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 font-medium w-12">From:</span>
                <span className="text-slate-700 font-mono text-xs">
                  {new Date(timeRange.from).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 font-medium w-12">To:</span>
                <span className="text-slate-700 font-mono text-xs">
                  {new Date(timeRange.to).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   QR Code Tab
   ═══════════════════════════════════════════════════════════ */
function QrCodeTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  const [size, setSize] = useState(200);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const { data: existing } = useSWR<{ id?: string; qrData?: string }>(`/api/qr/${entityId}`);
  const qrUrl = `${window.location.origin}/checklist/${entityId}`;
  const svgRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await apiClient.post(`/api/qr/${entityId}/generate`, { size: size >= 300 ? 'LARGE' : size >= 200 ? 'MEDIUM' : 'SMALL', includeLabel: true });
      setGenerated(true);
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const handleDownloadSVG = () => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityName}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPNG = () => {
    const svgEl = svgRef.current?.querySelector('svg');
    if (!svgEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    const svgData = new XMLSerializer().serializeToString(svgEl);
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${entityName}-qr.png`;
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <h4 className="font-semibold text-slate-800 mb-4">QR Code for {entityName}</h4>
        <p className="text-sm text-slate-500 mb-4">Scan this QR code to open the checklist for this entity.</p>
        <div ref={svgRef} className="inline-block p-4 bg-white rounded-xl border-2 border-slate-100 shadow-sm">
          <QRCodeSVG value={qrUrl} size={size} level="M" includeMargin />
        </div>
        <p className="text-xs text-slate-400 mt-3 font-mono break-all">{qrUrl}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Options</h4>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-slate-600">Size:</label>
          {[150, 200, 300].map(s => (
            <button key={s} onClick={() => setSize(s)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium', size === s ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {s}px
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Button onClick={handleDownloadPNG} className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm">
            Download PNG
          </Button>
          <Button onClick={handleDownloadSVG} variant="outline" className="text-sm">
            Download SVG
          </Button>
          {!existing?.id && !generated && (
            <Button onClick={handleGenerate} disabled={generating} variant="outline" className="text-sm">
              {generating ? 'Saving...' : 'Save to Entity'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
