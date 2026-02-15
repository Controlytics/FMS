import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { AlarmRuleBuilder } from '@/components/assets/alarm-rule-builder';

interface AlarmsTabProps {
  nodeId: string;
  canEdit: boolean;
}

export function AlarmsTab({ nodeId, canEdit }: AlarmsTabProps) {
  const { data: rules } = useSWR(`/api/alarms/rules/node/${nodeId}`);
  const { data: events } = useSWR(`/api/alarms/events/node/${nodeId}`);
  const [builderOpen, setBuilderOpen] = useState(false);

  const handleAcknowledge = async (eventId: string) => {
    await apiClient.post(`/api/alarms/events/${eventId}/acknowledge`, {});
    mutate(`/api/alarms/events/node/${nodeId}`);
  };

  const handleClose = async (eventId: string) => {
    await apiClient.post(`/api/alarms/events/${eventId}/close`, {});
    mutate(`/api/alarms/events/node/${nodeId}`);
  };

  const severityColors: Record<string, string> = {
    INFO: 'outline', WARNING: 'warning', ALARM: 'destructive', CRITICAL: 'destructive',
  };

  return (
    <div className="space-y-4">
      {/* Alarm Rules */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Alarm Rules ({(rules ?? []).length})</h3>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}>+ Add Rule</Button>}
      </div>

      {(rules ?? []).length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rules ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell><Badge variant="outline">{r.ruleType}</Badge></TableCell>
                <TableCell><Badge variant={r.enabled ? 'success' : 'outline'}>{r.enabled ? 'Active' : 'Disabled'}</Badge></TableCell>
                <TableCell>{r._count?.events ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Alarm Events */}
      <h3 className="text-sm font-semibold">Alarm Events ({(events ?? []).length})</h3>

      {(events ?? []).length > 0 ? (
        <div className="space-y-2">
          {(events ?? []).map((e: any) => (
            <Card key={e.id} className={e.status === 'OPEN' ? 'border-destructive' : ''}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={(severityColors[e.severity] ?? 'outline') as any}>{e.severity}</Badge>
                    <span className="text-sm font-medium">{e.alarmRule?.name ?? 'Alarm'}</span>
                    <Badge variant={e.status === 'OPEN' ? 'destructive' : e.status === 'ACKNOWLEDGED' ? 'warning' : 'outline'}>{e.status}</Badge>
                  </div>
                  <div className="flex gap-1">
                    {e.status === 'OPEN' && canEdit && (
                      <Button size="sm" variant="outline" onClick={() => handleAcknowledge(e.id)}>Acknowledge</Button>
                    )}
                    {(e.status === 'OPEN' || e.status === 'ACKNOWLEDGED') && canEdit && (
                      <Button size="sm" variant="outline" onClick={() => handleClose(e.id)}>Close</Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{new Date(e.createdAt).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No alarm events.</p>
      )}

      <AlarmRuleBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        nodeId={nodeId}
        onCreated={() => mutate(`/api/alarms/rules/node/${nodeId}`)}
      />
    </div>
  );
}
