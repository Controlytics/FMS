import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { TemplateData } from '../../template-types';

interface TemplatesTableProps {
  isLoading: boolean;
  templates: TemplateData[];
  debouncedSearch: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  kindLabelByCode: Map<string, string>;
  onCreate: () => void;
  onView: (template: TemplateData) => void;
  onEdit: (template: TemplateData) => void;
  onDelete: (template: TemplateData) => void;
}

/**
 * Templates list card with three states (loading / empty / populated).
 * Pure presentational — extracted verbatim from templates.tsx.
 */
export function TemplatesTable({
  isLoading,
  templates,
  debouncedSearch,
  canCreate,
  canEdit,
  canDelete,
  kindLabelByCode,
  onCreate,
  onView,
  onEdit,
  onDelete,
}: TemplatesTableProps) {
  return (
    <Card className="border-0 shadow-xl overflow-hidden">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-16 text-center">
            <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-500">Loading templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">No templates found</h3>
            <p className="text-sm text-slate-500 mb-4">
              {debouncedSearch
                ? 'Try adjusting your search criteria.'
                : 'Get started by creating your first entity template.'}
            </p>
            {!debouncedSearch && canCreate && (
              <Button onClick={onCreate} className="bg-gradient-to-r from-purple-500 to-indigo-600">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Template
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="font-semibold text-slate-600">Name</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Kind</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Attributes</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Instances</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} className="hover:bg-slate-50/50 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-purple-100 text-purple-600 flex-shrink-0">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{template.name}</p>
                        {template.description && (
                          <p className="text-xs text-slate-500 max-w-xs truncate">{template.description}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      template.templateKind === 'OTHER' || !template.templateKind
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-blue-100 text-blue-700'
                    }`} title={`code: ${template.templateKind ?? 'OTHER'}`}>
                      {kindLabelByCode.get(template.templateKind ?? 'OTHER') ?? template.templateKind ?? 'OTHER'}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm font-medium text-slate-700">
                      {template.attributeSchema?.length || 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm font-medium text-slate-700">
                      {template._count?.instances ?? 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onView(template)}
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        title="View template details"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(template)}
                          className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                          title="Edit template"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(template)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Delete template"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
