/**
 * The 10 colour themes + applyTheme(). The header comment of themes.ts makes
 * concrete claims (AA contrast with white text, tonal gradients); they are
 * checked here against the data rather than trusted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { THEMES, DEFAULT_THEME_ID, getThemeById, applyTheme, type ThemeColors } from '../themes';
import { themeGradient, themeGradientBr, themeButton } from '../theme-styles';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

const KEYS: (keyof ThemeColors)[] = ['primary', 'primaryLight', 'primaryDark', 'accent', 'accentLight', 'gradientFrom',
  'gradientTo', 'sidebarBg', 'sidebarBgEnd', 'loginBgStart', 'loginBgEnd', 'focusRing'];

describe('THEMES catalogue', () => {
  it('has the 10 documented presets with unique ids', () => {
    expect(THEMES.map((t) => t.name)).toEqual(['Ocean', 'Sapphire', 'Emerald', 'Amethyst', 'Sunset', 'Slate', 'Ruby', 'Forest', 'Midnight', 'Coral']);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(10);
    expect(DEFAULT_THEME_ID).toBe('ocean');
  });

  it.each(THEMES.map((t) => [t.id, t] as const))('%s: every colour key is a 6-digit hex', (_id, theme) => {
    expect(Object.keys(theme.colors).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(theme.colors[k], k).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.name.length).toBeGreaterThan(0);
    expect(theme.description.length).toBeGreaterThan(0);
  });

  it.each(THEMES.map((t) => [t.id, t] as const))('%s: primary, primaryDark and accent pass WCAG AA (4.5:1) with white text', (_id, theme) => {
    for (const k of ['primary', 'primaryDark', 'accent'] as const) {
      expect(contrastWithWhite(theme.colors[k]), `${k} ${theme.colors[k]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES.map((t) => [t.id, t] as const))('%s: the gradient is tonal (primary -> primaryDark)', (_id, theme) => {
    expect(theme.colors.gradientFrom).toBe(theme.colors.primary);
    expect(theme.colors.gradientTo).toBe(theme.colors.primaryDark);
  });
});

describe('getThemeById', () => {
  it.each(THEMES.map((t) => t.id))('finds %s', (id) => {
    expect(getThemeById(id).id).toBe(id);
  });

  it.each(['', 'OCEAN', 'nope', 'undefined'])('falls back to the first theme for %j', (id) => {
    expect(getThemeById(id)).toBe(THEMES[0]);
  });
});

describe('applyTheme', () => {
  beforeEach(() => { document.documentElement.removeAttribute('style'); });

  it('writes all 12 --theme-* custom properties on :root', () => {
    const t = getThemeById('ruby').colors;
    applyTheme(t);
    const css = document.documentElement.style;
    expect(css.getPropertyValue('--theme-primary')).toBe(t.primary);
    expect(css.getPropertyValue('--theme-primary-light')).toBe(t.primaryLight);
    expect(css.getPropertyValue('--theme-primary-dark')).toBe(t.primaryDark);
    expect(css.getPropertyValue('--theme-accent')).toBe(t.accent);
    expect(css.getPropertyValue('--theme-accent-light')).toBe(t.accentLight);
    expect(css.getPropertyValue('--theme-gradient-from')).toBe(t.gradientFrom);
    expect(css.getPropertyValue('--theme-gradient-to')).toBe(t.gradientTo);
    expect(css.getPropertyValue('--theme-sidebar-bg')).toBe(t.sidebarBg);
    expect(css.getPropertyValue('--theme-sidebar-bg-end')).toBe(t.sidebarBgEnd);
    expect(css.getPropertyValue('--theme-login-bg-start')).toBe(t.loginBgStart);
    expect(css.getPropertyValue('--theme-login-bg-end')).toBe(t.loginBgEnd);
    expect(css.getPropertyValue('--theme-focus-ring')).toBe(t.focusRing);
  });

  it('switching themes overwrites the previous values', () => {
    applyTheme(getThemeById('ocean').colors);
    applyTheme(getThemeById('forest').colors);
    expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe(getThemeById('forest').colors.primary);
  });
});

describe('theme-styles', () => {
  it('reference the live theme variables, not fixed colours', () => {
    expect(themeGradient.background).toBe('linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))');
    expect(themeGradientBr.background).toContain('to bottom right');
    expect(themeButton).toMatchObject({ background: themeGradient.background, color: '#ffffff' });
    expect(String(themeButton.boxShadow)).toContain('var(--theme-primary)');
  });
});
