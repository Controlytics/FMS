import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export function TemplateDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: template } = useSWR(id ? `/api/templates/${id}` : null);

  if (!template) return <div className="text-muted-foreground">Loading...</div>;

  const attrs = (template.attributeSchema ?? []) as Array<{ name: string; dataType: string; unit?: string; required?: boolean }>;
  const tele = (template.telemetrySchema ?? []) as Array<{ name: string; dataType: string; unit?: string }>;
  const expectedIds = (template.expectedIdentifiers ?? []) as Array<{ type: string; required: boolean }>;
  const expectedRels = (template.expectedRelationships ?? []) as Array<{ type: string; targetType?: string }>;
  const statusLifecycle = (template.statusLifecycle ?? []) as string[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{template.name}</h1>
          <p className="text-muted-foreground">{template.nodeType} template</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={template.status === 'active' ? 'success' : 'outline'}>{template.status}</Badge>
          <Badge variant="outline">v{template.version}</Badge>
          <Button variant="outline" onClick={() => navigate('/assets/templates')}>Back</Button>
        </div>
      </div>

      {template.description && (
        <Card>
          <CardContent className="pt-6"><p>{template.description}</p></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Attribute Schema ({attrs.length} fields)</CardTitle>
          <CardDescription>Static metadata fields defined by this template</CardDescription>
        </CardHeader>
        <CardContent>
          {attrs.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Field Name</TableHead><TableHead>Data Type</TableHead><TableHead>Unit</TableHead><TableHead>Required</TableHead></TableRow></TableHeader>
              <TableBody>
                {attrs.map((a, i) => (
                  <TableRow key={i}><TableCell className="font-medium">{a.name}</TableCell><TableCell>{a.dataType}</TableCell><TableCell>{a.unit ?? '-'}</TableCell><TableCell>{a.required ? 'Yes' : 'No'}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-sm text-muted-foreground">No attributes defined</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Telemetry Schema ({tele.length} points)</CardTitle>
          <CardDescription>Time-series data points for real-time monitoring</CardDescription>
        </CardHeader>
        <CardContent>
          {tele.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Point Name</TableHead><TableHead>Data Type</TableHead><TableHead>Unit</TableHead></TableRow></TableHeader>
              <TableBody>
                {tele.map((t, i) => (
                  <TableRow key={i}><TableCell className="font-medium">{t.name}</TableCell><TableCell>{t.dataType}</TableCell><TableCell>{t.unit ?? '-'}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-sm text-muted-foreground">No telemetry defined</p>}
        </CardContent>
      </Card>

      {expectedIds.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Expected Identifiers</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {expectedIds.map((id, i) => (
                <Badge key={i} variant={id.required ? 'default' : 'outline'}>{id.type}{id.required ? ' (required)' : ''}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {expectedRels.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Expected Relationships</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {expectedRels.map((r, i) => (
                <Badge key={i} variant="outline">{r.type.replace(/_/g, ' ')}{r.targetType ? ` → ${r.targetType}` : ''}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {statusLifecycle.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Status Lifecycle</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {statusLifecycle.map((s, i) => <Badge key={i} variant="outline">{s}</Badge>)}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Usage</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {template._count?.hierarchyNodes ?? 0} asset(s) created from this template.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
