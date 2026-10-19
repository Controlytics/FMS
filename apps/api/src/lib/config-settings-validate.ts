/**
 * Server-side validation of a config body against the def's own declared
 * settings (QA-D003, 2026-10-19).
 *
 * `PUT /api/config/dynamic/:key` validated only through `def.zodSchema` /
 * `def.hooks.validate`, and none of the 38 defs supplies either, so the 12 defs
 * served by that route (stage-interlock, filter-approval, block-change-approval,
 * pm-schedule-*, replacement-schedule-approval, export-limit, …) stored whatever
 * body arrived. Each `SettingDefinition` already declares its type, min/max,
 * minLength/maxLength and options for the page; this checks the same rules on
 * the server so a malformed policy is refused instead of silently driving the
 * gates.
 *
 * Deliberately narrow, so every value a page legitimately sends still passes:
 *  - only DECLARED keys are checked; other keys are left alone (some pages keep
 *    extra structure next to the declared settings);
 *  - `undefined` / `null` are not checked (not-set; the reader falls back to the
 *    default);
 *  - a `select` / `multiselect` with `dynamicOptionsSource` or no static options
 *    accepts any string/number (the option list is live data, e.g. roles);
 *  - `json` is not shape-checked;
 *  - the masked-secret placeholder is accepted (the route swaps the stored value
 *    back in afterwards).
 */
import type { SettingDefinition } from './config-registry.js';

const MASK = '••••••••';
const STRING_TYPES = new Set(['string', 'textarea', 'secret', 'color', 'url', 'email', 'cron']);

function staticOptions(s: SettingDefinition): Array<string> | null {
  if (s.dynamicOptionsSource) return null;
  if (!s.options || s.options.length === 0) return null;
  return s.options.map((o) => String(o.value));
}

export function validateAgainstSettings(settings: SettingDefinition[] | undefined, body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const s of settings ?? []) {
    const v = body[s.key];
    if (v === undefined || v === null) continue;
    // dynamic-config.tsx sends a cleared number field as '' (and approval-role
    // selects are stored as '' when unset): an empty value means "not set".
    if (v === '' && (s.type === 'number' || s.type === 'select')) continue;
    const name = s.label || s.key;

    switch (s.type) {
      case 'boolean':
        if (typeof v !== 'boolean') errors.push(`${name} must be true or false`);
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${name} must be a number`); break; }
        if (s.min !== undefined && v < s.min) errors.push(`${name} must be at least ${s.min}`);
        if (s.max !== undefined && v > s.max) errors.push(`${name} must be at most ${s.max}`);
        break;
      case 'select': {
        if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`${name} must be a single value`); break; }
        const opts = staticOptions(s);
        if (opts && !opts.includes(String(v))) errors.push(`${name} must be one of: ${opts.join(', ')}`);
        break;
      }
      case 'multiselect': {
        // A single string is the legacy single-select shape (e.g. approval-role
        // configs stored `uploadRole: ""` before the field became a multiselect);
        // every reader passes it through normalizeRoles(), which accepts both.
        const list = typeof v === 'string' ? (v.trim() ? [v] : []) : v;
        if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' && typeof x !== 'number')) {
          errors.push(`${name} must be a list of values`); break;
        }
        const opts = staticOptions(s);
        if (opts) {
          const bad = list.filter((x) => !opts.includes(String(x)));
          if (bad.length) errors.push(`${name} contains values that are not allowed: ${bad.join(', ')}`);
        }
        break;
      }
      case 'json':
        break;
      default:
        if (STRING_TYPES.has(s.type)) {
          if (typeof v !== 'string') { errors.push(`${name} must be text`); break; }
          if (v === MASK) break;
          if (s.minLength !== undefined && v.length < s.minLength) errors.push(`${name} must be at least ${s.minLength} characters`);
          if (s.maxLength !== undefined && v.length > s.maxLength) errors.push(`${name} must be at most ${s.maxLength} characters`);
        }
    }
  }
  return errors;
}
