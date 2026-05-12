import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from './collapsible-section';
import type { FormData } from '../template-types';
import {
  ICONS,
  TRANSPORT_TYPES,
  CREDENTIAL_TYPES,
} from '../template-types';
import useSWR from 'swr';
import { AttributeRow } from './template-form-editor/attribute-row';
import { TelemetryRow } from './template-form-editor/telemetry-row';
import { IdentifierRow } from './template-form-editor/identifier-row';
import { AlarmRuleRow } from './template-form-editor/alarm-rule-row';
import { ChecklistItemRow } from './template-form-editor/checklist-item-row';
import { RuleChainSelector } from './template-form-editor/rule-chain-selector';

export interface TemplateFormEditorProps {
  formData: FormData;
  error: string;
  onFormChange: (updates: Partial<FormData>) => void;
  // Attribute handlers
  onAddAttribute: () => void;
  onUpdateAttribute: (index: number, field: string, value: unknown) => void;
  onRemoveAttribute: (index: number) => void;
  // Telemetry handlers
  onAddTelemetry: () => void;
  onUpdateTelemetry: (index: number, field: string, value: unknown) => void;
  onRemoveTelemetry: (index: number) => void;
  // Identifier handlers
  onAddIdentifier: () => void;
  onUpdateIdentifier: (index: number, field: string, value: unknown) => void;
  onRemoveIdentifier: (index: number) => void;
  // Alarm rule handlers
  onAddAlarmRule: () => void;
  onUpdateAlarmRule: (index: number, field: string, value: unknown) => void;
  onRemoveAlarmRule: (index: number) => void;
  // Checklist handlers
  onAddChecklistItem: () => void;
  onUpdateChecklistItem: (index: number, field: string, value: unknown) => void;
  onRemoveChecklistItem: (index: number) => void;
}

export function TemplateFormEditor({
  formData,
  error,
  onFormChange,
  onAddAttribute,
  onUpdateAttribute,
  onRemoveAttribute,
  onAddTelemetry,
  onUpdateTelemetry,
  onRemoveTelemetry,
  onAddIdentifier,
  onUpdateIdentifier,
  onRemoveIdentifier,
  onAddAlarmRule,
  onUpdateAlarmRule,
  onRemoveAlarmRule,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onRemoveChecklistItem,
}: TemplateFormEditorProps) {
  // Fetch active template kinds for the dropdown. Kinds are admin-editable
  // (Configuration → Template Kinds) so we always pull from the API rather
  // than hardcode the list. Falls back to seeded codes if the fetch fails.
  const { data: templateKindsData } = useSWR<{ code: string; label: string; description?: string | null; isSystem: boolean }[]>('/api/template-kinds?isActive=true');

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      {error && (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
          <div className="p-2 rounded-lg bg-red-100">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Section 1: Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-xs font-bold">1</div>
          Basic Info
        </h3>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Template Name *</label>
          <Input
            value={formData.name}
            onChange={(e) => onFormChange({ name: e.target.value })}
            placeholder="e.g., Temperature Sensor"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => onFormChange({ description: e.target.value })}
            placeholder="Brief description of this template's purpose"
            rows={3}
            className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Icon</label>
          <Select
            value={formData.icon}
            onChange={(e) => onFormChange({ icon: e.target.value })}
            selectSize="md"
          >
            {ICONS.map((ic) => (
              <option key={ic.value} value={ic.value}>{ic.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">
            Template Kind
            <span className="ml-1 text-xs text-slate-400 font-normal">(determines whether Filter Operations / Cleaning pages can resolve this template — manage kinds at Configuration → Template Kinds)</span>
          </label>
          <Select
            value={formData.templateKind ?? 'OTHER'}
            onChange={(e) => onFormChange({ templateKind: e.target.value as any })}
            selectSize="md"
          >
            {(() => {
              // SWR result for the kinds list. Fetched once per form mount.
              const list = (templateKindsData as { code: string; label: string; description?: string | null; isSystem: boolean }[] | undefined) ?? [];
              if (list.length === 0) {
                // Fallback while loading or if endpoint fails — shows the seeded codes
                return ['OTHER', 'BLOCK', 'AREA', 'AHU', 'FILTER', 'EQUIPMENT'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ));
              }
              return list.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}{k.isSystem ? ' (system)' : ''}{k.description ? ` — ${k.description}` : ''}
                </option>
              ));
            })()}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Number of Parent Connections</label>
          <Input
            type="number"
            min={0}
            step={1}
            value={formData.maxParentConnections}
            onChange={(e) => onFormChange({ maxParentConnections: Math.max(0, parseInt(e.target.value) || 0) })}
            className="h-11"
          />
          <p className="text-xs text-slate-500">
            {formData.maxParentConnections === 0
              ? 'Entities of this template cannot be placed under any parent.'
              : formData.maxParentConnections === 1
              ? 'Only 1 parent connection allowed — the selected entity becomes the parent node, other contained entities go as child nodes.'
              : `Up to ${formData.maxParentConnections} parent connections allowed.`}
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Max Connections (All Types)</label>
          <Input
            type="number"
            min={0}
            step={1}
            value={formData.maxConnections}
            onChange={(e) => onFormChange({ maxConnections: Math.max(0, parseInt(e.target.value) || 0) })}
            className="h-11"
          />
          <p className="text-xs text-slate-500">
            {formData.maxConnections === 0
              ? 'Unlimited — no cap on total connections.'
              : `Max ${formData.maxConnections} total connections across all relationship types.`}
          </p>
        </div>
      </div>

      {/* Section 2: Attribute Schema */}
      <CollapsibleSection title="Attribute Schema" count={formData.attributeSchema.length} defaultOpen={formData.attributeSchema.length > 0}>
        <p className="text-xs text-slate-500 -mt-1 mb-3">Define static properties for entities — serial numbers, model info, calibration dates, configuration values. These are key-value pairs stored with each entity instance.</p>
        {formData.attributeSchema.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg mb-3">
            <p className="text-sm text-slate-400">No attributes yet. Click "Add Attribute" to define properties like:</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">serialNumber (TEXT)</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">calibrationDate (DATE)</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">maxPressure (FLOAT, PSI)</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">isCalibrated (BOOLEAN)</span>
            </div>
          </div>
        )}
        {formData.attributeSchema.map((attr, idx) => (
          <AttributeRow
            key={idx}
            attr={attr}
            idx={idx}
            onUpdate={onUpdateAttribute}
            onRemove={onRemoveAttribute}
          />
        ))}
        <Button variant="outline" size="sm" onClick={onAddAttribute} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Attribute
        </Button>
      </CollapsibleSection>

      {/* Section 3: Telemetry Schema */}
      <CollapsibleSection title="Telemetry Schema" count={formData.telemetrySchema.length} defaultOpen={formData.telemetrySchema.length > 0}>
        <p className="text-xs text-slate-500 -mt-1 mb-3">Define real-time data points devices will send — temperature, humidity, pressure, RPM, etc. These are time-series values collected and stored continuously.</p>
        {formData.telemetrySchema.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg mb-3">
            <p className="text-sm text-slate-400">No telemetry points yet. Click "Add Telemetry Point" to define data streams like:</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">temperature (FLOAT, °C)</span>
              <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">humidity (FLOAT, %)</span>
              <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">pressure (FLOAT, PSI)</span>
              <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">isRunning (BOOLEAN)</span>
            </div>
          </div>
        )}
        {formData.telemetrySchema.map((tel, idx) => (
          <TelemetryRow
            key={idx}
            tel={tel}
            idx={idx}
            onUpdate={onUpdateTelemetry}
            onRemove={onRemoveTelemetry}
          />
        ))}
        <Button variant="outline" size="sm" onClick={onAddTelemetry} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Telemetry Point
        </Button>
      </CollapsibleSection>

      {/* Section 4: Expected Identifiers */}
      <CollapsibleSection title="Expected Identifiers" count={formData.expectedIdentifiers.length} defaultOpen={formData.expectedIdentifiers.length > 0}>
        <p className="text-xs text-slate-500 -mt-1 mb-3">Specify how entities will be physically identified — QR codes, barcodes, RFID tags, or manual serial numbers. Operators scan these to locate entities.</p>
        {formData.expectedIdentifiers.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg mb-3">
            <p className="text-sm text-slate-400">No identifiers yet. Common examples:</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full">QR — Equipment QR Code</span>
              <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full">BARCODE — Asset Tag</span>
              <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full">RFID — Proximity Badge</span>
              <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full">MANUAL — Serial Number</span>
            </div>
          </div>
        )}
        {formData.expectedIdentifiers.map((ident, idx) => (
          <IdentifierRow
            key={idx}
            ident={ident}
            idx={idx}
            onUpdate={onUpdateIdentifier}
            onRemove={onRemoveIdentifier}
          />
        ))}
        <Button variant="outline" size="sm" onClick={onAddIdentifier} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Identifier
        </Button>
      </CollapsibleSection>

      {/* Section 5: Alarm Rules */}
      <CollapsibleSection title="Alarm Rules" count={formData.alarmRules.length}>
        <p className="text-xs text-slate-500 -mt-1 mb-3">Configure threshold-based alerts on telemetry data. Alarms trigger when values exceed limits and notify specified roles. Deadband prevents rapid on/off toggling.</p>
        {formData.alarmRules.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg mb-3">
            <p className="text-sm text-slate-400">No alarm rules yet. Example rules:</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">HIGH — Temperature {'>'} 85°C (WARNING)</span>
              <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">HIGH_HIGH — Temperature {'>'} 100°C (CRITICAL)</span>
              <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">LOW — Pressure {'<'} 10 PSI (ALARM)</span>
            </div>
          </div>
        )}
        {formData.alarmRules.map((rule, idx) => (
          <AlarmRuleRow
            key={idx}
            rule={rule}
            idx={idx}
            onUpdate={onUpdateAlarmRule}
            onRemove={onRemoveAlarmRule}
          />
        ))}
        <Button variant="outline" size="sm" onClick={onAddAlarmRule} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Alarm Rule
        </Button>
      </CollapsibleSection>

      {/* Section 6: Checklist Schema */}
      <CollapsibleSection title="Checklist Questions" count={formData.checklistSchema.length} defaultOpen={formData.checklistSchema.length > 0}>
        <p className="text-xs text-slate-500 -mt-1 mb-3">Define inspection and compliance questions operators must answer. Supports pass/fail, numeric readings, photos, signatures, calculated fields, and conditional logic.</p>
        {formData.checklistSchema.length === 0 && (
          <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg mb-3">
            <p className="text-sm text-slate-400">No checklist questions yet. Example questions:</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">PASS_FAIL — Equipment is clean?</span>
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">NUMERIC — Current pressure reading?</span>
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">PHOTO — Upload equipment photo</span>
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">SIGNATURE — Operator sign-off</span>
            </div>
          </div>
        )}
        {formData.checklistSchema.map((item, idx) => (
          <ChecklistItemRow
            key={idx}
            item={item}
            idx={idx}
            onUpdate={onUpdateChecklistItem}
            onRemove={onRemoveChecklistItem}
          />
        ))}
        <Button variant="outline" size="sm" onClick={onAddChecklistItem} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Checklist Question
        </Button>
      </CollapsibleSection>

      {/* Section 7: Transport & Connectivity */}
      <CollapsibleSection title="Transport & Connectivity" count={formData.dataIngestionEnabled ? 1 : 0} defaultOpen={formData.dataIngestionEnabled}>
        <div className="space-y-4">
          {/* Enable Data Ingestion Toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.dataIngestionEnabled}
              onChange={(e) => onFormChange({ dataIngestionEnabled: e.target.checked })}
              className="w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">Enable Data Ingestion</span>
              <p className="text-xs text-slate-500">Allow devices created from this template to send telemetry, attributes, and events</p>
            </div>
          </label>

          {formData.dataIngestionEnabled && (
            <div className="space-y-4 pl-2 border-l-2 border-purple-200">
              {/* Transport Protocol */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Transport Protocol</label>
                <div className="flex gap-3">
                  {TRANSPORT_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="transportType"
                        value={t}
                        checked={formData.transportType === t}
                        onChange={() => {
                          const updates: any = { transportType: t };
                          if (t !== 'MQTT' && formData.credentialType === 'X509') {
                            updates.credentialType = 'TOKEN';
                          }
                          onFormChange(updates);
                        }}
                        className="text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-slate-700">{t}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">Protocol used by devices to send data</p>
              </div>

              {/* Credential Type */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Credential Type</label>
                <Select
                  value={formData.credentialType}
                  onChange={(e) => onFormChange({ credentialType: e.target.value })}
                >
                  {CREDENTIAL_TYPES
                    .filter((c) => formData.transportType === 'MQTT' || c !== 'X509')
                    .map((c) => (
                    <option key={c} value={c}>{c === 'TOKEN' ? 'Access Token' : c === 'BASIC' ? 'Basic Auth' : 'X.509 Certificate'}</option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500 mt-1">How devices authenticate when connecting</p>
              </div>

              {/* Inactivity Timeout */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Inactivity Timeout (seconds)</label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.inactivityTimeout}
                    onChange={(e) => onFormChange({ inactivityTimeout: parseInt(e.target.value, 10) || 0 })}
                  />
                  <p className="text-xs text-slate-500 mt-1">Seconds before device is marked offline (0 = disabled)</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Max Data Rate (messages/window)</label>
                  <Input
                    type="number"
                    min={0}
                    value={formData.defaultMaxDataRate}
                    onChange={(e) => onFormChange({ defaultMaxDataRate: parseInt(e.target.value, 10) || 0 })}
                  />
                  <p className="text-xs text-slate-500 mt-1">Rate limit per device (0 = unlimited)</p>
                </div>
              </div>

              {/* Auto-Provision */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.autoProvision}
                  onChange={(e) => onFormChange({ autoProvision: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Auto-Provision Credentials</span>
                  <p className="text-xs text-slate-500">Automatically create device credentials when an entity is created from this template</p>
                </div>
              </label>

              {/* Default Rule Chain */}
              <RuleChainSelector
                value={formData.defaultRuleChainId}
                onChange={(id) => onFormChange({ defaultRuleChainId: id })}
              />
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
