import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// ── Types ──────────────────────────────────────────────────────────────────

interface UnsTreeNode {
  name: string;
  level: string;
  path: string;
  entityId?: string;
  children?: UnsTreeNode[];
}

interface UnsEntityDetail {
  entityId: string;
  entityName: string;
  templateName?: string;
  unsPath: string;
  pathOverride?: string;
  level: string;
  attributes?: Record<string, unknown>;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Level badge colors ─────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  Enterprise: 'bg-purple-100 text-purple-700',
  Site: 'bg-blue-100 text-blue-700',
  Area: 'bg-cyan-100 text-cyan-700',
  Line: 'bg-teal-100 text-teal-700',
  Cell: 'bg-emerald-100 text-emerald-700',
  Entity: 'bg-amber-100 text-amber-700',
};

function getLevelColor(level: string): string {
  return LEVEL_COLORS[level] ?? 'bg-slate-100 text-slate-600';
}

// ── Recursive tree component ───────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  selectedEntityId,
  onSelectEntity,
}: {
  node: UnsTreeNode;
  depth: number;
  selectedEntityId: string | null;
  onSelectEntity: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isLeaf = !!node.entityId;
  const isSelected = isLeaf && node.entityId === selectedEntityId;

  return (
    <div>
      <div
        className={`
          flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer text-sm
          transition-colors duration-150
          ${isSelected ? 'bg-violet-50 ring-1 ring-violet-300' : 'hover:bg-slate-50'}
        `}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (hasChildren) setExpanded((e) => !e);
          if (isLeaf && node.entityId) onSelectEntity(node.entityId);
        }}
      >
        {/* Expand / collapse indicator */}
        {hasChildren ? (
          <svg
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Leaf icon vs folder icon */}
        {isLeaf ? (
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        )}

        {/* Name */}
        <span className={`truncate ${isSelected ? 'font-semibold text-violet-700' : 'text-slate-700'}`}>
          {node.name}
        </span>

        {/* Level badge */}
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${getLevelColor(node.level)}`}>
          {node.level}
        </span>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function UnsConfigPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const reauth = useReauth();
  const { formatDate } = useDatetimeFormat();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Tree data
  const { data: treeData, isLoading: treeLoading } = useSWR<UnsTreeNode[]>('/api/uns/tree', { revalidateOnMount: true, dedupingInterval: 0 });

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSubmitted, setSearchSubmitted] = useState('');
  const { data: searchResults, isLoading: searchLoading } = useSWR<UnsTreeNode[]>(
    searchSubmitted ? `/api/uns/search?path=${encodeURIComponent(searchSubmitted)}` : null,
  );

  // Selected entity detail
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const { data: entityDetail, mutate: mutateDetail } = useSWR<UnsEntityDetail>(
    selectedEntityId ? `/api/uns/entity/${selectedEntityId}` : null,
  );

  // Path override form
  const [pathOverride, setPathOverride] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);

  // When entity detail loads, populate override field
  useMemo(() => {
    if (entityDetail) {
      setPathOverride(entityDetail.pathOverride ?? entityDetail.unsPath);
    }
  }, [entityDetail]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearchSubmitted(searchQuery.trim());
    },
    [searchQuery],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchSubmitted('');
  }, []);

  const handleSelectEntity = useCallback((entityId: string) => {
    setSelectedEntityId(entityId);
  }, []);

  const handleSaveOverride = useCallback(async () => {
    if (!selectedEntityId || !pathOverride.trim()) return;
    setOverrideSaving(true);

    await reauth.execute(
      'UPDATE_UNS_PATH',
      async (password?) => {
        if (password) {
          await apiClient.putWithReauth(`/api/uns/entity/${selectedEntityId}`, { pathOverride: pathOverride.trim() }, password);
        } else {
          await apiClient.put(`/api/uns/entity/${selectedEntityId}`, { pathOverride: pathOverride.trim() });
        }
        mutateDetail();
        toast.success('Path Override Saved', 'UNS path override updated successfully.');
      },
      {
        onError: (err: any) => {
          toast.error('Save Failed', err?.message ?? 'Failed to save path override.');
        },
      },
    );

    setOverrideSaving(false);
  }, [selectedEntityId, pathOverride, reauth, mutateDetail, toast]);

  // Determine which nodes to display
  const displayNodes = searchSubmitted && searchResults ? searchResults : treeData ?? [];
  const isSearchMode = !!searchSubmitted;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/config')} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
          <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/25">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Unified Namespace (UNS)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Browse and manage MQTT topic paths for entities
          </p>
        </div>
      </div>

      {/* UNS Info Card */}
      <Card className="p-5 border-slate-200/60">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200/50">
            <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-800">ISA-95 Namespace Configuration</h3>
            <p className="text-xs text-slate-500 mt-1">Topic paths are auto-generated based on entity hierarchy following ISA-95 levels.</p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Prefix</span>
                <p className="text-sm font-mono text-slate-800 mt-0.5">digilog/v1</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Separator</span>
                <p className="text-sm font-mono text-slate-800 mt-0.5">/</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Levels</span>
                <p className="text-sm text-slate-800 mt-0.5">Enterprise &rarr; Site &rarr; Area &rarr; Line &rarr; Cell</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Wildcards</span>
                <p className="text-sm font-mono text-slate-800 mt-0.5">+ (single) &nbsp; # (multi)</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-[10px] text-slate-500">Topic suffixes:</span>
              {['/telemetry', '/attributes', '/rpc', '/events', '/alarms', '/binary'].map(s => (
                <span key={s} className="px-2 py-0.5 text-[10px] font-mono bg-teal-50 text-teal-700 border border-teal-200 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: Search + Tree */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search bar */}
          <Card className="p-4">
            <form onSubmit={handleSearch} className="flex gap-3">
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search MQTT paths — use wildcards: Enterprise/Site/+/Line/#"
                  className="pl-10"
                />
              </div>
              <Button type="submit" disabled={!searchQuery.trim()}>
                Search
              </Button>
              {isSearchMode && (
                <Button type="button" variant="outline" onClick={handleClearSearch}>
                  Clear
                </Button>
              )}
            </form>
            {isSearchMode && (
              <p className="text-xs text-slate-500 mt-2">
                Showing results for: <span className="font-mono font-medium text-slate-700">{searchSubmitted}</span>
                {searchResults && <span className="ml-2">({searchResults.length} matches)</span>}
              </p>
            )}
          </Card>

          {/* Tree */}
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              {isSearchMode ? 'Search Results' : 'Namespace Tree'}
            </h2>

            {treeLoading || searchLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading namespace...
              </div>
            ) : displayNodes.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <svg className="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-sm font-medium">
                  {isSearchMode ? 'No matching paths found' : 'No namespace data available'}
                </p>
                <p className="text-xs mt-1">
                  {isSearchMode
                    ? 'Try a different search pattern using + (single level) or # (multi level) wildcards'
                    : 'Items will appear here once created'}
                </p>
              </div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto -mx-2">
                {displayNodes.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedEntityId={selectedEntityId}
                    onSelectEntity={handleSelectEntity}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right panel: Entity detail */}
        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Entity Details
            </h2>

            {!selectedEntityId ? (
              <div className="text-center py-8 text-slate-400">
                <svg className="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
                <p className="text-sm font-medium">Select a leaf node</p>
                <p className="text-xs mt-1">Click an entity in the tree to view its UNS details</p>
              </div>
            ) : !entityDetail ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading details...
              </div>
            ) : (
              <div className="space-y-4">
                {/* Entity name */}
                <div>
                  <span className="text-xs text-slate-500 uppercase tracking-wide">Entity</span>
                  <p className="text-lg font-semibold text-slate-800">{entityDetail.entityName}</p>
                </div>

                {/* Template */}
                {entityDetail.templateName && (
                  <div>
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Template</span>
                    <p className="text-sm text-slate-700">{entityDetail.templateName}</p>
                  </div>
                )}

                {/* Level */}
                <div>
                  <span className="text-xs text-slate-500 uppercase tracking-wide">Level</span>
                  <p className="mt-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getLevelColor(entityDetail.level)}`}>
                      {entityDetail.level}
                    </span>
                  </p>
                </div>

                {/* Status */}
                {entityDetail.status && (
                  <div>
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Status</span>
                    <p className="text-sm text-slate-700 mt-0.5">{entityDetail.status}</p>
                  </div>
                )}

                {/* UNS Path */}
                <div>
                  <span className="text-xs text-slate-500 uppercase tracking-wide">UNS Path</span>
                  <div className="mt-1 px-3 py-2 bg-slate-50 rounded-lg font-mono text-sm text-slate-700 break-all">
                    {entityDetail.unsPath}
                  </div>
                </div>

                {/* Path override (read-only for non-SUPER_ADMIN) */}
                {entityDetail.pathOverride && entityDetail.pathOverride !== entityDetail.unsPath && (
                  <div>
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Path Override</span>
                    <div className="mt-1 px-3 py-2 bg-violet-50 rounded-lg font-mono text-sm text-violet-700 break-all">
                      {entityDetail.pathOverride}
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                  {entityDetail.createdAt && (
                    <div>
                      <span className="text-xs text-slate-500">Created</span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {formatDate(entityDetail.createdAt)}
                      </p>
                    </div>
                  )}
                  {entityDetail.updatedAt && (
                    <div>
                      <span className="text-xs text-slate-500">Updated</span>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {formatDate(entityDetail.updatedAt)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Attributes preview */}
                {entityDetail.attributes && Object.keys(entityDetail.attributes).length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Attributes</span>
                    <div className="mt-2 space-y-1">
                      {Object.entries(entityDetail.attributes).map(([key, value]) => (
                        <div key={key} className="flex justify-between py-1 text-sm">
                          <span className="text-slate-500">{key}</span>
                          <span className="text-slate-700 font-medium truncate max-w-[60%] text-right">
                            {String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Path override card (SUPER_ADMIN only) */}
          {isSuperAdmin && selectedEntityId && entityDetail && (
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Override UNS Path
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Custom Path</label>
                  <Input
                    type="text"
                    value={pathOverride}
                    onChange={(e) => setPathOverride(e.target.value)}
                    placeholder="Enterprise/Site/Area/Line/Cell/Entity"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Override the auto-generated UNS topic path for this entity.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPathOverride(entityDetail.unsPath)}
                    disabled={pathOverride === entityDetail.unsPath}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveOverride}
                    disabled={overrideSaving || !pathOverride.trim()}
                  >
                    {overrideSaving ? 'Saving...' : 'Save Override'}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Reauth dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update UNS Path Override"
      />
    </div>
  );
}
