import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@digilog/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OverviewTab } from '@/components/assets/tabs/overview-tab';
import { AttributesTab } from '@/components/assets/tabs/attributes-tab';
import { RelationshipsTab } from '@/components/assets/tabs/relationships-tab';
import { ChecklistsTab } from '@/components/assets/tabs/checklists-tab';
import { ScheduleTab } from '@/components/assets/tabs/schedule-tab';
import { AlarmsTab } from '@/components/assets/tabs/alarms-tab';
import { AuditTab } from '@/components/assets/tabs/audit-tab';

const TABS = [
  'Overview', 'Attributes', 'Telemetry', 'Relationships',
  'Checklists', 'Schedule', 'Alarms', 'Audit',
] as const;
type TabName = (typeof TABS)[number];

export function AssetDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabName>('Overview');

  const { data: node } = useSWR(id ? `/api/hierarchy/${id}` : null);
  const { data: ancestors } = useSWR(id ? `/api/hierarchy/${id}/ancestors` : null);

  const canEdit = !!(user?.role && ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.includes(PERMISSIONS.NODE_UPDATE));

  if (!node) return <div className="text-muted-foreground p-6">Loading asset...</div>;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/assets" className="text-primary hover:underline">Assets</Link>
        {ancestors?.map((a: any) => (
          <span key={a.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <Link to={`/assets/${a.id}`} className="text-primary hover:underline">{a.name}</Link>
          </span>
        ))}
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{node.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{node.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">{node.nodeType}</Badge>
            <Badge variant={node.status === 'active' ? 'success' : 'outline'}>{node.status}</Badge>
            {node.template && <Badge variant="secondary">{node.template.name}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {node.identifiers?.map((id: any) => (
            <Badge key={id.id} variant="outline">{id.type}: {id.value}</Badge>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'Overview' && <OverviewTab nodeId={id!} node={node} />}
        {activeTab === 'Attributes' && <AttributesTab nodeId={id!} node={node} canEdit={canEdit} />}
        {activeTab === 'Telemetry' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Telemetry data visualization will be available in a future phase.</p>
            {node.template?.telemetrySchema && (
              <div className="text-sm">
                <p className="font-medium">Configured telemetry points:</p>
                <ul className="list-disc list-inside mt-1">
                  {(node.template.telemetrySchema as Array<{ name: string; unit?: string; dataType: string }>).map((t, i) => (
                    <li key={i}>{t.name} ({t.dataType}{t.unit ? `, ${t.unit}` : ''})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {activeTab === 'Relationships' && <RelationshipsTab nodeId={id!} canEdit={canEdit} />}
        {activeTab === 'Checklists' && <ChecklistsTab nodeId={id!} canEdit={canEdit} />}
        {activeTab === 'Schedule' && <ScheduleTab nodeId={id!} />}
        {activeTab === 'Alarms' && <AlarmsTab nodeId={id!} canEdit={canEdit} />}
        {activeTab === 'Audit' && <AuditTab nodeId={id!} />}
      </div>
    </div>
  );
}
