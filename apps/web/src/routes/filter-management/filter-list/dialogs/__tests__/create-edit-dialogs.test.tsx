import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { usePageTestLifecycle } from '../../../__tests__/fm-test-kit';
import { CreateHierarchyDialog } from '../CreateHierarchyDialog';
import { CreateFilterDialog } from '../CreateFilterDialog';
import { EditFilterDialog, type EditFilterSuperAdminProps } from '../EditFilterDialog';
import { FilterFieldOptionsSection, type FilterFieldOptions } from '../../components/FilterFieldOptionsSection';
import type { CreateDialogState, TemplateField } from '../../types';
import type { LastCleaningDateState } from '../../lib/lastCleaningDateState';

usePageTestLifecycle();

const OPTS: FilterFieldOptions = { ahuType: ['Supply', 'Return'], filterType: ['HEPA', 'Pre'], micronSize: ['0.3', '10'], filterSize: [] };
const NO_OPTS: FilterFieldOptions = { ahuType: [], filterType: [], micronSize: [], filterSize: [] };

describe('CreateHierarchyDialog', () => {
  const SCHEMA: TemplateField[] = [
    { fieldName: 'airFlow', dataType: 'FLOAT', unit: 'CFM', required: true },
    { fieldName: 'zone_class', dataType: 'DROPDOWN', dropdownOptions: ['ISO 5', 'ISO 7'] },
    { fieldName: 'isCritical', dataType: 'BOOLEAN' },
    { fieldName: 'installedOn', dataType: 'DATE' },
    { fieldName: 'filterCount', dataType: 'INTEGER' },
    { fieldName: 'notes', dataType: 'STRING' },
    { fieldName: 'legacyChoice', dataType: 'DROPDOWN' },
  ];

  function Harness({ dialog, schema = SCHEMA, creating = false, onSubmit = vi.fn(), onCancel = vi.fn(), seen }: {
    dialog: CreateDialogState; schema?: TemplateField[]; creating?: boolean; onSubmit?: () => void; onCancel?: () => void; seen?: (a: Record<string, string>) => void;
  }) {
    const [name, setName] = useState('');
    const [attrs, setAttrs] = useState<Record<string, string>>({});
    seen?.(attrs);
    return <CreateHierarchyDialog dialog={dialog} name={name} attrs={attrs} schema={schema} creating={creating}
      onNameChange={setName} onAttrChange={setAttrs} onCancel={onCancel} onSubmit={onSubmit} />;
  }

  it('block: no parent line; the name is required before Create', () => {
    const onSubmit = vi.fn();
    render(<Harness dialog={{ type: 'block' }} schema={[]} onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Create Block' })).toBeInTheDocument();
    expect(screen.queryByText(/^Under /)).toBeNull();
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter block name...'), { target: { value: 'Block C' } });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('area under a block: shows the parent; Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<Harness dialog={{ type: 'area', parentId: 'b1', parentName: 'Block A' }} schema={[]} onCancel={onCancel} />);
    expect(screen.getByRole('heading', { name: 'Create Area' })).toBeInTheDocument();
    expect(screen.getByText('Under Block A')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter area name...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ahu with a template schema: one control per field type, labels humanised, units + required marks; values flow into attrs', () => {
    let latest: Record<string, string> = {};
    render(<Harness dialog={{ type: 'ahu', parentId: 'ar1', parentName: 'Area 1' }} seen={(a) => { latest = a; }} />);
    expect(screen.getByRole('heading', { name: 'Create AHU' })).toBeInTheDocument();
    // labels: camelCase -> spaced, snake_case -> spaced, unit in parens, required star
    const air = screen.getByText('air Flow').closest('label')!;
    expect(air).toHaveTextContent('air Flow (CFM) *');
    expect(screen.getByText('zone class')).toBeInTheDocument();

    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs).toHaveLength(2); // FLOAT + INTEGER
    expect(numberInputs[0]).toHaveAttribute('step', 'any');
    expect(numberInputs[1]).not.toHaveAttribute('step');
    fireEvent.change(numberInputs[0], { target: { value: '1200.5' } });
    fireEvent.change(numberInputs[1], { target: { value: '4' } });

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3); // DROPDOWN, BOOLEAN, DROPDOWN without options
    expect(within(selects[0]).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select...', 'ISO 5', 'ISO 7']);
    expect(within(selects[1]).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select...', 'Yes', 'No']);
    expect(within(selects[2]).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select...']);
    fireEvent.change(selects[0], { target: { value: 'ISO 7' } });
    fireEvent.change(selects[1], { target: { value: 'false' } });

    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByPlaceholderText('notes'), { target: { value: 'North wing' } });

    expect(latest).toEqual({ airFlow: '1200.5', filterCount: '4', zone_class: 'ISO 7', isCritical: 'false', installedOn: '2026-10-01', notes: 'North wing' });
  });

  it('while creating, the button is disabled and reads "Creating..."', () => {
    render(<Harness dialog={{ type: 'area' }} schema={[]} creating />);
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
  });
});

describe('FilterFieldOptionsSection', () => {
  function Harness({ options = OPTS, initialLc = { na: false, date: '' } as LastCleaningDateState, spy = vi.fn() }) {
    const [v, setV] = useState({ ahuType: '', filterType: '', micronSize: '', filterSize: '' });
    const [lc, setLc] = useState(initialLc);
    spy({ ...v, lc });
    return <FilterFieldOptionsSection options={options} {...v} lastCleaning={lc}
      onAhuTypeChange={(x) => setV((p) => ({ ...p, ahuType: x }))}
      onFilterTypeChange={(x) => setV((p) => ({ ...p, filterType: x }))}
      onMicronSizeChange={(x) => setV((p) => ({ ...p, micronSize: x }))}
      onFilterSizeChange={(x) => setV((p) => ({ ...p, filterSize: x }))}
      onLastCleaningChange={setLc} />;
  }

  it('offers the configured options and reports each choice', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const [ahuType, filterType, micron] = screen.getAllByRole('combobox');
    expect(within(ahuType).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select…', 'Supply', 'Return']);
    fireEvent.change(ahuType, { target: { value: 'Return' } });
    fireEvent.change(filterType, { target: { value: 'HEPA' } });
    fireEvent.change(micron, { target: { value: '0.3' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 610×610×292mm'), { target: { value: '610x610x292' } });
    expect(spy).toHaveBeenLastCalledWith({ ahuType: 'Return', filterType: 'HEPA', micronSize: '0.3', filterSize: '610x610x292', lc: { na: false, date: '' } });
  });

  it('with no master data each dropdown says where to configure it', () => {
    render(<Harness options={NO_OPTS} />);
    expect(screen.getAllByRole('option', { name: 'No options — configure in Settings' })).toHaveLength(3);
  });

  it('Last cleaning date: ticking NA clears + disables the date; unticking re-enables with the date still blank', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} initialLc={{ na: false, date: '' }} />);
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-09-30' } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ lc: { na: false, date: '2026-09-30' } }));
    const na = screen.getByRole('checkbox', { name: 'NA' });
    fireEvent.click(na);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ lc: { na: true, date: '' } }));
    expect(date).toBeDisabled();
    fireEvent.click(na);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ lc: { na: false, date: '' } }));
    expect(date).toBeEnabled();
  });
});

describe('CreateFilterDialog', () => {
  const AHUS = [{ id: 'a1', name: 'AHU-1' }, { id: 'a2', name: 'AHU-2' }];
  function Harness({ areas = [] as { id: string; name: string }[], error = '', submitting = false, onSubmit = vi.fn(), onClose = vi.fn(), spy = vi.fn() }) {
    const [s, setS] = useState({ ahu: '', area: '', name: '', filterSet: 'A' as 'A' | 'B', ahuType: '', filterType: '', micronSize: '', filterSize: '' });
    const [lc, setLc] = useState<LastCleaningDateState>({ na: false, date: '' });
    spy(s);
    const set = (k: keyof typeof s) => (v: any) => setS((p) => ({ ...p, [k]: v }));
    return <CreateFilterDialog {...s} ahus={AHUS} areas={areas} error={error} submitting={submitting} fieldOptions={OPTS} lastCleaning={lc}
      onAhuChange={set('ahu')} onAreaChange={set('area')} onNameChange={set('name')} onFilterSetChange={set('filterSet')}
      onAhuTypeChange={set('ahuType')} onFilterTypeChange={set('filterType')} onMicronSizeChange={set('micronSize')} onFilterSizeChange={set('filterSize')}
      onLastCleaningChange={setLc} onClose={onClose} onSubmit={onSubmit} />;
  }

  it('needs an AHU AND a name before Create; Set B can be chosen', () => {
    const onSubmit = vi.fn(); const spy = vi.fn();
    render(<Harness onSubmit={onSubmit} spy={spy} />);
    expect(screen.getByRole('heading', { name: 'Create Filter' })).toBeInTheDocument();
    expect(screen.queryByText('All / Any')).toBeNull(); // no area picker when the block has no areas
    const create = screen.getByRole('button', { name: 'Create Filter' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: 'Pre-Filter-01' } });
    expect(create).toBeDisabled(); // still no AHU
    const ahuSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(ahuSelect, { target: { value: 'a2' } });
    expect(create).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Set B' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ ahu: 'a2', name: 'Pre-Filter-01', filterSet: 'B' }));
    expect(screen.getByRole('button', { name: 'Set B' }).className).toContain('bg-cyan-600');
    expect(screen.getByRole('button', { name: 'Set A' }).className).not.toContain('bg-cyan-600');
    fireEvent.click(create);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a whitespace-only name is not accepted', () => {
    render(<Harness />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'a1' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Create Filter' })).toBeDisabled();
  });

  it('when the block has areas, an optional Area picker comes first', () => {
    const spy = vi.fn();
    render(<Harness areas={[{ id: 'ar1', name: 'Area North' }]} spy={spy} />);
    const [areaSel, ahuSel] = screen.getAllByRole('combobox');
    expect(within(areaSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['All / Any', 'Area North']);
    expect(within(ahuSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select AHU...', 'AHU-1', 'AHU-2']);
    fireEvent.change(areaSel, { target: { value: 'ar1' } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ area: 'ar1' }));
  });

  it('shows the server error and the creating state; X and Cancel close', () => {
    const onClose = vi.fn();
    render(<Harness error="A filter with this name already exists" submitting onClose={onClose} />);
    expect(screen.getByText('A filter with this name already exists')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('EditFilterDialog', () => {
  const noop = () => {};
  const base = {
    error: '', submitting: false, fieldOptions: OPTS, ahuType: 'Supply', filterType: 'HEPA', micronSize: '0.3', filterSize: '610',
    lastCleaning: { na: true, date: '' } as LastCleaningDateState,
    onAhuTypeChange: noop, onFilterTypeChange: noop, onMicronSizeChange: noop, onFilterSizeChange: noop, onLastCleaningChange: noop,
  };

  function Plain({ onSubmit = vi.fn(), onClose = vi.fn(), filterSet = 'A' as 'A' | 'B' | '' }) {
    const [name, setName] = useState('FLT-001');
    const [set, setSet] = useState(filterSet);
    return <EditFilterDialog {...base} name={name} filterSet={set} onNameChange={setName} onFilterSetChange={setSet} onClose={onClose} onSubmit={onSubmit} />;
  }

  it('FILTER_EDIT dialog (no superAdmin): name, set and field details only', () => {
    const onSubmit = vi.fn();
    render(<Plain onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Edit Filter' })).toBeInTheDocument();
    expect(screen.getByText('Update filter name, set, and field details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'None' })).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('RFID tag')).toBeNull();
    expect(screen.queryByText(/Reason for this change/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set B' }));
    expect(screen.getByRole('button', { name: 'Set B' }).className).toContain('bg-amber-500');
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute('title');
    const nameInput = screen.getByDisplayValue('FLT-001');
    fireEvent.change(nameInput, { target: { value: ' ' } });
    expect(save).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: 'FLT-001A' } });
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a filter with no set highlights neither button', () => {
    render(<Plain filterSet="" />);
    expect(screen.getByRole('button', { name: 'Set A' }).className).not.toContain('bg-amber-500');
    expect(screen.getByRole('button', { name: 'Set B' }).className).not.toContain('bg-amber-500');
  });

  it('shows a server error and the saving state; X and Cancel close', () => {
    const onClose = vi.fn();
    render(<EditFilterDialog {...base} name="FLT-001" filterSet="A" error="Name taken" submitting onNameChange={noop} onFilterSetChange={noop} onClose={onClose} onSubmit={noop} />);
    expect(screen.getByText('Name taken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  function SuperAdmin({ showHierarchy = true, ahuId = 'a1', onSubmit = vi.fn(), spy = vi.fn() }) {
    const [name, setName] = useState('FLT-001');
    const [filterSet, setFilterSet] = useState<'A' | 'B' | ''>('A');
    const [s, setS] = useState({ areaId: '', ahuId, lifecycleState: 'WASH_IN', cleaningReasonKey: '', rfid: 'E200AA', reason: '' });
    spy({ ...s, filterSet });
    const set = (k: keyof typeof s) => (v: string) => setS((p) => ({ ...p, [k]: v }));
    const sa: EditFilterSuperAdminProps = {
      showHierarchy, areaOptions: [{ id: 'ar1', name: 'Area North' }], ahuOptions: [{ id: 'a1', name: 'AHU-1' }, { id: 'a2', name: 'AHU-2' }],
      areaId: s.areaId, ahuId: s.ahuId, onAreaChange: set('areaId'), onAhuChange: set('ahuId'),
      lifecycleOptions: [{ value: 'WASH_IN', label: 'Wash In' }, { value: 'DRY_IN', label: 'Dry In' }],
      lifecycleState: s.lifecycleState, currentLifecycleState: 'WASH_IN', onLifecycleChange: set('lifecycleState'),
      cleaningReasons: [{ key: 'PM', name: 'Preventive Maintenance' }, { key: 'BD', name: 'Breakdown' }],
      cleaningReasonKey: s.cleaningReasonKey, onCleaningReasonChange: set('cleaningReasonKey'),
      rfid: s.rfid, onRfidChange: set('rfid'), reason: s.reason, onReasonChange: set('reason'),
      onClearFilterSet: () => setFilterSet(''),
    };
    return <EditFilterDialog {...base} name={name} filterSet={filterSet} onNameChange={setName} onFilterSetChange={setFilterSet}
      onClose={noop} onSubmit={onSubmit} superAdmin={sa} />;
  }

  it('SUPER_ADMIN: every field is offered and a reason of ≥5 chars is required', () => {
    const onSubmit = vi.fn(); const spy = vi.fn();
    render(<SuperAdmin onSubmit={onSubmit} spy={spy} />);
    expect(screen.getByRole('heading', { name: 'Edit Filter (Super Admin)' })).toBeInTheDocument();
    expect(screen.getByText(/recorded in the audit trail/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Enter a reason of at least 5 characters');
    const reason = screen.getByPlaceholderText(/At least 5 characters/);
    fireEvent.change(reason, { target: { value: 'typo' } });
    expect(save).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'Fix AHU link' } });
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute('title');

    // hierarchy pickers
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'ar1' } });
    fireEvent.change(selects[1], { target: { value: 'a2' } });
    // RFID
    fireEvent.change(screen.getByPlaceholderText('Blank = no tag'), { target: { value: 'E200BB' } });
    // None clears the set
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'None' }).className).toContain('bg-slate-600');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ areaId: 'ar1', ahuId: 'a2', rfid: 'E200BB', filterSet: '', reason: 'Fix AHU link' }));
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('SUPER_ADMIN: the cleaning-reason picker appears only when the status is changed', () => {
    const spy = vi.fn();
    render(<SuperAdmin spy={spy} />);
    expect(screen.queryByText(/Cleaning reason \(if this move starts a cycle\)/)).toBeNull();
    const status = screen.getAllByRole('combobox').find((s) => within(s).queryByRole('option', { name: '-- no cleaning status --' }))!;
    fireEvent.change(status, { target: { value: 'DRY_IN' } });
    expect(screen.getByText(/Cleaning reason \(if this move starts a cycle\)/)).toBeInTheDocument();
    const reasonSel = screen.getAllByRole('combobox').find((s) => within(s).queryByRole('option', { name: 'Breakdown' }))!;
    fireEvent.change(reasonSel, { target: { value: 'BD' } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ lifecycleState: 'DRY_IN', cleaningReasonKey: 'BD' }));
  });

  it('SUPER_ADMIN: with hierarchy shown, an AHU must be chosen; a retired filter hides the pickers', () => {
    const { unmount } = render(<SuperAdmin ahuId="" />);
    fireEvent.change(screen.getByPlaceholderText(/At least 5 characters/), { target: { value: 'Long enough' } });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(screen.getByRole('option', { name: '-- select AHU --' })).toBeInTheDocument();
    unmount();
    render(<SuperAdmin ahuId="" showHierarchy={false} />);
    expect(screen.queryByRole('option', { name: '-- select AHU --' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/At least 5 characters/), { target: { value: 'Long enough' } });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });
});
