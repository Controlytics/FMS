/**
 * Accessible-name check for the operations pages (2026-10-21, 3d). NOT a test
 * file. Every button / input / select / textarea a page renders must carry a
 * real accessible name: a <label>, aria-label or its own text. A placeholder is
 * not a name, and neither is a bare glyph such as "×".
 */
import { computeAccessibleName } from 'dom-accessibility-api';

const GLYPH_ONLY = /^[×✕←→↑↓▸▾+\-−…]$/;

function describeControl(el: Element): string {
  const type = el.getAttribute('type');
  const ph = el.getAttribute('placeholder');
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join(' ');
  return [el.tagName.toLowerCase() + (type ? `[type=${type}]` : ''), ph ? `placeholder="${ph}"` : '', cls ? `class="${cls}"` : '']
    .filter(Boolean).join(' ');
}

/** Controls under `root` with no accessible name (empty list = all named). */
export function unnamedControls(root: ParentNode = document.body): string[] {
  return (Array.from(root.querySelectorAll('button, input, select, textarea')) as HTMLElement[])
    .filter((el) => (el as HTMLInputElement).type !== 'hidden')
    .filter((el) => {
      const name = computeAccessibleName(el).trim();
      return name === '' || GLYPH_ONLY.test(name);
    })
    .map(describeControl);
}
