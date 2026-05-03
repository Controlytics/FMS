import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { TemplateFormEditor } from '../../components/template-form-editor';
import type { ComponentProps } from 'react';

type FormEditorProps = ComponentProps<typeof TemplateFormEditor>;

interface CreateTemplateDialogProps {
  open: boolean;
  saving: boolean;
  error: string;
  formEditorProps: FormEditorProps;
  onClose: () => void;
  onCreate: () => void;
}

/**
 * Modal dialog wrapping <TemplateFormEditor> for the "create template" flow.
 * Pure presentational — keeps the original spread + footer layout intact.
 */
export function CreateTemplateDialog({
  open,
  saving,
  error,
  formEditorProps,
  onClose,
  onCreate,
}: CreateTemplateDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          Create New Template
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
          onClick={onCreate}
          disabled={saving}
          className="bg-gradient-to-r from-purple-500 to-indigo-600"
        >
          {saving ? 'Creating...' : 'Create Template'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
