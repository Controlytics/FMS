import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface AuditTabProps {
  nodeId: string;
}

export function AuditTab({ nodeId }: AuditTabProps) {
  const { data: auditData } = useSWR(`/api/audit?targetId=${nodeId}&limit=50`);
  const entries = auditData?.data ?? auditData ?? [];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Audit History</h3>

      {entries.length > 0 ? (
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
            {entries.map((entry: any) => (
              <TableRow key={entry.id}>
                <TableCell className="text-xs">{new Date(entry.timestamp).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{entry.action}</Badge></TableCell>
                <TableCell className="text-xs">{entry.userName ?? entry.userId}</TableCell>
                <TableCell className="text-xs max-w-xs truncate">
                  {entry.reason ?? (entry.afterValue ? JSON.stringify(entry.afterValue).slice(0, 80) : '—')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No audit entries found for this asset.</p>
      )}
    </div>
  );
}
