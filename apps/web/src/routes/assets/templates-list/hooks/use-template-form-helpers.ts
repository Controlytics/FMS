import type { Dispatch, SetStateAction } from 'react';
import type { FormData } from '../../template-types';
import {
  emptyAttribute,
  emptyIdentifier,
  emptyTelemetry,
  emptyAlarmRule,
  emptyChecklistItem,
} from '../../template-types';

/**
 * Bundle of add/update/remove helpers for each schema array on the template
 * FormData. All closures use the functional setState form so they remain
 * stable for the lifetime of `setFormData`'s reference.
 *
 * Extracted verbatim from templates.tsx — no behavioural changes.
 */
export function useTemplateFormHelpers(setFormData: Dispatch<SetStateAction<FormData>>) {
  // -----------------------------------------------------------------------
  // Attribute schema helpers
  // -----------------------------------------------------------------------

  const addAttribute = () => {
    setFormData((prev) => ({
      ...prev,
      attributeSchema: [...prev.attributeSchema, emptyAttribute()],
    }));
  };

  const updateAttribute = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.attributeSchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, attributeSchema: updated };
    });
  };

  const removeAttribute = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      attributeSchema: prev.attributeSchema.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Telemetry helpers
  // -----------------------------------------------------------------------

  const addTelemetry = () => {
    setFormData((prev) => ({
      ...prev,
      telemetrySchema: [...prev.telemetrySchema, emptyTelemetry()],
    }));
  };

  const updateTelemetry = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.telemetrySchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, telemetrySchema: updated };
    });
  };

  const removeTelemetry = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      telemetrySchema: prev.telemetrySchema.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Identifier helpers
  // -----------------------------------------------------------------------

  const addIdentifier = () => {
    setFormData((prev) => ({
      ...prev,
      expectedIdentifiers: [...prev.expectedIdentifiers, emptyIdentifier()],
    }));
  };

  const updateIdentifier = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.expectedIdentifiers];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, expectedIdentifiers: updated };
    });
  };

  const removeIdentifier = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      expectedIdentifiers: prev.expectedIdentifiers.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Alarm rule helpers
  // -----------------------------------------------------------------------

  const addAlarmRule = () => {
    setFormData((prev) => ({
      ...prev,
      alarmRules: [...prev.alarmRules, emptyAlarmRule()],
    }));
  };

  const updateAlarmRule = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.alarmRules];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, alarmRules: updated };
    });
  };

  const removeAlarmRule = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      alarmRules: prev.alarmRules.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Checklist helpers
  // -----------------------------------------------------------------------

  const addChecklistItem = () => {
    setFormData((prev) => ({
      ...prev,
      checklistSchema: [...prev.checklistSchema, emptyChecklistItem()],
    }));
  };

  const updateChecklistItem = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.checklistSchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, checklistSchema: updated };
    });
  };

  const removeChecklistItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      checklistSchema: prev.checklistSchema.filter((_, i) => i !== index),
    }));
  };

  return {
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
  };
}
