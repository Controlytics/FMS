import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface ScheduleCalendarProps {
  nodeId: string;
}

export function ScheduleCalendar({ nodeId }: ScheduleCalendarProps) {
  const { data: schedules } = useSWR(`/api/schedules/node/${nodeId}`);

  if (!schedules || schedules.length === 0) {
    return <p className="text-sm text-muted-foreground">No schedules configured.</p>;
  }

  const now = new Date();

  return (
    <div className="space-y-3">
      {schedules.map((s: any) => {
        const isOverdue = s.nextDueAt && new Date(s.nextDueAt) < now && s.status === 'active';
        const isOnboarding = s.isOnboarding && !s.lastPerformedAt;

        return (
          <Card key={s.id} className={isOverdue ? 'border-destructive' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {s.nodeChecklist?.checklistTemplate?.name ?? 'Schedule'}
                </CardTitle>
                <div className="flex gap-1">
                  <Badge variant={s.status === 'active' ? 'success' : 'outline'}>{s.status}</Badge>
                  {isOnboarding && <Badge variant="warning">Onboarding</Badge>}
                  {isOverdue && <Badge variant="destructive">Overdue</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex gap-4">
                <span><strong>Frequency:</strong> {s.frequency}{s.frequencyValue ? ` (every ${s.frequencyValue})` : ''}</span>
                {s.toleranceBefore != null && <span><strong>Tolerance:</strong> -{s.toleranceBefore}min / +{s.toleranceAfter ?? 0}min</span>}
              </div>
              <div className="flex gap-4">
                {s.lastPerformedAt && <span><strong>Last:</strong> {new Date(s.lastPerformedAt).toLocaleString()}</span>}
                {s.nextDueAt && <span className={isOverdue ? 'text-destructive font-medium' : ''}><strong>Next Due:</strong> {new Date(s.nextDueAt).toLocaleString()}</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
