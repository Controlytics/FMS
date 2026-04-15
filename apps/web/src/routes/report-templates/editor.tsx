import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import type { TemplateConfig, Section } from './components/template-types';
import { createDefaultSection, type SectionType } from './components/template-types';
import { SectionPalette } from './components/section-palette';
import { SectionCanvas } from './components/section-canvas';
import { SectionEditor } from './components/section-editor';
import { HeaderFooterEditor } from './components/header-footer-editor';
import { EntitySlotEditor } from './components/entity-slot-editor';
import { VariableTagPicker } from './components/variable-tag-picker';
import { PageSettingsEditor } from './components/page-settings-editor';

const DEFAULT_CONFIG: TemplateConfig = {
  pageSettings: { size: 'A4', orientation: 'portrait', margins: { top: 20, right: 15, bottom: 20, left: 15 } },
  header: { enabled: true, height: 80, elements: [] },
  footer: { enabled: true, height: 40, elements: [] },
  entitySlots: [],
  sections: [],
  signatureConfig: { required: false, meaning: '', signers: [] },
};

type RightPanel = 'section' | 'header' | 'footer' | 'page-settings';

export function ReportTemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const reauth = useReauth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canUpdate = isSuperAdmin || (user?.permissions ?? []).includes('REPORT_TEMPLATE_UPDATE');

  const { data: templateData, isLoading } = useSWR(id ? `/api/report-templates/${id}` : null);

  const [config, setConfig] = useState<TemplateConfig | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>('section');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Initialize config from fetched data, merging with defaults for missing fields
  if (templateData && !config) {
    const raw = templateData.latestConfig ?? {};
    const fetched: TemplateConfig = {
      pageSettings: raw.pageSettings ?? DEFAULT_CONFIG.pageSettings,
      header: raw.header ?? DEFAULT_CONFIG.header,
      footer: raw.footer ?? DEFAULT_CONFIG.footer,
      entitySlots: raw.entitySlots ?? DEFAULT_CONFIG.entitySlots,
      sections: raw.sections ?? DEFAULT_CONFIG.sections,
      signatureConfig: raw.signatureConfig ?? DEFAULT_CONFIG.signatureConfig,
    };
    setConfig(fetched);
    setTemplateName(templateData.name ?? '');
    setTemplateDescription(templateData.description ?? '');
  }

  const updateConfig = useCallback((updater: (prev: TemplateConfig) => TemplateConfig) => {
    setConfig(prev => {
      if (!prev) return prev;
      setDirty(true);
      return updater(prev);
    });
  }, []);

  const addSection = useCallback((type: SectionType) => {
    updateConfig(prev => {
      const newSection = createDefaultSection(type);
      const sections = [...prev.sections, newSection];
      setSelectedSectionIdx(sections.length - 1);
      setRightPanel('section');
      return { ...prev, sections };
    });
  }, [updateConfig]);

  const updateSection = useCallback((idx: number, updated: Section) => {
    updateConfig(prev => ({
      ...prev,
      sections: prev.sections.map((s, i) => i === idx ? updated : s),
    }));
  }, [updateConfig]);

  const removeSection = useCallback((idx: number) => {
    updateConfig(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== idx),
    }));
    setSelectedSectionIdx(null);
  }, [updateConfig]);

  const reorderSections = useCallback((fromIdx: number, toIdx: number) => {
    updateConfig(prev => {
      const sections = [...prev.sections];
      const [moved] = sections.splice(fromIdx, 1);
      sections.splice(toIdx, 0, moved);
      return { ...prev, sections };
    });
    // Adjust selected index
    setSelectedSectionIdx(prev => {
      if (prev === null) return null;
      if (prev === fromIdx) return toIdx;
      if (fromIdx < prev && toIdx >= prev) return prev - 1;
      if (fromIdx > prev && toIdx <= prev) return prev + 1;
      return prev;
    });
  }, [updateConfig]);

  const handleSave = useCallback(() => {
    if (!config || !id) return;
    reauth.execute('UPDATE_REPORT_TEMPLATE', async (password?: string) => {
      setSaving(true);
      try {
        const body = { name: templateName, description: templateDescription || undefined, config, changelog: 'Updated via designer' };
        if (password) await apiClient.putWithReauth(`/api/report-templates/${id}`, body, password);
        else await apiClient.put(`/api/report-templates/${id}`, body);
        setDirty(false);
        toast.success('Template saved');
      } catch (err: any) {
        toast.error('Save failed', err.message || 'Could not save template');
        throw err;
      } finally {
        setSaving(false);
      }
    });
  }, [config, id, templateName, templateDescription, reauth, toast]);

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && canUpdate) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, canUpdate, handleSave]);

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const selectedSection = selectedSectionIdx !== null ? config.sections[selectedSectionIdx] : null;

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/report-templates')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <input value={templateName} onChange={e => { setTemplateName(e.target.value); setDirty(true); }}
              className="text-lg font-bold text-slate-800 bg-transparent border-none outline-none focus:ring-0 w-72"
              placeholder="Template Name" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>}
          <button onClick={() => { setRightPanel('page-settings'); setSelectedSectionIdx(null); }}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Page Settings
          </button>
          {canUpdate && (
            <button onClick={handleSave} disabled={saving || !dirty}
              className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 shadow-md"
              style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* 3-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Palette + Entity Slots + Variable Tags */}
        <div className="w-64 bg-white border-r border-slate-200 overflow-y-auto shrink-0">
          <SectionPalette onAdd={addSection} />
          <EntitySlotEditor
            slots={config.entitySlots}
            onChange={slots => updateConfig(prev => ({ ...prev, entitySlots: slots }))}
          />
          <VariableTagPicker entitySlots={config.entitySlots} />
        </div>

        {/* Center: Section Canvas */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Header click-to-edit */}
          <button onClick={() => { setRightPanel('header'); setSelectedSectionIdx(null); }}
            className={`w-full mb-3 p-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors ${rightPanel === 'header' ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500'}`}>
            {config.header.enabled ? `Header (${config.header.elements.length} elements)` : 'Header (disabled)'}
          </button>

          <SectionCanvas
            sections={config.sections}
            selectedIdx={selectedSectionIdx}
            onSelect={(idx) => { setSelectedSectionIdx(idx); setRightPanel('section'); }}
            onReorder={reorderSections}
            onRemove={removeSection}
          />

          {/* Footer click-to-edit */}
          <button onClick={() => { setRightPanel('footer'); setSelectedSectionIdx(null); }}
            className={`w-full mt-3 p-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors ${rightPanel === 'footer' ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500'}`}>
            {config.footer.enabled ? `Footer (${config.footer.elements.length} elements)` : 'Footer (disabled)'}
          </button>
        </div>

        {/* Right Panel: Section Editor / Header-Footer / Page Settings */}
        <div className="w-80 bg-white border-l border-slate-200 overflow-y-auto shrink-0">
          {rightPanel === 'section' && selectedSection ? (
            <SectionEditor
              section={selectedSection}
              onChange={(updated) => updateSection(selectedSectionIdx!, updated)}
              entitySlots={config.entitySlots}
              signatureConfig={config.signatureConfig}
              onSignatureConfigChange={sc => updateConfig(prev => ({ ...prev, signatureConfig: sc }))}
            />
          ) : rightPanel === 'header' ? (
            <HeaderFooterEditor
              label="Header"
              config={config.header}
              onChange={header => updateConfig(prev => ({ ...prev, header }))}
            />
          ) : rightPanel === 'footer' ? (
            <HeaderFooterEditor
              label="Footer"
              config={config.footer}
              onChange={footer => updateConfig(prev => ({ ...prev, footer }))}
            />
          ) : rightPanel === 'page-settings' ? (
            <PageSettingsEditor
              settings={config.pageSettings}
              onChange={pageSettings => updateConfig(prev => ({ ...prev, pageSettings }))}
            />
          ) : (
            <div className="p-6 text-center text-slate-400 text-sm">
              <p className="mt-4">Select a section to edit its properties</p>
            </div>
          )}
        </div>
      </div>

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} />
    </div>
  );
}
