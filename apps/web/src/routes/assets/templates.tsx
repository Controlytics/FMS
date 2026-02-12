import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { ROLE_PERMISSIONS, PERMISSIONS } from '@digilog/shared';

export function TemplateListPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { data: templates } = useSWR(`/api/templates${search ? `?search=${search}` : ''}`);

  const canCreate = user?.role && ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS]?.includes(PERMISSIONS.TEMPLATE_CREATE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Asset Template Library</h1>
        {canCreate && (
          <Link to="/assets/templates/create">
            <Button>Create Template</Button>
          </Link>
        )}
      </div>

      <Input
        placeholder="Search templates..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {templates?.map((t: any) => (
          <Link key={t.id} to={`/assets/templates/${t.id}`}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
              <CardHeader className="pb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl mb-2">
                  {t.nodeType.charAt(0).toUpperCase()}
                </div>
                <CardTitle className="text-base">{t.name}</CardTitle>
                <CardDescription>{t.nodeType}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Badge variant={t.status === 'active' ? 'success' : 'outline'}>
                    {t.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">v{t.version}</span>
                </div>
                {t.description && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
        {(!templates || templates.length === 0) && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No templates yet. Create your first template to get started.
          </div>
        )}
      </div>
    </div>
  );
}
