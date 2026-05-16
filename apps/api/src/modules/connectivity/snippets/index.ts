/**
 * Connectivity snippet generators.
 *
 * Dispatches across the 4 supported device languages (Python, Node.js,
 * curl, C) for both MQTT and HTTP transports. The route handler in
 * `../routes.ts` builds the `SnippetContext` once from the live entity +
 * device credential and calls `renderSnippets()` to get the response shape.
 *
 * Extracted from a 300-LoC inline block in the handler 2026-05-16
 * (Wave 3.1 of CLEANUP-EXECUTION-PLAN-2026-05-16.md).
 */
import { renderPython } from './python.template.js';
import { renderNodejs } from './nodejs.template.js';
import { renderCurl } from './curl.template.js';
import { renderC } from './c.template.js';
import type { SnippetContext, Transport } from './types.js';

export type { SnippetContext, Transport } from './types.js';

export interface SnippetBundle {
  python: string;
  nodejs: string;
  curl: string;
  c: string;
}

export function renderSnippets(transport: Transport, ctx: SnippetContext): SnippetBundle {
  return {
    python: renderPython(transport, ctx),
    nodejs: renderNodejs(transport, ctx),
    curl: renderCurl(transport, ctx),
    c: renderC(transport, ctx),
  };
}
