import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { TemplateData } from '../../template-types';

interface DeleteTemplateDialogProps {
  open: boolean;
  deleting: boolean;
  deleteError: string;
  /**
   * Step 4 UX (2026-05-02): structured list of FilterProfiles binding the
   * template, populated from the API's `details.bindings` on a 409
   * TEMPLATE_IN_USE response. `null` means "no bindings response yet".
   */
  deleteBindings: { id: string; name: string }[] | null;
  deleteTarget: TemplateData | null;
  onClose: () => void;
  onDelete: () => void;
}

/**
 * Confirmation dialog for deleting an asset template. Renders the
 * structured TEMPLATE_IN_USE binding list when present, otherwise a plain
 * confirmation. Pure presentational — extracted verbatim from templates.tsx.
 */
export function DeleteTemplateDialog({
  open,
  deleting,
  deleteError,
  deleteBindings,
  deleteTarget,
  onClose,
  onDelete,
}: DeleteTemplateDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-red-100 text-red-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          Delete Template
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {deleteError && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-red-700">{deleteError}</p>
          </div>
        )}

        {/* Step 4 UX (2026-05-02): structured TEMPLATE_IN_USE response. */}
        {deleteBindings && deleteBindings.length > 0 && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-100 shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Cannot delete &mdash; template is bound by {deleteBindings.length} filter profile{deleteBindings.length === 1 ? '' : 's'}</p>
                <p className="text-xs text-red-700 mt-1">Detach this template from each profile first (Configuration &rarr; Cleaning Profile Assignment), then retry.</p>
                <ul className="mt-3 space-y-1.5">
                  {deleteBindings.map((b) => (
                    <li key={b.id} className="bg-white border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{b.name}</span>
                      <code className="text-xs text-slate-400" title={b.id}>{b.id.slice(0, 8)}…</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <p className="text-slate-600">
          Are you sure you want to delete the template{' '}
          <span className="font-semibold text-slate-800">{deleteTarget?.name}</span>?
        </p>

        {deleteTarget?._count?.instances && deleteTarget._count.instances > 0 ? (
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
            <div className="p-2 rounded-lg bg-amber-100">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-sm text-amber-700">
              This template has <strong>{deleteTarget._count.instances}</strong> active instance{deleteTarget._count.instances > 1 ? 's' : ''}.
              Deleting the template will leave these instances without a template reference.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            This action cannot be undone. The template will be permanently removed from the system.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={onDelete}
          disabled={deleting}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {deleting ? 'Deleting...' : 'Delete Template'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
