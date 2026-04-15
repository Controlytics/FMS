import type { Section, EntitySlot, SignatureConfig } from './template-types';
import { SECTION_LABELS } from './template-types';
import { TextSectionEditor } from './text-section-editor';
import { TableSectionEditor } from './table-section-editor';
import { ChartSectionEditor } from './chart-section-editor';
import { KVSectionEditor } from './kv-section-editor';
import { SignatureSectionEditor } from './signature-section-editor';

interface Props {
  section: Section;
  onChange: (updated: Section) => void;
  entitySlots: EntitySlot[];
  signatureConfig: SignatureConfig;
  onSignatureConfigChange: (sc: SignatureConfig) => void;
}

export function SectionEditor({ section, onChange, entitySlots, signatureConfig, onSignatureConfigChange }: Props) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-bold text-slate-800 mb-1">{SECTION_LABELS[section.type]}</h3>
      <p className="text-xs text-slate-400 mb-4">Configure this section's properties</p>

      {section.type === 'text' && <TextSectionEditor section={section} onChange={onChange as any} />}
      {section.type === 'table' && <TableSectionEditor section={section} onChange={onChange as any} entitySlots={entitySlots} />}
      {section.type === 'chart' && <ChartSectionEditor section={section} onChange={onChange as any} entitySlots={entitySlots} />}
      {section.type === 'key_value' && <KVSectionEditor section={section} onChange={onChange as any} />}
      {section.type === 'signature' && <SignatureSectionEditor section={section} onChange={onChange as any} signatureConfig={signatureConfig} onSignatureConfigChange={onSignatureConfigChange} />}
      {section.type === 'page_break' && (
        <div className="text-center text-slate-400 py-6">
          <p className="text-sm">Page break inserts a new page here.</p>
          <p className="text-xs mt-1">No configuration needed.</p>
        </div>
      )}
    </div>
  );
}
