import { parse } from 'csv-parse/sync';
import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';
import { sanitizeStrings } from '../../../lib/sanitize.js';

interface TemplateField {
  fieldName: string;
  dataType?: string;
  required?: boolean;
  dropdownOptions?: string[];
}

interface BulkResult {
  row: number;
  name: string;
  status: 'success' | 'error';
  id?: string;
  error?: string;
}

interface ValidRow {
  idx: number;
  name: string;
  filterSet: 'SET_A' | 'SET_B';
  filterProfileId: string | null;
  attributes: Record<string, any>;
}

export async function bulkUploadFilters(
  csvBuffer: Buffer,
  ahuId: string,
  blockId: string | undefined,
  ctx: RequestContext
): Promise<{ results: BulkResult[]; created: number; failed: number }> {

  // 1. Parse CSV
  let rows: Record<string, string>[];
  try {
    rows = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch {
    return { results: [{ row: 1, name: '', status: 'error', error: 'Invalid CSV format' }], created: 0, failed: 1 };
  }

  if (rows.length === 0) {
    return { results: [{ row: 1, name: '', status: 'error', error: 'CSV is empty' }], created: 0, failed: 1 };
  }
  if (rows.length > 200) {
    return { results: [{ row: 1, name: '', status: 'error', error: 'Maximum 200 filters per upload' }], created: 0, failed: 1 };
  }

  // 2. Validate AHU
  const ahu = await prisma.assetInstance.findUnique({
    where: { id: ahuId },
    select: { id: true, name: true, templateId: true, organizationId: true },
  });
  if (!ahu) {
    return { results: [{ row: 1, name: '', status: 'error', error: 'AHU not found' }], created: 0, failed: 1 };
  }

  // 3. Validate Block (optional)
  if (blockId) {
    const block = await prisma.assetInstance.findUnique({ where: { id: blockId }, select: { id: true } });
    if (!block) {
      return { results: [{ row: 1, name: '', status: 'error', error: 'Block not found' }], created: 0, failed: 1 };
    }
  }

  // 4. Find Filter template (include attributeSchema for dynamic CSV columns)
  const filterTemplate = await prisma.assetTemplate.findFirst({
    where: { name: { equals: 'Filter', mode: 'insensitive' }, isActive: true },
    select: { id: true, version: true, attributeSchema: true },
  });
  if (!filterTemplate) {
    return { results: [{ row: 1, name: '', status: 'error', error: 'No "Filter" template found.' }], created: 0, failed: 1 };
  }

  // 5. Pre-fetch all referenced filter profiles in one query
  const allFpIds = [...new Set(
    rows.map(r => (r.filterProfileId ?? '').trim()).filter(Boolean)
  )];
  const validFpIds = new Set<string>();
  if (allFpIds.length > 0) {
    const foundProfiles = await prisma.filterProfile.findMany({
      where: { id: { in: allFpIds } },
      select: { id: true },
    });
    for (const fp of foundProfiles) validFpIds.add(fp.id);
  }

  // 6. Validate rows
  const results: BulkResult[] = [];
  const validRows: ValidRow[] = [];
  const namesInBatch = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = sanitizeStrings(rows[i]);
    const rowNum = i + 2;
    const name = (row.name ?? row.filterName ?? '').trim();

    if (!name) {
      results.push({ row: rowNum, name: '', status: 'error', error: 'Filter Name is required' });
      continue;
    }

    // Filter set
    const setRaw = (row.filterSet ?? '').toUpperCase().trim();
    let filterSet: 'SET_A' | 'SET_B';
    if (setRaw === 'A' || setRaw === 'SET_A') filterSet = 'SET_A';
    else if (setRaw === 'B' || setRaw === 'SET_B') filterSet = 'SET_B';
    else {
      results.push({ row: rowNum, name, status: 'error', error: 'filterSet must be A or B' });
      continue;
    }

    // Duplicate in batch
    const nameKey = name.toLowerCase();
    if (namesInBatch.has(nameKey)) {
      results.push({ row: rowNum, name, status: 'error', error: 'Duplicate name in CSV' });
      continue;
    }
    namesInBatch.add(nameKey);

    // Filter profile (optional) — validated against pre-fetched set
    let fpId: string | null = null;
    const rawFpId = (row.filterProfileId ?? '').trim();
    if (rawFpId) {
      if (!validFpIds.has(rawFpId)) {
        results.push({ row: rowNum, name, status: 'error', error: `Filter profile not found: ${rawFpId}` });
        continue;
      }
      fpId = rawFpId;
    }

    // Build attributes dynamically from Filter template attributeSchema
    const templateFields: TemplateField[] = Array.isArray(filterTemplate.attributeSchema) ? filterTemplate.attributeSchema as unknown as TemplateField[] : [];
    const attributes: Record<string, any> = {};
    attributes.filterCode = name;

    // Map CSV columns to template fields (case-insensitive matching)
    let fieldError = false;
    for (const field of templateFields) {
      // Find matching CSV column (case-insensitive, stripped spaces)
      const fieldKey = field.fieldName.toLowerCase().replace(/\s+/g, '');
      const csvValue = Object.entries(row).find(([k]) => k.toLowerCase().replace(/\s+/g, '') === fieldKey)?.[1]?.toString().trim() ?? '';

      if (field.required && !csvValue) {
        results.push({ row: rowNum, name, status: 'error', error: `"${field.fieldName}" is required` });
        fieldError = true;
        break;
      }

      if (!csvValue) continue;

      // Validate dropdown values
      if (field.dropdownOptions?.length) {
        const match = field.dropdownOptions.find(o => o.toLowerCase() === csvValue.toLowerCase());
        if (!match) {
          results.push({ row: rowNum, name, status: 'error', error: `"${field.fieldName}" must be one of: ${field.dropdownOptions.join(', ')}` });
          fieldError = true;
          break;
        }
        attributes[field.fieldName] = match;
      } else if (field.dataType === 'INTEGER') {
        const num = parseInt(csvValue, 10);
        if (isNaN(num)) { results.push({ row: rowNum, name, status: 'error', error: `"${field.fieldName}" must be a whole number` }); fieldError = true; break; }
        attributes[field.fieldName] = num;
      } else if (field.dataType === 'FLOAT') {
        const num = parseFloat(csvValue);
        if (isNaN(num)) { results.push({ row: rowNum, name, status: 'error', error: `"${field.fieldName}" must be a number` }); fieldError = true; break; }
        attributes[field.fieldName] = num;
      } else if (field.dataType === 'BOOLEAN') {
        attributes[field.fieldName] = csvValue.toLowerCase() === 'true' || csvValue === '1';
      } else {
        attributes[field.fieldName] = csvValue;
      }
    }
    if (fieldError) continue;

    validRows.push({ idx: i, name, filterSet, filterProfileId: fpId, attributes });
  }

  // 6. Check existing names
  if (validRows.length > 0) {
    const existingNames = await prisma.assetInstance.findMany({
      where: { name: { in: validRows.map(r => r.name), mode: 'insensitive' }, isActive: true },
      select: { name: true },
    });
    const existingSet = new Set(existingNames.map(e => e.name.toLowerCase()));
    const stillValid: ValidRow[] = [];
    for (const row of validRows) {
      if (existingSet.has(row.name.toLowerCase())) {
        results.push({ row: row.idx + 2, name: row.name, status: 'error', error: `"${row.name}" already exists` });
      } else {
        stillValid.push(row);
      }
    }
    validRows.length = 0;
    validRows.push(...stillValid);
  }

  if (validRows.length === 0) {
    return { results, created: 0, failed: results.length };
  }

  // 7. Create in transaction (re-check name uniqueness inside transaction to prevent races)
  const createdFilters = await prisma.$transaction(async (tx) => {
    // Re-check names inside transaction to prevent TOCTOU race condition
    const existingInTx = await tx.assetInstance.findMany({
      where: { name: { in: validRows.map(r => r.name), mode: 'insensitive' }, isActive: true },
      select: { name: true },
    });
    if (existingInTx.length > 0) {
      throw new Error(`Filter names already exist: ${existingInTx.map(e => e.name).join(', ')}`);
    }

    const created: { idx: number; name: string; id: string }[] = [];

    for (const row of validRows) {
      const inst = await tx.assetInstance.create({
        data: {
          name: row.name,
          templateId: filterTemplate.id,
          templateVersion: filterTemplate.version,
          parentId: ahuId,
          filterSet: row.filterSet,
          filterProfileId: row.filterProfileId,
          attributes: row.attributes,
          organizationId: ahu.organizationId,
          createdBy: ctx.userId,
        } as any,
      });

      // AHU relationships
      await Promise.all([
        tx.assetRelationship.create({ data: { sourceAssetId: ahuId, targetAssetId: inst.id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
        tx.assetRelationship.create({ data: { sourceAssetId: inst.id, targetAssetId: ahuId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
      ]);

      // Block relationships (if blockId provided)
      if (blockId) {
        await Promise.all([
          tx.assetRelationship.create({ data: { sourceAssetId: blockId, targetAssetId: inst.id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
          tx.assetRelationship.create({ data: { sourceAssetId: inst.id, targetAssetId: blockId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
        ]);
      }

      created.push({ idx: row.idx, name: row.name, id: inst.id });
    }
    return created;
  });

  // 8. Results + audit
  for (const f of createdFilters) {
    results.push({ row: f.idx + 2, name: f.name, status: 'success', id: f.id });
  }

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole,
    action: 'BULK_FILTER_UPLOAD', targetType: 'asset_instance', targetId: ahuId,
    afterValue: { ahuName: ahu.name, count: createdFilters.length, filters: createdFilters.map(f => f.name) },
    reason: `Bulk uploaded ${createdFilters.length} filters into AHU "${ahu.name}"`,
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
  });

  results.sort((a, b) => a.row - b.row);
  return { results, created: createdFilters.length, failed: results.filter(r => r.status === 'error').length };
}
