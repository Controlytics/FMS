import { describe, it, expect } from 'vitest';
import { equipmentGroupChoice, groupHasStageInstruments } from '../equipment-group-choice';

const A = { id: 'ga', name: 'Bay A', instruments: [{ id: 'i1', stageKey: 'WASH_IN' }] };
const B = { id: 'gb', name: 'Bay B', instruments: [{ id: 'i2', stageKey: 'DRY_IN' }] };

describe('equipmentGroupChoice', () => {
  it('a bound cycle uses its group, never a choice — even when a stale row still lists two', () => {
    expect(equipmentGroupChoice({ currentCycle: { equipmentGroupId: 'gb' }, equipmentGroup: B, blockEquipmentGroups: [A, B] }))
      .toEqual({ needsChoice: false, group: B, groups: [B] });
  });

  it('unbound with two listed: the operator picks, the oldest (equipmentGroup) is NOT preselected', () => {
    expect(equipmentGroupChoice({ currentCycle: { equipmentGroupId: null }, equipmentGroup: A, blockEquipmentGroups: [A, B] }))
      .toEqual({ needsChoice: true, group: null, groups: [A, B] });
  });

  it('unbound with one listed: that group, no choice', () => {
    expect(equipmentGroupChoice({ currentCycle: {}, equipmentGroup: A, blockEquipmentGroups: [A] }))
      .toEqual({ needsChoice: false, group: A, groups: [A] });
  });

  it('none listed: a fallback of several → the operator picks; otherwise the state\'s group as before, or the fallback\'s only one', () => {
    const legacy = { currentCycle: { equipmentGroupId: null }, equipmentGroup: A };
    expect(equipmentGroupChoice(legacy, [A, B])).toEqual({ needsChoice: true, group: null, groups: [A, B] });
    expect(equipmentGroupChoice(legacy, [B])).toEqual({ needsChoice: false, group: A, groups: [A] });
    expect(equipmentGroupChoice({ currentCycle: {} }, [B])).toEqual({ needsChoice: false, group: B, groups: [B] });
    expect(equipmentGroupChoice(legacy)).toEqual({ needsChoice: false, group: A, groups: [A] });
    expect(equipmentGroupChoice({ currentCycle: null })).toEqual({ needsChoice: false, group: null, groups: [] });
    expect(equipmentGroupChoice(null, [A])).toEqual({ needsChoice: false, group: A, groups: [A] });
  });

  it('a listed block wins over the fallback', () => {
    expect(equipmentGroupChoice({ blockEquipmentGroups: [A] }, [A, B])).toEqual({ needsChoice: false, group: A, groups: [A] });
  });
});

describe('groupHasStageInstruments', () => {
  it('looks at the instruments of the stage only', () => {
    expect(groupHasStageInstruments(A, 'WASH_IN')).toBe(true);
    expect(groupHasStageInstruments(A, 'DRY_IN')).toBe(false);
    expect(groupHasStageInstruments(null, 'DRY_IN')).toBe(false);
  });
});
