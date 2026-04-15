import type { ResolutionContext, ResolvedValue } from './data-sources/timestamp-source.js';
import { resolveTimestamp } from './data-sources/timestamp-source.js';
import { resolveMeta } from './data-sources/meta-source.js';
import { resolveAttribute } from './data-sources/attribute-source.js';
import { resolveIdentifier } from './data-sources/identifier-source.js';
import { resolveTelemetry } from './data-sources/telemetry-source.js';

const TAG_REGEX = /\{\{([^}]+)\}\}/g;

interface ParsedTag {
  raw: string;
  source: string;
  slotRef: string;
  field: string;
  modifier?: string;
}

function parseTag(raw: string): ParsedTag | null {
  const parts = raw.trim().split('.');
  if (parts.length < 2) return null;

  const source = parts[0];

  if (source === 'time' || source === 'meta' || source === 'page') {
    return { raw, source, slotRef: '', field: parts.slice(1).join('.') };
  }

  const slotRef = parts[1];
  const fieldPart = parts.slice(2).join('.');

  const bracketMatch = fieldPart.match(/^([^[]+)\[([^\]]+)\]$/);
  if (bracketMatch) {
    return { raw, source, slotRef, field: bracketMatch[1], modifier: bracketMatch[2] };
  }

  return { raw, source, slotRef, field: fieldPart };
}

export function extractTags(config: unknown): string[] {
  const json = JSON.stringify(config);
  const tags = new Set<string>();
  let match;
  const regex = /\{\{([^}]+)\}\}/g;
  while ((match = regex.exec(json)) !== null) {
    tags.add(match[1]);
  }
  return [...tags];
}

async function resolveOne(parsed: ParsedTag, ctx: ResolutionContext): Promise<ResolvedValue> {
  switch (parsed.source) {
    case 'time':
      return resolveTimestamp(parsed.field, ctx);
    case 'meta':
      return resolveMeta(parsed.field, ctx);
    case 'attr':
      return resolveAttribute(parsed.slotRef, parsed.field, ctx);
    case 'ident':
      return resolveIdentifier(parsed.slotRef, parsed.field, ctx);
    case 'ts':
      return resolveTelemetry(parsed.slotRef, parsed.field, parsed.modifier ?? 'last', ctx);
    case 'page':
      return { value: `{{page.${parsed.field}}}` };
    default:
      return { value: '', error: `Unknown source: ${parsed.source}` };
  }
}

export async function resolveAllTags(
  config: unknown,
  ctx: ResolutionContext,
): Promise<Map<string, unknown>> {
  const tags = extractTags(config);
  const resolved = new Map<string, unknown>();

  for (const raw of tags) {
    const parsed = parseTag(raw);
    if (!parsed) {
      resolved.set(raw, '');
      continue;
    }
    const result = await resolveOne(parsed, ctx);
    resolved.set(raw, result.value);
  }

  return resolved;
}

export function substituteString(template: string, resolved: Map<string, unknown>): string {
  return template.replace(TAG_REGEX, (_, tag) => {
    const value = resolved.get(tag);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}
