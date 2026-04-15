/**
 * Returns inline style objects for common themed UI elements.
 * Uses CSS custom properties set by the active theme.
 * Import and spread these in `style={{}}` props.
 */

/** Primary gradient background (buttons, page header icons) */
export const themeGradient: React.CSSProperties = {
  background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))',
};

/** Primary gradient background (diagonal, for icon containers) */
export const themeGradientBr: React.CSSProperties = {
  background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))',
};

/** Primary solid background */
export const themePrimaryBg: React.CSSProperties = {
  backgroundColor: 'var(--theme-primary)',
};

/** Primary text color */
export const themePrimaryText: React.CSSProperties = {
  color: 'var(--theme-primary)',
};

/** Accent text color */
export const themeAccentText: React.CSSProperties = {
  color: 'var(--theme-accent)',
};

/** Primary light background (for selected/active items) */
export const themePrimaryLightBg: React.CSSProperties = {
  backgroundColor: 'var(--theme-primary-light)',
};

/** Active tab/pill style */
export const themeActiveTab: React.CSSProperties = {
  backgroundColor: 'var(--theme-primary)',
  color: '#ffffff',
};

/** Focus ring */
export const themeFocusRing: React.CSSProperties = {
  outlineColor: 'var(--theme-focus-ring)',
};

/** Box shadow using theme primary */
export const themeShadow: React.CSSProperties = {
  boxShadow: '0 4px 14px -3px color-mix(in srgb, var(--theme-primary) 30%, transparent)',
};

/** Combined gradient button style */
export const themeButton: React.CSSProperties = {
  ...themeGradient,
  color: '#ffffff',
  boxShadow: '0 4px 14px -3px color-mix(in srgb, var(--theme-primary) 30%, transparent)',
};
