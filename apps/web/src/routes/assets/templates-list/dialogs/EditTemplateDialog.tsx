import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { TemplateFormEditor } from '../../components/template-form-editor';
import type { ComponentProps } from 'react';
import type { TemplateData } from '../../template-types';

type FormEditorProps = ComponentProps<typeof TemplateFormEditor>;

interface EditTemplateDialogProps {
  open: boolean;
  saving: boolean;
  error: string;
  selectedTemplate: TemplateData | null;
  formEditorProps: FormEditorProps;
  onClose: () => void;
  onUpdate: () => void;
}

/**
 * Modal dialog wrapping <TemplateFormEditor> for the "edit template" flow.
 * Pure presentational — keeps the original spread + footer layout intact.
 */
export function EditTemplateDialog({
  open,
  saving,
  error,
  selectedTemplate,
  formEditorProps,
  onClose,
  onUpdate,
}: EditTemplateDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          Edit Template: {selectedTemplate?.name}
        </DialogTitle>
      </DialogHeader>
      <TemplateFormEditor {...formEditorProps} />
      {error && <p className="text-sm text-red-600 text-right px-1 mt-2">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onUpdate}
          disabled={saving}
          className="bg-gradient-to-r from-purple-500 to-indigo-600"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
