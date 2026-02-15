import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LinkDialog } from '@/components/assets/link-dialog';

interface RelationshipsTabProps {
  nodeId: string;
  canEdit: boolean;
}

export function RelationshipsTab({ nodeId, canEdit }: RelationshipsTabProps) {
  const { data: links } = useSWR(`/api/hierarchy/${nodeId}/links`);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const outgoing = links?.outgoing ?? [];
  const incoming = links?.incoming ?? [];

  const handleDelete = async (linkId: string) => {
    try {
      await apiClient.delete(`/api/hierarchy/links/${linkId}`);
      mutate(`/api/hierarchy/${nodeId}/links`);
    } catch {
      // handle error
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Relationships ({outgoing.length + incoming.length})</h3>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setLinkDialogOpen(true)}>+ Add Relationship</Button>}
      </div>

      {outgoing.length > 0 && (
        <>
          <h4 className="text-xs font-medium text-muted-foreground uppercase">Outgoing</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Target Asset</TableHead>
                <TableHead>Target Type</TableHead>
                {canEdit && <TableHead className="w-20"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {outgoing.map((link: any) => (
                <TableRow key={link.id}>
                  <TableCell><Badge variant="default">{link.linkType.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell>
                    <Link to={`/assets/${link.target.id}`} className="text-primary hover:underline">
                      {link.target.name}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">{link.target.nodeType}</Badge></TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(link.id)}>Remove</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {incoming.length > 0 && (
        <>
          <h4 className="text-xs font-medium text-muted-foreground uppercase">Incoming</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Source Asset</TableHead>
                <TableHead>Source Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incoming.map((link: any) => (
                <TableRow key={link.id}>
                  <TableCell><Badge variant="secondary">{link.linkType.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell>
                    <Link to={`/assets/${link.source.id}`} className="text-primary hover:underline">
                      {link.source.name}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">{link.source.nodeType}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className="text-sm text-muted-foreground">No relationships defined. {canEdit ? 'Click "+ Add Relationship" to link this asset.' : ''}</p>
      )}

      <LinkDialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} prefilledSourceId={nodeId} />
    </div>
  );
}
