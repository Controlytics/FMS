import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from './collapsible-section';
import { NumericConstraintsPanel } from './numeric-constraints-panel';
import type { FormData, AttributeDef, TelemetryDef, IdentifierDef, AlarmRuleDef, ChecklistItemDef } from '../template-types';
import {
  ICONS,
  ATTRIBUTE_DATA_TYPES,
  IDENTIFIER_TYPES,
  TELEMETRY_DATA_TYPES,
  ALARM_RULE_TYPES,
  ALARM_SEVERITIES,
  CHECKLIST_QUESTION_TYPES,
  TRANSPORT_TYPES,
  CREDENTIAL_TYPES,
} from '../template-types';
import useSWR from 'swr';

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

// ---------------------------------------------------------------------------
// Rule Chain Selector
// ---------------------------------------------------------------------------

function RuleChainSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useSWR<{ data: Array<{ id: string; name: string; description?: string; isActive: boolean }> }>(
    '/api/rule-chains',
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );
  const chains = data?.data?.filter((c) => c.isActive) ?? [];

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Default Rule Chain</label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None (no rule chain)</option>
        {chains.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </Select>
      <p className="text-xs text-slate-500 mt-1">
        Rule chain to process incoming data (telemetry, attributes, events). Handles filtering, alarms, and notifications.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-row components (keep rendering logic co-located with the form)
// ---------------------------------------------------------------------------

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function AttributeRow({ attr, idx, onUpdate, onRemove }: {
  attr: AttributeDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
          <Input
            value={attr.fieldName}
            onChange={(e) => onUpdate(idx, 'fieldName', e.target.value)}
            placeholder="e.g., serialNumber"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
          <Select
            value={attr.dataType}
            onChange={(e) => {
              onUpdate(idx, 'dataType', e.target.value);
              onUpdate(idx, 'defaultValue', '');
            }}
            selectSize="sm"
          >
            {ATTRIBUTE_DATA_TYPES.map((dt) => (
              <option key={dt} value={dt}>{dt}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
          <Input
            value={attr.unit}
            onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
            placeholder="e.g., kg, mm"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Default Value</label>
          <DefaultValueInput attr={attr} idx={idx} onUpdate={onUpdate} />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={attr.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
      {/* DROPDOWN options */}
      {attr.dataType === 'DROPDOWN' && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Options (comma-separated)</label>
          <textarea
            value={attr.options || ''}
            onChange={(e) => onUpdate(idx, 'options', e.target.value)}
            placeholder="Option1, Option2, Option3"
            rows={2}
            className="flex w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
      )}
      {/* Numeric constraints */}
      {(attr.dataType === 'INTEGER' || attr.dataType === 'FLOAT') && (
        <NumericConstraintsPanel
          enableConstraints={!!attr.enableConstraints}
          min={attr.min ?? ''}
          max={attr.max ?? ''}
          resolution={attr.resolution ?? ''}
          dataType={attr.dataType as 'INTEGER' | 'FLOAT'}
          onChange={(field, value) => onUpdate(idx, field, value)}
        />
      )}
    </div>
  );
}

function DefaultValueInput({ attr, idx, onUpdate }: {
  attr: AttributeDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
}) {
  if (attr.dataType === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 cursor-pointer h-8">
        <input
          type="checkbox"
          checked={attr.defaultValue === 'true'}
          onChange={(e) => onUpdate(idx, 'defaultValue', e.target.checked ? 'true' : 'false')}
          className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
        />
        <span className="text-xs text-slate-600">{attr.defaultValue === 'true' ? 'Yes' : 'No'}</span>
      </label>
    );
  }
  if (attr.dataType === 'INTEGER') {
    return (
      <Input
        type="text"
        inputMode="numeric"
        value={attr.defaultValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || v === '-') { onUpdate(idx, 'defaultValue', v); return; }
          if (/^-?\d+$/.test(v)) onUpdate(idx, 'defaultValue', v);
        }}
        placeholder="e.g., 0 (whole numbers only)"
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'FLOAT') {
    return (
      <Input
        type="text"
        inputMode="decimal"
        value={attr.defaultValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || v === '-' || v === '.' || v === '-.') { onUpdate(idx, 'defaultValue', v); return; }
          if (/^-?\d*\.?\d*$/.test(v)) onUpdate(idx, 'defaultValue', v);
        }}
        onBlur={() => {
          const v = attr.defaultValue;
          if (v !== '' && /^-?\d+$/.test(v)) onUpdate(idx, 'defaultValue', v + '.0');
        }}
        placeholder="e.g., 0.0 (decimal numbers)"
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DATE') {
    return (
      <Input
        type="date"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DATETIME') {
    return (
      <Input
        type="datetime-local"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DROPDOWN') {
    return (
      <Select
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        selectSize="sm"
      >
        <option value="">No default</option>
        {(attr.options ? attr.options.split(',').map(o => o.trim()).filter(Boolean) : []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }
  if (attr.dataType === 'URL') {
    return (
      <Input
        type="url"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        placeholder="https://..."
        className="h-8 text-xs"
      />
    );
  }
  // TEXT, FILE, or fallback
  return (
    <Input
      type="text"
      value={attr.defaultValue}
      onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
      placeholder="Default"
      className="h-8 text-xs"
    />
  );
}

function TelemetryRow({ tel, idx, onUpdate, onRemove }: {
  tel: TelemetryDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-4 gap-3 pr-8">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
          <Input
            value={tel.fieldName}
            onChange={(e) => onUpdate(idx, 'fieldName', e.target.value)}
            placeholder="e.g. temperature"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
          <Select
            value={tel.dataType}
            onChange={(e) => onUpdate(idx, 'dataType', e.target.value)}
            selectSize="sm"
          >
            {TELEMETRY_DATA_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
          <Input
            value={tel.unit}
            onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
            placeholder="e.g. \u00b0C, psi, %"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Description</label>
          <Input
            value={tel.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            placeholder="Optional description"
            className="text-xs"
          />
        </div>
      </div>
    </div>
  );
}

function IdentifierRow({ ident, idx, onUpdate, onRemove }: {
  ident: IdentifierDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Identifier Type</label>
          <Select
            value={ident.identifierType}
            onChange={(e) => onUpdate(idx, 'identifierType', e.target.value)}
            selectSize="sm"
          >
            {IDENTIFIER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Label</label>
          <Input
            value={ident.label}
            onChange={(e) => onUpdate(idx, 'label', e.target.value)}
            placeholder="e.g., Equipment QR Code"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ident.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
    </div>
  );
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  PASS_FAIL: 'Pass / Fail',
  YES_NO: 'Yes / No',
  YES_NO_NA: 'Yes / No / N/A',
  MCQ: 'Multiple Choice (Single)',
  MULTI_SELECT: 'Multiple Choice (Multi)',
  TEXT: 'Free Text',
  NUMERIC: 'Numeric',
  DROPDOWN: 'Dropdown',
  PHOTO: 'Photo / Evidence',
  DATE_TIME: 'Date / Time',
  SIGNATURE: 'Signature',
  YES_NO_COMMENT: 'Yes / No + Comment',
  CALCULATED: 'Calculated Field',
  CONDITIONAL: 'Conditional',
};

function ChecklistItemRow({ item, idx, onUpdate, onRemove }: {
  item: ChecklistItemDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const needsOptions = ['MCQ', 'MULTI_SELECT', 'DROPDOWN'].includes(item.questionType);
  const needsNumeric = item.questionType === 'NUMERIC';
  const needsPassCriteria = item.questionType === 'PASS_FAIL';
  const needsCalculated = item.questionType === 'CALCULATED';
  const needsConditional = item.questionType === 'CONDITIONAL';

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="col-span-2 space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Question *</label>
          <Input
            value={item.question}
            onChange={(e) => onUpdate(idx, 'question', e.target.value)}
            placeholder="e.g., Is the equipment clean?"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
          <Select
            value={item.questionType}
            onChange={(e) => onUpdate(idx, 'questionType', e.target.value)}
            selectSize="sm"
          >
            {CHECKLIST_QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{QUESTION_TYPE_LABELS[t] || t}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Section</label>
          <Input
            value={item.section}
            onChange={(e) => onUpdate(idx, 'section', e.target.value)}
            placeholder="e.g., Pre-Operation Checks"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Description / Help</label>
          <Input
            value={item.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            placeholder="Help text for the operator"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
      {/* Options for MCQ / MULTI_SELECT / DROPDOWN */}
      {needsOptions && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Options (comma-separated)</label>
          <textarea
            value={item.options || ''}
            onChange={(e) => onUpdate(idx, 'options', e.target.value)}
            placeholder="Option1, Option2, Option3"
            rows={2}
            className="flex w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
      )}
      {/* Pass criteria */}
      {needsPassCriteria && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Pass Criteria</label>
          <Input
            value={item.passCriteria}
            onChange={(e) => onUpdate(idx, 'passCriteria', e.target.value)}
            placeholder="e.g., No visible contamination"
            className="h-8 text-xs"
          />
        </div>
      )}
      {/* Numeric constraints */}
      {needsNumeric && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
            <Input
              value={item.numericUnit}
              onChange={(e) => onUpdate(idx, 'numericUnit', e.target.value)}
              placeholder="e.g., °C, PSI"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Min</label>
            <Input
              type="number"
              value={item.numericMin}
              onChange={(e) => onUpdate(idx, 'numericMin', e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Min value"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max</label>
            <Input
              type="number"
              value={item.numericMax}
              onChange={(e) => onUpdate(idx, 'numericMax', e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Max value"
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}
      {/* Calculated expression */}
      {needsCalculated && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Calculated Expression</label>
          <Input
            value={item.calculatedExpression}
            onChange={(e) => onUpdate(idx, 'calculatedExpression', e.target.value)}
            placeholder="e.g., {field1} + {field2}"
            className="h-8 text-xs"
          />
        </div>
      )}
      {/* Conditional logic */}
      {needsConditional && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Depends On (Question)</label>
            <Input
              value={item.conditionalField}
              onChange={(e) => onUpdate(idx, 'conditionalField', e.target.value)}
              placeholder="e.g., Is equipment clean?"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Show When Value Is</label>
            <Input
              value={item.conditionalValue}
              onChange={(e) => onUpdate(idx, 'conditionalValue', e.target.value)}
              placeholder="e.g., No, Fail"
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AlarmRuleRow({ rule, idx, onUpdate, onRemove }: {
  rule: AlarmRuleDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Rule Name *</label>
          <Input
            value={rule.name}
            onChange={(e) => onUpdate(idx, 'name', e.target.value)}
            placeholder="e.g., High Temperature"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
          <select
            value={rule.type}
            onChange={(e) => onUpdate(idx, 'type', e.target.value)}
            className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
          >
            {ALARM_RULE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Severity</label>
          <select
            value={rule.severity}
            onChange={(e) => onUpdate(idx, 'severity', e.target.value)}
            className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
          >
            {ALARM_SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Source Field</label>
          <Input
            value={rule.sourceField}
            onChange={(e) => onUpdate(idx, 'sourceField', e.target.value)}
            placeholder="e.g., Temperature, Recording Status"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Threshold</label>
          <Input
            type="number"
            value={rule.threshold}
            onChange={(e) => onUpdate(idx, 'threshold', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="e.g., 85"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Deadband</label>
          <Input
            type="number"
            value={rule.deadband}
            onChange={(e) => onUpdate(idx, 'deadband', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Hysteresis value"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Condition / Expression</label>
          <Input
            value={rule.condition}
            onChange={(e) => onUpdate(idx, 'condition', e.target.value)}
            placeholder="e.g., > 85.0, = Off, custom expression"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Message Template</label>
          <Input
            value={rule.message}
            onChange={(e) => onUpdate(idx, 'message', e.target.value)}
            placeholder="e.g., Temperature exceeded {threshold} for {entity.name}"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Notify Roles (comma-separated)</label>
          <Input
            value={rule.notifyRoles}
            onChange={(e) => onUpdate(idx, 'notifyRoles', e.target.value)}
            placeholder="e.g., SUPERVISOR, ADMIN"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onUpdate(idx, 'enabled', e.target.checked)}
              className="rounded border-slate-300"
            />
            Enabled
          </label>
        </div>
      </div>
    </div>
  );
}
