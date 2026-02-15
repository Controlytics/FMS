import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface OverviewTabProps {
  nodeId: string;
  node: any;
}

export function OverviewTab({ nodeId, node }: OverviewTabProps) {
  const { data: alarmEvents } = useSWR(`/api/alarms/events/node/${nodeId}`);
  const { data: schedules } = useSWR(`/api/schedules/node/${nodeId}`);
  const { data: checklists } = useSWR(`/api/checklists/nodes/${nodeId}`);

  const activeAlarms = (alarmEvents ?? []).filter((e: any) => e.status === 'OPEN').length;
  const overdueSchedules = (schedules ?? []).filter((s: any) => s.nextDueAt && new Date(s.nextDueAt) < new Date() && s.status === 'active').length;
  const totalChecklists = (checklists ?? []).length;

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{node.status}</div>
            <p className="text-xs text-muted-foreground">Status</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{totalChecklists}</div>
            <p className="text-xs text-muted-foreground">Checklists</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className={`text-2xl font-bold ${activeAlarms > 0 ? 'text-destructive' : ''}`}>{activeAlarms}</div>
            <p className="text-xs text-muted-foreground">Active Alarms</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className={`text-2xl font-bold ${overdueSchedules > 0 ? 'text-destructive' : ''}`}>{overdueSchedules}</div>
            <p className="text-xs text-muted-foreground">Overdue Tasks</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Alarms */}
      {activeAlarms > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">Active Alarms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(alarmEvents ?? []).filter((e: any) => e.status === 'OPEN').slice(0, 5).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span>{e.alarmRule?.name ?? 'Alarm'}</span>
                <Badge variant={e.severity === 'CRITICAL' ? 'destructive' : 'warning'}>{e.severity}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Attributes quick view */}
      {node.attributes && Object.keys(node.attributes).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Key Attributes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {Object.entries(node.attributes as Record<string, unknown>).slice(0, 9).map(([key, val]) => (
                <div key={key}>
                  <span className="text-muted-foreground">{key}:</span>{' '}
                  <span className="font-medium">{String(val)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Identifiers */}
      {node.identifiers?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Physical Identifiers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {node.identifiers.map((id: any) => (
                <Badge key={id.id} variant="outline">{id.type}: {id.value}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
