// Minimal schema-valid request generator from the live OpenAPI spec (/docs/json).
// Purpose: get PAST Fastify schema validation (which runs BEFORE the rbac preHandler),
// so a 403 / non-403 answer really reflects the permission gate. Every id is a fresh
// random UUID, so a request that passes the gate normally dies in the handler with a 404.
import { randomUUID } from 'node:crypto';

const STR_CANDIDATES = ['QAPROBE', 'QA_PROBE', 'qaprobe', 'qa-probe', 'A1', '1', 'a', '2026-01-01', 'x@example.invalid'];

export function gen(schema, depth = 0) {
  if (!schema || depth > 8) return undefined;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => gen(s, depth + 1)));
  if (schema.anyOf || schema.oneOf) {
    const alts = (schema.anyOf ?? schema.oneOf).filter((s) => s.type !== 'null');
    return gen(alts[0], depth + 1);
  }
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum.find((v) => v !== null) ?? schema.enum[0];
  let type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (!type && schema.properties) type = 'object';
  switch (type) {
    case 'object': {
      const o = {};
      for (const k of schema.required ?? []) o[k] = gen(schema.properties?.[k] ?? {}, depth + 1);
      return o;
    }
    case 'array': {
      const n = Math.max(schema.minItems ?? 0, 0);
      return Array.from({ length: n }, () => gen(schema.items ?? {}, depth + 1));
    }
    case 'string': {
      if (schema.format === 'uuid') return randomUUID();
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
      if (schema.format === 'email') return 'qa-probe@example.invalid';
      const min = schema.minLength ?? 0;
      const max = schema.maxLength ?? 64;
      const fit = (s) => { let v = s; while (v.length < min) v += 'X'; return v.slice(0, max); };
      if (schema.pattern) {
        const re = new RegExp(schema.pattern);
        for (const c of STR_CANDIDATES) if (re.test(fit(c))) return fit(c);
      }
      return fit(min > 0 || schema.pattern ? 'QAPROBE' : 'QAPROBE');
    }
    case 'integer':
    case 'number': {
      let v = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1);
      if (schema.maximum !== undefined && v > schema.maximum) v = schema.maximum;
      return v;
    }
    case 'boolean': return false;
    default: return undefined;
  }
}

/** Builds { url, body, multipart } for one inventory op, or null when the spec lacks it. */
export function buildRequest(spec, method, invPath, { full }) {
  const p = spec.paths[invPath] ?? spec.paths[invPath.replace(/\/$/, '')] ?? spec.paths[invPath + '/'];
  const op = p?.[method.toLowerCase()];
  const params = [...(p?.parameters ?? []), ...(op?.parameters ?? [])];
  let url = invPath.replace(/\{([^}]+)\}/g, (_, name) => {
    const ps = params.find((x) => x.in === 'path' && x.name === name)?.schema;
    if (/^(id|.*Id)$/.test(name) && name !== 'fieldId') return randomUUID();
    if (name === 'versionNumber') return '999999';
    if (ps?.format === 'uuid') return randomUUID();
    return 'QA_PROBE_NONEXISTENT';
  });
  const q = new URLSearchParams();
  for (const x of params.filter((x) => x.in === 'query' && x.required)) q.set(x.name, String(gen(x.schema ?? { type: 'string' })));
  if ([...q].length) url += (url.includes('?') ? '&' : '?') + q.toString();
  const content = op?.requestBody?.content ?? {};
  const multipart = !!content['multipart/form-data'] && !content['application/json'];
  let body;
  if (!['GET', 'DELETE'].includes(method)) body = full && content['application/json'] ? gen(content['application/json'].schema) ?? {} : {};
  return { url, body, multipart, inSpec: !!op };
}
