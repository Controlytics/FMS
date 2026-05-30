// Single source for the concrete Filter field-option master data. Per the
// A-01 direction (D2=A), filter fields come from the runtime
// `filter-field-options` config — NOT the asset-template attributeSchema.
// Used by single-create (Slice 1) and bulk upload (Slice 2).
import { prisma } from '../../../lib/prisma.js';

export interface FilterFieldOptions {
  ahuType: string[];
  filterType: string[];
  micronSize: string[];
}

export interface FilterFieldInput {
  ahuType?: string | null;
  filterType?: string | null;
  micronSize?: string | null;
  lastCleaningDate?: string | null; // 'NA' | 'YYYY-MM-DD' | '' | null
}

export interface FilterFieldError { field: string; value: string; message: string; }
export interface FilterFieldResult { attributes: Record<string, unknown>; errors: FilterFieldError[]; }

// Reads the same config row the web app reads via GET /api/filters/field-options.
export async function loadFilterFieldOptions(): Promise<FilterFieldOptions> {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-field-options' } });
  const stored = row?.configValue as { value?: Record<string, unknown> } | undefined;
  const inner = (stored && typeof stored === 'object' && 'value' in stored ? stored.value : {}) ?? {};
  return {
    ahuType: Array.isArray((inner as any).ahuType) ? ((inner as any).ahuType as string[]) : ['Process', 'Non Process'],
    filterType: Array.isArray((inner as any).filterType) ? ((inner as any).filterType as string[]) : [],
    micronSize: Array.isArray((inner as any).micronSize) ? ((inner as any).micronSize as string[]) : [],
  };
}

// Resolves the FILTER-kind template id/version for the unavoidable
// asset_instances.template_id FK. NOT a field source — attributeSchema is
// ignored. Same value the web single-create posts as `filterTemplateId`.
export async function resolveFilterTemplateRef(): Promise<{ id: string; version: number } | null> {
  const t = await prisma.assetTemplate.findFirst({
    where: { templateKind: 'FILTER', isActive: true },
    select: { id: true, version: true },
    orderBy: { createdAt: 'asc' },
  });
  return t ? { id: t.id, version: t.version } : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Optional-but-validated, mirroring single-create (no asterisk there): a blank
// field is omitted; a present field must be in the live master-data list.
export async function validateAndBuildFilterAttributes(input: FilterFieldInput): Promise<FilterFieldResult> {
  const opts = await loadFilterFieldOptions();
  const attributes: Record<string, unknown> = {};
  const errors: FilterFieldError[] = [];

  const checkList = (field: 'ahuType' | 'filterType' | 'micronSize', list: string[]) => {
    const raw = (input[field] ?? '').toString().trim();
    if (!raw) return;
    const match = list.find((o) => o.toLowerCase() === raw.toLowerCase());
    if (!match) errors.push({ field, value: raw, message: `must be one of: ${list.join(', ')}` });
    else attributes[field] = match;
  };
  checkList('ahuType', opts.ahuType);
  checkList('filterType', opts.filterType);
  checkList('micronSize', opts.micronSize);

  const lcd = (input.lastCleaningDate ?? '').toString().trim();
  if (lcd) {
    if (lcd.toUpperCase() === 'NA') attributes.lastCleaningDate = 'NA';
    else if (ISO_DATE.test(lcd) && !Number.isNaN(Date.parse(lcd))) attributes.lastCleaningDate = lcd;
    else errors.push({ field: 'lastCleaningDate', value: lcd, message: 'must be a date (YYYY-MM-DD) or NA' });
  }

  return { attributes, errors };
}
