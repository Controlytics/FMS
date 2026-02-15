import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@digilog/shared';
import { LinkDialog } from '@/components/assets/link-dialog';

export function HierarchyPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('parentId');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const url = parentId ? `/api/hierarchy?parentId=${parentId}` : '/api/hierarchy';
  const { data: nodes } = useSWR(url);
  const { data: parent } = useSWR(parentId ? `/api/hierarchy/${parentId}` : null);
  const { data: ancestors } = useSWR(parentId ? `/api/hierarchy/${parentId}/ancestors` : null);

  const canCreate = user?.role && ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.includes(PERMISSIONS.NODE_CREATE);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/assets" className="text-primary hover:underline">Root</Link>
        {ancestors?.map((a: any) => (
          <span key={a.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <Link to={`/assets?parentId=${a.id}`} className="text-primary hover:underline">{a.name}</Link>
          </span>
        ))}
        {parent && (
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{parent.name}</span>
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {parent ? parent.name : 'Asset Hierarchy'}
        </h1>
        <div className="flex gap-2">
          {canCreate && (
            <Button variant="outline" onClick={() => setLinkDialogOpen(true)}>+ Link Assets</Button>
          )}
          {canCreate && (
            <Link to={`/assets/node/create${parentId ? `?parentId=${parentId}` : ''}`}>
              <Button>+ Add Asset</Button>
            </Link>
          )}
        </div>
      </div>

      {parent && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-4 text-sm">
              <span><strong>Type:</strong> {parent.nodeType}</span>
              <span><strong>Status:</strong> <Badge variant={parent.status === 'active' ? 'success' : 'outline'}>{parent.status}</Badge></span>
              {parent.template && <span><strong>Template:</strong> {parent.template.name}</span>}
            </div>
            {parent.attributes && Object.keys(parent.attributes).length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                {Object.entries(parent.attributes as Record<string, unknown>).map(([key, val]) => (
                  <div key={key}>
                    <span className="text-muted-foreground">{key}:</span>{' '}
                    <span className="font-medium">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Child nodes as cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {nodes?.map((node: any) => (
          <Link key={node.id} to={`/assets?parentId=${node.id}`}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
              <CardHeader className="pb-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-2xl font-bold mb-2">
                  {node.nodeType.charAt(0).toUpperCase()}
                </div>
                <CardTitle className="text-base">{node.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{node.nodeType}</Badge>
                  <Badge variant={node.status === 'active' ? 'success' : 'outline'}>{node.status}</Badge>
                </div>
                {node._count?.children > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {node._count.children} child asset{node._count.children > 1 ? 's' : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
        {(!nodes || nodes.length === 0) && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {parent ? 'No child assets. Click "+ Add Asset" to add one.' : 'No root assets yet. Create your first asset to start building your hierarchy.'}
          </div>
        )}
      </div>

      <LinkDialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} prefilledSourceId={parentId ?? undefined} />
    </div>
  );
}
