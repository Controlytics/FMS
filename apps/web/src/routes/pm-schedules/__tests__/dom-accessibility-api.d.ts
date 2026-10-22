// dom-accessibility-api ships types, but its package.json "exports" map hides
// them from `moduleResolution: bundler` (TS7016). Declare the one function the
// operations-pages a11y check uses.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(root: Element, options?: Record<string, unknown>): string;
}
