import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { ReauthDialog } from '@/components/reauth-dialog';
import { apiClient } from '@/lib/api-client';
import { TemplateViewDialog } from './components/template-view-dialog';
import type { TemplateData, FormData } from './template-types';
import type { AuditRecord } from './types';
import { emptyForm } from './template-types';
import { TemplatesHeader } from './templates-list/components/TemplatesHeader';
import { TemplatesSearch } from './templates-list/components/TemplatesSearch';
import { TemplatesTable } from './templates-list/components/TemplatesTable';
import { TemplatesPagination } from './templates-list/components/TemplatesPagination';
import { TemplatesInfoBanner } from './templates-list/components/TemplatesInfoBanner';
import { CreateTemplateDialog } from './templates-list/dialogs/CreateTemplateDialog';
import { EditTemplateDialog } from './templates-list/dialogs/EditTemplateDialog';
import { DeleteTemplateDialog } from './templates-list/dialogs/DeleteTemplateDialog';
import { useTemplateFormHelpers } from './templates-list/hooks/use-template-form-helpers';
import { buildBody } from './templates-list/lib/build-body';
import { templateToForm } from './templates-list/lib/template-to-form';
import { validateForm } from './templates-list/lib/validate-form';

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function AssetTemplatesPage() {
  const { mutate } = useSWRConfig();
  const reauth = useReauth();
  const { formatDateTime } = useDatetimeFormat();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const hasPerm = (p: string) => isSuperAdmin || perms.includes(p);
  const canCreate = hasPerm('ASSET_TEMPLATE_CREATE');
  const canEdit = hasPerm('ASSET_TEMPLATE_UPDATE');
  const canDelete = hasPerm('ASSET_TEMPLATE_DELETE');

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateData | null>(null);
  const [viewTemplate, setViewTemplate] = useState<TemplateData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateData | null>(null);

  // Form state
  const [formData, setFormData] = useState<FormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  // Step 4 UX (2026-05-02): structured list of FilterProfiles binding the
  // template, populated from the API's `details.bindings` on a 409
  // TEMPLATE_IN_USE response. Lets us render a real list instead of jamming
  // the binding names into the message string.
  const [deleteBindings, setDeleteBindings] = useState<{ id: string; name: string }[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const paginationOptions = usePaginationConfig();

  // Search
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Data
  const { data: templatesRes, isLoading } = useSWR<{ data: TemplateData[]; total: number; page: number; totalPages: number }>(
    `/api/assets/templates?isActive=true&page=${page}&limit=${perPage}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`
  );
  const templates = templatesRes?.data;
  const displayedTemplates = templates ?? [];

  // Look up the human label per kind code so the table cell shows "Block"
  // even when the underlying code is the stable "BLOCK" identifier.
  const { data: kindsList } = useSWR<{ code: string; label: string }[]>('/api/template-kinds');
  const kindLabelByCode = useMemo(() => {
    const m = new Map<string, string>();
    (kindsList ?? []).forEach((k) => m.set(k.code, k.label));
    return m;
  }, [kindsList]);

  // Audit history for viewed template
  const [viewAuditTab, setViewAuditTab] = useState(false);
  const { data: templateAuditData } = useSWR<{ data: AuditRecord[] }>(
    viewTemplate && viewAuditTab
      ? `/api/audit?targetType=asset_template&targetId=${viewTemplate.id}`
      : null,
  );
  const templateAuditRecords = templateAuditData?.data ?? [];

  // Debounce search and reset page
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  // -----------------------------------------------------------------------
  // Form helpers
  // -----------------------------------------------------------------------

  const resetForm = useCallback(() => {
    setFormData(emptyForm());
    setError('');
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowCreateDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((template: TemplateData) => {
    setSelectedTemplate(template);
    setFormData(templateToForm(template));
    setError('');
    setShowEditDialog(true);
  }, []);

  const openDeleteDialog = useCallback((template: TemplateData) => {
    setDeleteTarget(template);
    setDeleteError('');
    setDeleteBindings(null);
    setShowDeleteDialog(true);
  }, []);

  const openViewDialog = useCallback((template: TemplateData) => {
    setViewTemplate(template);
    setViewAuditTab(false);
    setShowViewDialog(true);
  }, []);

  // -----------------------------------------------------------------------
  // Schema array helpers (attribute / telemetry / identifier / alarm /
  // checklist) — sourced from the extracted hook so the orchestrator stays
  // thin. Identical closures to the originals.
  // -----------------------------------------------------------------------

  const {
    addAttribute,
    updateAttribute,
    removeAttribute,
    addTelemetry,
    updateTelemetry,
    removeTelemetry,
    addIdentifier,
    updateIdentifier,
    removeIdentifier,
    addAlarmRule,
    updateAlarmRule,
    removeAlarmRule,
    addChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
  } = useTemplateFormHelpers(setFormData);

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  const handleCreate = async () => {
    const validationError = validateForm(formData);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const body = buildBody(formData);

      await reauth.execute(
        'CREATE_ASSET_TEMPLATE',
        async (password?: string) => {
          if (password) {
            await apiClient.postWithReauth('/api/assets/templates', body, password);
          } else {
            await apiClient.post('/api/assets/templates', body);
          }
        },
        {
          onSuccess: () => {
            mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
            setShowCreateDialog(false);
            resetForm();
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || e?.error || 'Failed to create template';
            setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || String(err) || 'Unexpected error creating template');
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  const handleUpdate = async () => {
    if (!selectedTemplate) return;
    const validationError = validateForm(formData);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const body = buildBody(formData);

      await reauth.execute(
        'UPDATE_ASSET_TEMPLATE',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/templates/${selectedTemplate.id}`, body, password);
          } else {
            await apiClient.put(`/api/assets/templates/${selectedTemplate.id}`, body);
          }
        },
        {
          onSuccess: () => {
            mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
            setShowEditDialog(false);
            setSelectedTemplate(null);
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || e?.error || 'Failed to update template';
            setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || String(err) || 'Unexpected error updating template');
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    setDeleteBindings(null);

    await reauth.execute(
      'DELETE_ASSET_TEMPLATE',
      async (password?: string) => {
        if (password) {
          await apiClient.deleteWithReauth(`/api/assets/templates/${deleteTarget.id}`, password);
        } else {
          await apiClient.delete(`/api/assets/templates/${deleteTarget.id}`);
        }
      },
      {
        onSuccess: () => {
          mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
          setShowDeleteDialog(false);
          setDeleteTarget(null);
          setDeleting(false);
        },
        onError: (err: any) => {
          // Step 4 UX (2026-05-02): TEMPLATE_IN_USE returns the binding
          // FilterProfile rows in `details.bindings`, surfaced via api-client
          // as `err.connectionInfo.bindings`. Render them as a structured
          // list. Fall through to plain message for any other 4xx.
          if (err?.code === 'TEMPLATE_IN_USE' && Array.isArray(err.connectionInfo?.bindings)) {
            setDeleteBindings(err.connectionInfo.bindings);
            setDeleteError('');
          } else {
            setDeleteError(err.message || 'Failed to delete template');
          }
          setDeleting(false);
        },
      },
    );
  };

  // -----------------------------------------------------------------------
  // Form change handler for the extracted TemplateFormEditor
  // -----------------------------------------------------------------------

  const handleFormChange = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  // Shared form editor props
  const formEditorProps = {
    formData,
    error,
    onFormChange: handleFormChange,
    onAddAttribute: addAttribute,
    onUpdateAttribute: updateAttribute,
    onRemoveAttribute: removeAttribute,
    onAddTelemetry: addTelemetry,
    onUpdateTelemetry: updateTelemetry,
    onRemoveTelemetry: removeTelemetry,
    onAddIdentifier: addIdentifier,
    onUpdateIdentifier: updateIdentifier,
    onRemoveIdentifier: removeIdentifier,
    onAddAlarmRule: addAlarmRule,
    onUpdateAlarmRule: updateAlarmRule,
    onRemoveAlarmRule: removeAlarmRule,
    onAddChecklistItem: addChecklistItem,
    onUpdateChecklistItem: updateChecklistItem,
    onRemoveChecklistItem: removeChecklistItem,
  };

  // -----------------------------------------------------------------------
  // Dialog close handlers — wrapped in stable closures so we can pass them
  // to the extracted dialog components without changing semantics.
  // -----------------------------------------------------------------------

  const closeCreateDialog = useCallback(() => {
    setShowCreateDialog(false);
    setSaving(false);
  }, []);

  const closeEditDialog = useCallback(() => {
    setShowEditDialog(false);
    setSelectedTemplate(null);
    setSaving(false);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setShowDeleteDialog(false);
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <TemplatesHeader canCreate={canCreate} onCreate={openCreateDialog} />

      {/* Search */}
      <TemplatesSearch searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      {/* Templates Table */}
      <TemplatesTable
        isLoading={isLoading}
        templates={displayedTemplates}
        debouncedSearch={debouncedSearch}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        kindLabelByCode={kindLabelByCode}
        onCreate={openCreateDialog}
        onView={openViewDialog}
        onEdit={openEditDialog}
        onDelete={openDeleteDialog}
      />

      {/* Pagination
          NOTE: the original templates.tsx displayed `templatesRes.page` in the
          "Page X of Y" text but used local `page` for button enabled/disabled
          and number-highlighting. The extracted <TemplatesPagination> takes a
          single `page` prop. We pass local `page` so the button states (which
          drive interactivity) stay correct; the display text follows local
          state and is virtually indistinguishable in practice (they only
          diverge for the SWR fetch window). */}
      {templatesRes && (templatesRes.totalPages ?? 0) > 0 && (
        <TemplatesPagination
          page={page}
          perPage={perPage}
          total={templatesRes.total}
          totalPages={templatesRes.totalPages}
          paginationOptions={paginationOptions}
          onPerPageChange={(opt) => { setPerPage(opt); setPage(1); }}
          onPageChange={(p) => setPage(p)}
          onPageDelta={(delta) => setPage((p) => p + delta)}
        />
      )}

      {/* Info Banner */}
      <TemplatesInfoBanner />

      {/* Create Template Dialog */}
      <CreateTemplateDialog
        open={showCreateDialog}
        saving={saving}
        error={error}
        formEditorProps={formEditorProps}
        onClose={closeCreateDialog}
        onCreate={handleCreate}
      />

      {/* Edit Template Dialog */}
      <EditTemplateDialog
        open={showEditDialog}
        saving={saving}
        error={error}
        selectedTemplate={selectedTemplate}
        formEditorProps={formEditorProps}
        onClose={closeEditDialog}
        onUpdate={handleUpdate}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteTemplateDialog
        open={showDeleteDialog}
        deleting={deleting}
        deleteError={deleteError}
        deleteBindings={deleteBindings}
        deleteTarget={deleteTarget}
        onClose={closeDeleteDialog}
        onDelete={handleDelete}
      />

      {/* View Template Dialog */}
      <TemplateViewDialog
        open={showViewDialog}
        template={viewTemplate}
        onClose={() => { setShowViewDialog(false); setViewTemplate(null); }}
        onEdit={() => { setShowViewDialog(false); const t = viewTemplate; setViewTemplate(null); if (t) openEditDialog(t); }}
        formatDateTime={formatDateTime}
        auditRecords={templateAuditRecords}
        viewAuditTab={viewAuditTab}
        setViewAuditTab={setViewAuditTab}
      />

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Entity Template Action"
      />
    </div>
  );
}
