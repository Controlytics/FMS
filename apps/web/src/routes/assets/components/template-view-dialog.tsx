import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import type { TemplateData } from '../template-types';
import type { AuditRecord } from '../types';

export interface TemplateViewDialogProps {
  open: boolean;
  template: TemplateData | null;
  onClose: () => void;
  onEdit: () => void;
  formatDateTime: (date: string) => string;
  auditRecords: AuditRecord[];
  viewAuditTab: boolean;
  setViewAuditTab: (v: boolean) => void;
}

export function TemplateViewDialog({
  open,
  template,
  onClose,
  onEdit,
  formatDateTime,
  auditRecords,
  viewAuditTab,
  setViewAuditTab,
}: TemplateViewDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          Template Details: {template?.name}
        </DialogTitle>
      </DialogHeader>
      {template && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Basic Info */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Basic Information
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Name</p>
                <p className="text-sm text-slate-800 font-medium">{template.name}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Icon</p>
                <p className="text-sm text-slate-800">{template.icon}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Description</p>
                <p className="text-sm text-slate-600">{template.description || '\u2014'}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Version</p>
                <p className="text-sm text-slate-800">v{template.version}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Status</p>
                <Badge className={template.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}>
                  {template.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Parent Connections Limit</p>
                <p className="text-sm text-slate-800">{template.maxParentConnections === 0 ? 'Not Allowed' : template.maxParentConnections}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Max Connections (All Types)</p>
                <p className="text-sm text-slate-800">{template.maxConnections === 0 ? 'Unlimited' : template.maxConnections}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Instances</p>
                <p className="text-sm text-slate-800">{template._count?.instances ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Attributes */}
          {template.attributeSchema?.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                Attributes
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{template.attributeSchema.length}</Badge>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium">Field Name</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Required</th>
                      <th className="pb-2 font-medium">Unit</th>
                      <th className="pb-2 font-medium">Default</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {template.attributeSchema.map((attr: any, i: number) => (
                      <tr key={i} className="text-slate-700">
                        <td className="py-1.5 font-medium">{attr.fieldName}</td>
                        <td className="py-1.5"><Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{attr.dataType}</Badge></td>
                        <td className="py-1.5">{attr.required ? <span className="text-emerald-600">Yes</span> : <span className="text-slate-400">No</span>}</td>
                        <td className="py-1.5 text-slate-500">{attr.unit || '\u2014'}</td>
                        <td className="py-1.5 text-slate-500">{attr.defaultValue != null && attr.defaultValue !== '' ? String(attr.defaultValue) : '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Telemetry */}
          {template.telemetrySchema?.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                Telemetry
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{template.telemetrySchema.length}</Badge>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium">Field Name</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Unit</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {template.telemetrySchema.map((tel: any, i: number) => (
                      <tr key={i} className="text-slate-700">
                        <td className="py-1.5 font-medium">{tel.fieldName}</td>
                        <td className="py-1.5"><Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{tel.dataType}</Badge></td>
                        <td className="py-1.5 text-slate-500">{tel.unit || '\u2014'}</td>
                        <td className="py-1.5 text-slate-500">{tel.description || '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Expected Identifiers */}
          {template.expectedIdentifiers?.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                Expected Identifiers
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{template.expectedIdentifiers.length}</Badge>
              </h4>
              <div className="flex flex-wrap gap-2">
                {template.expectedIdentifiers.map((id: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{id.identifierType}</Badge>
                    <span className="text-slate-700 font-medium">{id.label}</span>
                    {id.required && <span className="text-red-500 text-[10px]">Required</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alarm Rules */}
          {template.alarmRules?.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                Alarm Rules
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{template.alarmRules.length}</Badge>
              </h4>
              <div className="space-y-2">
                {template.alarmRules.map((rule: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{rule.severity}</Badge>
                    <span className="font-medium text-slate-700">{rule.name}</span>
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{rule.type}</Badge>
                    {rule.sourceField && <span className="text-slate-500">on {rule.sourceField}</span>}
                    {!rule.enabled && <span className="text-red-400 italic">Disabled</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Checklist */}
          {template.checklistSchema?.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                Checklist Questions
                <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{template.checklistSchema.length}</Badge>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium">#</th>
                      <th className="pb-2 font-medium">Question</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Section</th>
                      <th className="pb-2 font-medium">Required</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {template.checklistSchema.map((item: any, i: number) => (
                      <tr key={i} className="text-slate-700">
                        <td className="py-1.5 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 font-medium max-w-xs">{item.question}</td>
                        <td className="py-1.5"><Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">{(item.questionType || '').replace(/_/g, ' ')}</Badge></td>
                        <td className="py-1.5 text-slate-500">{item.section || '\u2014'}</td>
                        <td className="py-1.5">{item.required ? <span className="text-emerald-600">Yes</span> : <span className="text-slate-400">No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Audit History */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <button
              type="button"
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
              onClick={() => setViewAuditTab(!viewAuditTab)}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                Audit History
              </span>
              <svg className={cn('w-4 h-4 text-slate-400 transition-transform', viewAuditTab && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {viewAuditTab && (
              <div>
                {auditRecords.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No audit history available for this template.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-100">
                          <th className="pb-2 font-medium">Timestamp</th>
                          <th className="pb-2 font-medium">Action</th>
                          <th className="pb-2 font-medium">User</th>
                          <th className="pb-2 font-medium">Changes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {auditRecords.map((record) => (
                          <tr key={record.id} className="text-slate-700">
                            <td className="py-1.5 whitespace-nowrap">{formatDateTime(record.timestamp)}</td>
                            <td className="py-1.5">
                              <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                                {record.action.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="py-1.5">{record.userId}</td>
                            <td className="py-1.5 text-slate-500 max-w-xs truncate">
                              {record.reason || record.signatureMeaning || (record.afterValue
                                ? typeof record.afterValue === 'string'
                                  ? record.afterValue
                                  : JSON.stringify(record.afterValue).substring(0, 120)
                                : '-')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          onClick={onEdit}
          className="bg-gradient-to-r from-purple-500 to-indigo-600"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Template
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
