import { ScheduleCalendar } from '@/components/assets/schedule-calendar';

interface ScheduleTabProps {
  nodeId: string;
}

export function ScheduleTab({ nodeId }: ScheduleTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Schedules</h3>
      <ScheduleCalendar nodeId={nodeId} />
    </div>
  );
}
