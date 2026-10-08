// Bulk filter upload — A-01 Slice 2.
//
// Parses an .xlsx workbook (the template produced by
// filter-upload-template.service.ts) and creates one filter per data row using
// the SAME typed path single-create uses: the FILTER template is resolved
// internally, field-option values (ahuType/filterType/micronSize) are validated
// against the live filter-field-options config (NOT a template attributeSchema),
// and each row is created via instanceService.create (which writes the
// FilterDetails sidecar + fires the mirror trigger). No templateId / generic
// attributes are accepted from the file. Invalid cells are rejected with
// row + column + value + message.
import ExcelJS from 'exceljs';
import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';
import { AppError } from '../../../lib/errors.js';
import { filterService } from './filter.service.js';
import { instanceService } from './instance.service.js';
import { relationshipRepository } from '../repositories/relationship.repository.js';
import { validateAndBuildFilterAttributes } from './filter-fields.service.js';

export interface BulkResult {
  row: number;
  name: string;
  status: 'success' | 'error';
  id?: string;
  column?: string;
  value?: string;
  error?: string;
}

export interface BulkUploadOutcome {
  results: BulkResult[];
  created: number;
  failed: number;
  // Parsed display rows (dry-run preview). Present for validateOnly calls.
  rows?: Array<Record<string, string>>;
  // Areas / AHUs the upload creates (dry-run: WOULD create) because a row
  // named one that does not exist yet (2026-10-08).
  newAreas?: string[];
  newAhus?: string[];
}

/**
 * Where the upload was started from (2026-10-08). Exactly one level applies:
 *  - ahuId  → every filter goes into that AHU; the sheet carries no ahu/area.
 *  - areaId → each row names its AHU; AHUs are matched or CREATED in that area.
 *  - blockId only → each row names its AHU and optionally its Area; both are
 *    matched or CREATED in that block.
 */
export interface UploadScope {
  blockId?: string;
  areaId?: string;
  ahuId?: string;
}

interface ParsedRow {
  rowNumber: number; // 1-based spreadsheet row (header is row 1, first data row is 2)
  name: string;
  // Per-row AHU / Area. Deliberately NOT optional: a sheet without the column
  // must yield '' rather than undefined, or every .trim() below throws.
  area: string;
  ahu: string;
  filterSet: string;
  ahuType: string;
  filterType: string;
  micronSize: string;
  filterSize: string;
  lastCleaningDate: string;
}

// Header text → canonical key. Accepts the template headers plus a couple of
// friendly aliases for `name`.
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_ALIASES: Record<string, keyof Omit<ParsedRow, 'rowNumber'>> = {
  name: 'name', filtername: 'name', filterid: 'name',
  ahu: 'ahu', ahuname: 'ahu',
  area: 'area', areaname: 'area',
  filterset: 'filterSet',
  ahutype: 'ahuType',
  filtertype: 'filterType',
  micronsize: 'micronSize',
  filtersize: 'filterSize', filterdimensions: 'filterSize', dimensions: 'filterSize',
  lastcleaningdate: 'lastCleaningDate',
};

/** Name key for case/whitespace-insensitive matching ("AHU-01 " ≡ "ahu-01"). */
const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('').trim();
    if (typeof o.text === 'string') return o.text.trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(v).trim();
}

function parseWorkbook(buffer: Buffer): Promise<{ rows: ParsedRow[]; error?: string }> {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer as any).then(() => {
    const ws = wb.worksheets.find((w) => w.name === 'Filters' && w.state !== 'veryHidden') ?? wb.worksheets[0];
    if (!ws) return { rows: [], error: 'Workbook has no readable sheet' };

    // No row cap (2026-10-08, operator request). The 200-filter cap and the
    // VAPT-4 `rowCount > 260` pre-check are gone. The pre-check was also WRONG:
    // `rowCount` counts rows that carry only formatting, and our own template
    // puts a dropdown on 1000 rows — so every upload made from the downloaded
    // template, even a 20-row one, was refused as "Maximum 200". What still
    // bounds an upload is the 5 MB multipart limit (route answers 413).

    // Map each column number to a canonical key via the header row.
    const colKey: Record<number, keyof Omit<ParsedRow, 'rowNumber'>> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const key = HEADER_ALIASES[normalize(cellToString(cell.value))];
      if (key) colKey[col] = key;
    });
    if (!Object.values(colKey).includes('name')) {
      return { rows: [], error: 'Template is missing a "name" column' };
    }

    const rows: ParsedRow[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const r: ParsedRow = { rowNumber, name: '', area: '', ahu: '', filterSet: '', ahuType: '', filterType: '', micronSize: '', filterSize: '', lastCleaningDate: '' };
      let any = false;
      row.eachCell((cell, col) => {
        const key = colKey[col];
        if (!key) return;
        const val = cellToString(cell.value);
        (r as any)[key] = val;
        if (val) any = true;
      });
      if (any) rows.push(r);
    });
    return { rows };
  }).catch(() => ({ rows: [] as ParsedRow[], error: 'Invalid .xlsx file' }));
}

type Named = { id: string; name: string };
type AhuRow = Named & { areaId: string | null };

// Where a NEW AHU / Area is created. `newArea:<key>` = an area this same
// upload creates first.
type ParentKey = string; // 'block' | `area:<id>` | `newArea:<key>`

interface PlannedArea { key: string; name: string; rows: number[]; blocked?: string }
interface PlannedAhu { key: string; name: string; parent: ParentKey; rows: number[]; blocked?: string }

/**
 * Bulk-create filters from the .xlsx template (2026-10-08 rewrite).
 *
 * The scope decides where filters land — see UploadScope. In Area / Block
 * scope every row names its AHU (and, in Block scope, optionally its Area).
 * A name that matches an AHU / Area already in the block is used as-is; one
 * that does not is CREATED, through instanceService.create, so it gets the
 * same parent checks and its own ASSET_CREATED audit row as a Structure-view
 * create. Matching ignores case and extra spaces.
 *
 * Refused per row, never guessed:
 *  - an AHU that exists in this block under a DIFFERENT area than the row says
 *    (a blank area means "not specified", so it matches wherever the AHU is);
 *  - a name already used by any other active entity outside this block —
 *    entity names are unique site-wide (asset_instances_active_name_key);
 *  - creating an AHU / Area without hierarchy-create permission
 *    (`canCreateHierarchy`, decided by the route);
 *  - a parent that would exceed its template's max children.
 * Only an AHU / Area that a VALID filter row needs is created.
 */
export async function bulkUploadFilters(
  buffer: Buffer,
  scope: UploadScope,
  // Dialog-level fallback used when a row's filterSet cell is empty.
  defaultFilterSet: 'SET_A' | 'SET_B' | undefined,
  ctx: RequestContext,
  opts: { validateOnly?: boolean; canCreateHierarchy?: boolean } = {},
): Promise<BulkUploadOutcome> {
  const fail = (error: string): BulkUploadOutcome => ({ results: [{ row: 1, name: '', status: 'error', error }], created: 0, failed: 1 });
  const defaultWire: 'A' | 'B' | undefined = defaultFilterSet === 'SET_A' ? 'A' : defaultFilterSet === 'SET_B' ? 'B' : undefined;
  const canCreate = opts.canCreateHierarchy === true;

  // 1. Parse
  const parsed = await parseWorkbook(buffer);
  if (parsed.error) return fail(parsed.error);
  const rows = parsed.rows;
  if (rows.length === 0) return fail('No data rows found');

  // 2. Resolve the scope to (block, optional area, optional AHU).
  let blockId = scope.blockId || undefined;
  let scopeArea: Named | null = null;
  let scopeAhu: AhuRow | null = null;
  if (scope.ahuId) {
    const h = await prisma.ahu.findUnique({ where: { id: scope.ahuId }, select: { id: true, name: true, blockId: true, areaId: true, isActive: true } });
    if (!h || !h.isActive) return fail('AHU not found');
    let hb = h.blockId;
    if (!hb && h.areaId) hb = (await prisma.area.findUnique({ where: { id: h.areaId }, select: { blockId: true } }))?.blockId ?? null;
    if (blockId && hb && blockId !== hb) return fail(`AHU "${h.name}" is not in the selected block`);
    blockId = hb ?? blockId;
    scopeAhu = { id: h.id, name: h.name, areaId: h.areaId };
  } else if (scope.areaId) {
    const a = await prisma.area.findUnique({ where: { id: scope.areaId }, select: { id: true, name: true, blockId: true, isActive: true } });
    if (!a || !a.isActive) return fail('Area not found');
    if (blockId && blockId !== a.blockId) return fail(`Area "${a.name}" is not in the selected block`);
    blockId = a.blockId ?? undefined;
    scopeArea = { id: a.id, name: a.name };
  }
  if (!blockId) return fail('Choose the block, area or AHU to upload into');
  const block = await prisma.block.findUnique({ where: { id: blockId }, select: { id: true, name: true, isActive: true } });
  if (!block || !block.isActive) return fail('Block not found');
  const mode: 'block' | 'area' | 'ahu' = scopeAhu ? 'ahu' : scopeArea ? 'area' : 'block';

  // 3. What the block holds now (an AHU sits directly on the block OR in one of its areas).
  const blockAreas = await prisma.area.findMany({ where: { blockId, isActive: true }, select: { id: true, name: true } });
  const areaById = new Map(blockAreas.map(a => [a.id, a]));
  const areaByKey = new Map(blockAreas.map(a => [nameKey(a.name), a]));
  const blockAhus = await prisma.ahu.findMany({
    where: { isActive: true, OR: [{ blockId }, ...(blockAreas.length ? [{ areaId: { in: blockAreas.map(a => a.id) } }] : [])] },
    select: { id: true, name: true, areaId: true },
  });
  const ahuByKey = new Map(blockAhus.map(h => [nameKey(h.name), h]));
  const areaNameOf = (areaId: string | null) => (areaId ? areaById.get(areaId)?.name ?? '' : '');

  // 4. Names already taken site-wide (filters, AHUs, Areas, Blocks share one namespace).
  const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');
  const allNames = [...new Set(rows.flatMap(r => [r.name, r.ahu, r.area].map(collapse).filter(Boolean)))];
  const taken = allNames.length
    ? await prisma.assetInstance.findMany({
        where: { name: { in: allNames, mode: 'insensitive' }, isActive: true },
        select: { name: true, template: { select: { templateKind: true } } },
      })
    : [];
  const takenKind = new Map(taken.map(t => [nameKey(t.name), String((t as any).template?.templateKind ?? 'entity')]));
  const kindLabel = (k: string) => (k === 'AHU' ? 'an AHU' : k === 'AREA' ? 'an area' : k === 'BLOCK' ? 'a block' : k === 'FILTER' ? 'a filter' : 'another entity');
  const fileFilterKeys = new Set(rows.map(r => nameKey(r.name)).filter(Boolean));

  const needsCreate = rows.some(r => (r.ahu.trim() && !ahuByKey.has(nameKey(r.ahu))) || (mode === 'block' && r.area.trim() && !areaByKey.has(nameKey(r.area))));
  const templateIdOf = async (kind: 'AREA' | 'AHU') => (await prisma.assetTemplate.findFirst({
    where: { templateKind: kind, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
  }))?.id ?? null;
  const areaTemplateId = needsCreate && mode === 'block' ? await templateIdOf('AREA') : null;
  const ahuTemplateId = needsCreate && mode !== 'ahu' ? await templateIdOf('AHU') : null;

  const plannedAreas = new Map<string, PlannedArea>();
  const plannedAhus = new Map<string, PlannedAhu>();

  // Shared refusals for a name the upload would have to CREATE.
  const cannotCreate = (raw: string, kind: 'AREA' | 'AHU'): string | null => {
    const k = nameKey(raw);
    const what = kind === 'AHU' ? 'AHU' : 'area';
    if (takenKind.has(k)) {
      // e.g. an `area` cell naming an AHU of this block: same site-wide namespace.
      const where = ahuByKey.has(k) || areaByKey.has(k) ? 'in this block' : 'outside this block';
      return `"${raw}" is already used by ${kindLabel(takenKind.get(k)!)} ${where} — names are unique across the site`;
    }
    if (fileFilterKeys.has(k)) return `"${raw}" is also used as a filter name in this file`;
    if (!canCreate) return `${what === 'AHU' ? 'AHU' : 'Area'} "${raw}" does not exist in this block, and you do not have permission to create ${what}s. Create it first or ask an administrator.`;
    if (!(kind === 'AHU' ? ahuTemplateId : areaTemplateId)) return `No active ${what} template is configured — cannot create "${raw}"`;
    return null;
  };

  // 5. Validate every row → per-cell errors; plan the target AHU for clean rows.
  type RowPlan = {
    r: ParsedRow; name: string; errs: BulkResult[];
    ahuId?: string; newAhuKey?: string;
    ahuLabel: string; areaLabel: string; ahuNew: boolean; areaNew: boolean;
    filterSet?: 'A' | 'B';
  };
  const plans: RowPlan[] = [];
  const namesInBatch = new Set<string>();

  for (const r of rows) {
    const errs: BulkResult[] = [];
    const name = r.name.trim();
    const err = (column: string, value: string, error: string) => errs.push({ row: r.rowNumber, name, status: 'error', column, value, error });
    const ahuRaw = collapse(r.ahu);
    const areaRaw = collapse(r.area);
    const plan: RowPlan = { r, name, errs, ahuLabel: ahuRaw, areaLabel: areaRaw, ahuNew: false, areaNew: false };
    // Planned entities this row would add — committed only if the row is clean.
    let pendingArea: PlannedArea | null = null;
    let pendingAhu: PlannedAhu | null = null;

    if (!name) err('name', '', 'Filter Name is required');

    if (mode === 'ahu') {
      const h = scopeAhu!;
      plan.ahuId = h.id; plan.ahuLabel = h.name; plan.areaLabel = areaNameOf(h.areaId);
      // A stray value is an error, never silently overridden: the operator
      // may have opened another block's file.
      if (ahuRaw && nameKey(ahuRaw) !== nameKey(h.name)) err('ahu', r.ahu, `This upload goes into AHU "${h.name}", but the row names "${ahuRaw}". Remove the ahu column, or upload from the block.`);
      if (areaRaw && nameKey(areaRaw) !== nameKey(plan.areaLabel)) err('area', r.area, `This upload goes into AHU "${h.name}"${plan.areaLabel ? ` (area "${plan.areaLabel}")` : ''}, but the row names area "${areaRaw}".`);
    } else {
      // Area this row asks for. `null` = not specified (Block scope, blank cell).
      let parent: ParentKey | null = null;
      if (mode === 'area') {
        parent = `area:${scopeArea!.id}`; plan.areaLabel = scopeArea!.name;
        if (areaRaw && nameKey(areaRaw) !== nameKey(scopeArea!.name)) err('area', r.area, `This upload goes into area "${scopeArea!.name}", but the row names area "${areaRaw}". Remove the area column, or upload from the block.`);
      } else if (areaRaw) {
        const k = nameKey(areaRaw);
        const a = areaByKey.get(k);
        if (a) { parent = `area:${a.id}`; plan.areaLabel = a.name; }
        else if (plannedAreas.has(k)) { parent = `newArea:${k}`; plan.areaLabel = plannedAreas.get(k)!.name; plan.areaNew = true; }
        else {
          const why = cannotCreate(areaRaw, 'AREA');
          if (why) err('area', r.area, why);
          else { pendingArea = { key: k, name: areaRaw, rows: [] }; parent = `newArea:${k}`; plan.areaNew = true; }
        }
      }

      if (!ahuRaw) {
        err('ahu', '', 'ahu is required — the AHU this filter goes into');
      } else {
        const k = nameKey(ahuRaw);
        const h = ahuByKey.get(k);
        const p = plannedAhus.get(k);
        if (h) {
          plan.ahuId = h.id; plan.ahuLabel = h.name;
          const hParent: ParentKey = h.areaId ? `area:${h.areaId}` : 'block';
          if (parent && parent !== hParent) {
            err('ahu', r.ahu, `AHU "${h.name}" already exists in this block ${h.areaId ? `under area "${areaNameOf(h.areaId)}"` : 'directly (no area)'}, not under area "${plan.areaLabel}". Fix the area cell, or leave it blank.`);
          } else plan.areaLabel = areaNameOf(h.areaId);
        } else if (p) {
          plan.newAhuKey = k; plan.ahuLabel = p.name; plan.ahuNew = true;
          if (parent && parent !== p.parent) err('ahu', r.ahu, `New AHU "${p.name}" is placed ${p.parent === 'block' ? 'directly under the block' : 'under a different area'} by an earlier row (row ${p.rows[0]}). Use the same area for every row of one AHU.`);
          else if (!parent) { plan.areaNew = p.parent.startsWith('newArea:'); plan.areaLabel = p.parent === 'block' ? '' : p.parent.startsWith('area:') ? areaNameOf(p.parent.slice(5)) : plannedAreas.get(p.parent.slice(8))?.name ?? ''; }
        } else {
          const why = cannotCreate(ahuRaw, 'AHU');
          if (why) err('ahu', r.ahu, why);
          else { pendingAhu = { key: k, name: ahuRaw, parent: parent ?? 'block', rows: [] }; plan.newAhuKey = k; plan.ahuNew = true; }
        }
      }
    }

    // filterSet: the per-row Excel cell wins; the legacy dialog default is
    // retained for API back-compat only.
    const setRaw = r.filterSet.toUpperCase().trim();
    if (setRaw === 'A' || setRaw === 'SET_A') plan.filterSet = 'A';
    else if (setRaw === 'B' || setRaw === 'SET_B') plan.filterSet = 'B';
    else if (!setRaw && defaultWire) plan.filterSet = defaultWire;
    else if (setRaw) err('filterSet', r.filterSet, 'filterSet must be A or B');
    else err('filterSet', '', 'filterSet is required — set A or B in the filterSet column');

    const { errors: fieldErrors } = await validateAndBuildFilterAttributes({
      ahuType: r.ahuType, filterType: r.filterType, micronSize: r.micronSize, filterSize: r.filterSize, lastCleaningDate: r.lastCleaningDate,
    });
    for (const fe of fieldErrors) err(fe.field, fe.value, fe.message);

    // Duplicate within the batch / already used site-wide / clashes with an AHU or Area this file names.
    const key = nameKey(name);
    if (name && namesInBatch.has(key)) err('name', name, 'Duplicate name in file');
    else if (name && takenKind.has(key)) err('name', name, `"${name}" already exists`);
    else if (name && (plannedAhus.has(key) || plannedAreas.has(key) || key === nameKey(ahuRaw) || key === nameKey(areaRaw))) err('name', name, `"${name}" is also used as an AHU / area name in this file`);
    if (name) namesInBatch.add(key);

    if (errs.length === 0) {
      if (pendingArea) plannedAreas.set(pendingArea.key, pendingArea);
      if (pendingAhu) plannedAhus.set(pendingAhu.key, pendingAhu);
      if (plan.newAhuKey) plannedAhus.get(plan.newAhuKey)!.rows.push(r.rowNumber);
    }
    plans.push(plan);
  }

  // 6. Capacity: instanceService.create refuses a child once the parent holds
  // its template's max_connections. Predict it here so the preview does not
  // promise rows the real upload then refuses. AHUs are checked first; an
  // area is only created if a surviving AHU needs it.
  const capacityOf = async (parentId: string) => {
    const parent = await prisma.assetInstance.findUnique({ where: { id: parentId }, select: { template: { select: { maxConnections: true } } } });
    const max = (parent as any)?.template?.maxConnections ?? 10;
    return { used: await relationshipRepository.countContainsChildren(parentId), max };
  };
  const areaTemplateMax = areaTemplateId
    ? (await prisma.assetTemplate.findUnique({ where: { id: areaTemplateId }, select: { maxConnections: true } }))?.maxConnections ?? 10
    : 10;
  const room = new Map<ParentKey, { used: number; max: number; label: string }>();
  const roomFor = async (parent: ParentKey) => {
    if (!room.has(parent)) {
      if (parent === 'block') room.set(parent, { ...(await capacityOf(block.id)), label: `block "${block.name}"` });
      else if (parent.startsWith('area:')) room.set(parent, { ...(await capacityOf(parent.slice(5))), label: `area "${areaNameOf(parent.slice(5))}"` });
      else room.set(parent, { used: 0, max: areaTemplateMax, label: `new area "${plannedAreas.get(parent.slice(8))?.name}"` });
    }
    return room.get(parent)!;
  };
  const take = async (parent: ParentKey): Promise<string | null> => {
    const c = await roomFor(parent);
    if (c.max > 0 && c.used >= c.max) return `Cannot create it: ${c.label} already holds its maximum of ${c.max} children`;
    c.used++;
    return null;
  };
  for (const a of plannedAreas.values()) {
    if (![...plannedAhus.values()].some(h => h.parent === `newArea:${a.key}`)) continue;
    a.blocked = (await take('block')) ?? undefined;
  }
  for (const h of plannedAhus.values()) {
    const viaArea = h.parent.startsWith('newArea:') ? plannedAreas.get(h.parent.slice(8)) : undefined;
    h.blocked = viaArea?.blocked ?? (await take(h.parent)) ?? undefined;
  }
  for (const p of plans) {
    if (p.errs.length || !p.newAhuKey) continue;
    const h = plannedAhus.get(p.newAhuKey)!;
    if (h.blocked) p.errs.push({ row: p.r.rowNumber, name: p.name, status: 'error', column: 'ahu', value: h.name, error: `New AHU "${h.name}": ${h.blocked}` });
  }
  // Only create what a valid row still needs.
  for (const h of [...plannedAhus.values()]) if (h.blocked) plannedAhus.delete(h.key);
  for (const a of [...plannedAreas.values()]) {
    if (a.blocked || ![...plannedAhus.values()].some(h => h.parent === `newArea:${a.key}`)) plannedAreas.delete(a.key);
  }

  const results: BulkResult[] = plans.flatMap(p => p.errs);
  const clean = plans.filter(p => p.errs.length === 0);
  const newAreaNames = [...plannedAreas.values()].map(a => a.name);
  const newAhuNames = [...plannedAhus.values()].map(h => h.name);

  // 7. Dry-run: report would-create rows as success, return parsed rows for the preview.
  if (opts.validateOnly) {
    for (const p of clean) results.push({ row: p.r.rowNumber, name: p.name, status: 'success' });
    results.sort((a, b) => a.row - b.row);
    return {
      results,
      created: 0,
      failed: results.filter((r) => r.status === 'error').length,
      // `ahu` / `area` are the RESOLVED names, with whether each is new, so the
      // operator confirms where every filter lands — and what gets created —
      // before anything is written.
      rows: plans.map(({ r, ahuLabel, areaLabel, ahuNew, areaNew }) => ({
        name: r.name, area: areaLabel, areaStatus: areaLabel ? (areaNew ? 'new' : 'existing') : '',
        ahu: ahuLabel, ahuStatus: ahuLabel ? (ahuNew ? 'new' : 'existing') : '',
        filterSet: r.filterSet, ahuType: r.ahuType, filterType: r.filterType, micronSize: r.micronSize, filterSize: r.filterSize, lastCleaningDate: r.lastCleaningDate,
      })),
      newAreas: newAreaNames,
      newAhus: newAhuNames,
    };
  }

  // 8. Create new Areas, then new AHUs, through the Structure-view create path
  // (parent checks + ASSET_CREATED audit row each).
  const createdAreaId = new Map<string, string>();
  const areaFailure = new Map<string, string>();
  const createdAreas: string[] = [];
  for (const a of plannedAreas.values()) {
    try {
      const inst = await instanceService.create({ name: a.name, templateId: areaTemplateId, status: 'Active', parentId: block.id }, ctx);
      createdAreaId.set(a.key, inst.id);
      createdAreas.push(a.name);
    } catch (e: any) {
      areaFailure.set(a.key, e instanceof AppError ? e.message : 'could not be created');
    }
  }
  const createdAhuId = new Map<string, string>();
  const ahuFailure = new Map<string, string>();
  const createdAhus: string[] = [];
  for (const h of plannedAhus.values()) {
    let parentId: string = block.id;
    if (h.parent.startsWith('area:')) parentId = h.parent.slice(5);
    else if (h.parent.startsWith('newArea:')) {
      const k = h.parent.slice(8);
      const id = createdAreaId.get(k);
      if (!id) { ahuFailure.set(h.key, `its area "${plannedAreas.get(k)?.name}" ${areaFailure.get(k) ?? 'could not be created'}`); continue; }
      parentId = id;
    }
    try {
      const inst = await instanceService.create({ name: h.name, templateId: ahuTemplateId, status: 'Active', parentId }, ctx);
      createdAhuId.set(h.key, inst.id);
      createdAhus.push(h.name);
    } catch (e: any) {
      ahuFailure.set(h.key, e instanceof AppError ? e.message : 'could not be created');
    }
  }

  // 9. Create the clean rows via the standalone typed filter service (A-01 T2.1).
  // RFID tags are NOT assigned at bulk upload (2026-06-12).
  const createdNames: string[] = [];
  for (const p of clean) {
    const ahuId = p.ahuId ?? (p.newAhuKey ? createdAhuId.get(p.newAhuKey) : undefined);
    if (!ahuId) {
      results.push({ row: p.r.rowNumber, name: p.name, status: 'error', column: 'ahu', value: p.ahuLabel, error: `AHU "${p.ahuLabel}" was not created: ${ahuFailure.get(p.newAhuKey ?? '') ?? 'unknown error'}` });
      continue;
    }
    try {
      const f = await filterService.create({
        name: p.name,
        ahuId,
        ...(p.filterSet ? { filterSet: p.filterSet } : {}),
        ahuType: p.r.ahuType, filterType: p.r.filterType, micronSize: p.r.micronSize, filterSize: p.r.filterSize, lastCleaningDate: p.r.lastCleaningDate,
      }, ctx);
      results.push({ row: p.r.rowNumber, name: p.name, status: 'success', id: f.id });
      createdNames.push(p.name);
    } catch (err: any) {
      // Audit 2026-09-24 (A-F2): only AppError text may reach the client.
      results.push({ row: p.r.rowNumber, name: p.name, status: 'error', error: err instanceof AppError ? err.message : 'Create failed' });
    }
  }

  // 10. Audit (one summary entry for the batch; each new AHU / Area has its own row).
  const scopeKind = mode === 'ahu' ? 'AHU' : mode === 'area' ? 'area' : 'block';
  const scopeEntity = mode === 'ahu' ? scopeAhu! : mode === 'area' ? scopeArea! : block;
  if (createdNames.length > 0) {
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'BULK_FILTER_UPLOAD', targetType: 'asset_instance', targetId: scopeEntity.id,
      afterValue: {
        scope: scopeKind, scopeName: scopeEntity.name, blockName: block.name,
        // Kept for historic readers of this row's shape.
        ...(mode === 'ahu' ? { ahuName: scopeEntity.name } : {}),
        count: createdNames.length, filters: createdNames,
        ...(createdAreas.length ? { createdAreas } : {}),
        ...(createdAhus.length ? { createdAhus } : {}),
      },
      reason: `Bulk uploaded ${createdNames.length} filters into ${scopeKind} "${scopeEntity.name}"`
        + (createdAhus.length ? `; created AHU(s) ${createdAhus.join(', ')}` : '')
        + (createdAreas.length ? `; created area(s) ${createdAreas.join(', ')}` : ''),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  }

  results.sort((a, b) => a.row - b.row);
  return {
    results,
    created: createdNames.length,
    failed: results.filter((r) => r.status === 'error').length,
    newAreas: createdAreas,
    newAhus: createdAhus,
  };
}
