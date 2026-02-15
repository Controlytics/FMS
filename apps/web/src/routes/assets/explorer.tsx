import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@digilog/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AssetTree } from '@/components/assets/asset-tree';
import { LinkDialog } from '@/components/assets/link-dialog';
import { OverviewTab } from '@/components/assets/tabs/overview-tab';
import { AttributesTab } from '@/components/assets/tabs/attributes-tab';
import { RelationshipsTab } from '@/components/assets/tabs/relationships-tab';
import { ChecklistsTab } from '@/components/assets/tabs/checklists-tab';
import { ScheduleTab } from '@/components/assets/tabs/schedule-tab';
import { AlarmsTab } from '@/components/assets/tabs/alarms-tab';
import { AuditTab } from '@/components/assets/tabs/audit-tab';

const TABS = ['Overview', 'Attributes', 'Telemetry', 'Relationships', 'Checklists', 'Schedule', 'Alarms', 'Audit'] as const;
type TabName = (typeof TABS)[number];

export function ExplorerPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('selected') ?? undefined;
  const [activeTab, setActiveTab] = useState<TabName>('Overview');
  const [search, setSearch] = useState('');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const { data: selectedNode } = useSWR(selectedId ? `/api/hierarchy/${selectedId}` : null);

  const canCreate = !!(user?.role && ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.includes(PERMISSIONS.NODE_CREATE));
  const canEdit = !!(user?.role && ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.includes(PERMISSIONS.NODE_UPDATE));

  const handleSelect = (id: string) => {
    setSearchParams({ selected: id });
    setActiveTab('Overview');
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Left panel: Tree */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-border pr-4">
        <div className="space-y-2 mb-3">
          <Input placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} className="h-8" />
          <div className="flex gap-1">
            {canCreate && (
              <>
                <Link to="/assets/node/create">
                  <Button size="sm" className="h-7 text-xs">+ Add</Button>
                </Link>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLinkDialogOpen(true)}>+ Link</Button>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AssetTree selectedId={selectedId} onSelect={handleSelect} />
        </div>
      </div>

      {/* Right panel: Detail */}
      <div className="flex-1 overflow-y-auto">
        {selectedNode ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{selectedNode.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">{selectedNode.nodeType}</Badge>
                  <Badge variant={selectedNode.status === 'active' ? 'success' : 'outline'}>{selectedNode.status}</Badge>
                  {selectedNode.template && <Badge variant="secondary">{selectedNode.template.name}</Badge>}
                  <span className="text-xs text-muted-foreground">{selectedNode.unsPath}</span>
                </div>
              </div>
              <Link to={`/assets/${selectedId}`}>
                <Button variant="outline" size="sm">Full Detail</Button>
              </Link>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border">
              {TABS.map(tab => (
                <button
                  key={tab}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div>
              {activeTab === 'Overview' && <OverviewTab nodeId={selectedId!} node={selectedNode} />}
              {activeTab === 'Attributes' && <AttributesTab nodeId={selectedId!} node={selectedNode} canEdit={canEdit} />}
              {activeTab === 'Telemetry' && (
                <p className="text-sm text-muted-foreground">Telemetry data visualization (future phase).</p>
              )}
              {activeTab === 'Relationships' && <RelationshipsTab nodeId={selectedId!} canEdit={canEdit} />}
              {activeTab === 'Checklists' && <ChecklistsTab nodeId={selectedId!} canEdit={canEdit} />}
              {activeTab === 'Schedule' && <ScheduleTab nodeId={selectedId!} />}
              {activeTab === 'Alarms' && <AlarmsTab nodeId={selectedId!} canEdit={canEdit} />}
              {activeTab === 'Audit' && <AuditTab nodeId={selectedId!} />}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <div className="text-4xl mb-4">&#x1f3ed;</div>
              <p className="text-lg font-medium">Select an asset from the tree</p>
              <p className="text-sm">Click on any asset in the left panel to view its details</p>
            </div>
          </div>
        )}
      </div>

      <LinkDialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} />
    </div>
  );
}
