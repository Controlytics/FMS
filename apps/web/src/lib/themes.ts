export interface ThemeColors {
  // Primary action colors (buttons, links, active states)
  primary: string;
  primaryLight: string;
  primaryDark: string;
  // Accent / secondary
  accent: string;
  accentLight: string;
  // Gradients for headers, icons, decorative elements
  gradientFrom: string;
  gradientTo: string;
  // Sidebar
  sidebarBg: string;
  sidebarBgEnd: string;
  // Login background
  loginBgStart: string;
  loginBgEnd: string;
  // Focus ring
  focusRing: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

/**
 * The 10 colour themes. Redesign 2026-10-01:
 *  - `primary`, `primaryDark` and `accent` all clear WCAG AA (4.5:1) against white
 *    text — the previous -600 shades of cyan, emerald, orange and green did not,
 *    and every primary button is white-on-primary.
 *  - Gradients are TONAL (primary -> primaryDark), not two different hues.
 *  - Sidebars are a deep, low-chroma ink of the theme hue.
 * app.css derives the `brand-*` / `accent-*` Tailwind scales from these values.
 */
export const THEMES: Theme[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep cyan — calm and clinical',
    colors: {
      primary: '#0e7490',
      primaryLight: '#ecfeff',
      primaryDark: '#155e75',
      accent: '#0f766e',
      accentLight: '#f0fdfa',
      gradientFrom: '#0e7490',
      gradientTo: '#155e75',
      sidebarBg: '#0f3a4a',
      sidebarBgEnd: '#0b2a37',
      loginBgStart: '#0b1f2a',
      loginBgEnd: '#0f3a4a',
      focusRing: '#0891b2',
    },
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    description: 'Blue & indigo — corporate and formal',
    colors: {
      primary: '#1d4ed8',
      primaryLight: '#eff6ff',
      primaryDark: '#1e40af',
      accent: '#4338ca',
      accentLight: '#eef2ff',
      gradientFrom: '#1d4ed8',
      gradientTo: '#1e40af',
      sidebarBg: '#172554',
      sidebarBgEnd: '#111a3d',
      loginBgStart: '#0b1020',
      loginBgEnd: '#172554',
      focusRing: '#3b82f6',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Emerald green — fresh and clean',
    colors: {
      primary: '#047857',
      primaryLight: '#ecfdf5',
      primaryDark: '#065f46',
      accent: '#0f766e',
      accentLight: '#f0fdfa',
      gradientFrom: '#047857',
      gradientTo: '#065f46',
      sidebarBg: '#073b2e',
      sidebarBgEnd: '#052a21',
      loginBgStart: '#03201a',
      loginBgEnd: '#073b2e',
      focusRing: '#10b981',
    },
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    description: 'Violet — modern and distinctive',
    colors: {
      primary: '#6d28d9',
      primaryLight: '#f5f3ff',
      primaryDark: '#5b21b6',
      accent: '#be185d',
      accentLight: '#fdf2f8',
      gradientFrom: '#6d28d9',
      gradientTo: '#5b21b6',
      sidebarBg: '#2e1065',
      sidebarBgEnd: '#200b47',
      loginBgStart: '#150730',
      loginBgEnd: '#2e1065',
      focusRing: '#8b5cf6',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Burnt orange — warm and energetic',
    colors: {
      primary: '#c2410c',
      primaryLight: '#fff7ed',
      primaryDark: '#9a3412',
      accent: '#b45309',
      accentLight: '#fffbeb',
      gradientFrom: '#c2410c',
      gradientTo: '#9a3412',
      sidebarBg: '#431407',
      sidebarBgEnd: '#2e0e05',
      loginBgStart: '#220a03',
      loginBgEnd: '#431407',
      focusRing: '#f97316',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Slate grey — minimal and neutral',
    colors: {
      primary: '#334155',
      primaryLight: '#f1f5f9',
      primaryDark: '#1e293b',
      accent: '#0e7490',
      accentLight: '#ecfeff',
      gradientFrom: '#334155',
      gradientTo: '#1e293b',
      sidebarBg: '#1e293b',
      sidebarBgEnd: '#0f172a',
      loginBgStart: '#0b1120',
      loginBgEnd: '#1e293b',
      focusRing: '#64748b',
    },
  },
  {
    id: 'ruby',
    name: 'Ruby',
    description: 'Deep red — bold and attention-grabbing',
    colors: {
      primary: '#b91c1c',
      primaryLight: '#fef2f2',
      primaryDark: '#991b1b',
      accent: '#be123c',
      accentLight: '#fff1f2',
      gradientFrom: '#b91c1c',
      gradientTo: '#991b1b',
      sidebarBg: '#450a0a',
      sidebarBgEnd: '#300707',
      loginBgStart: '#220505',
      loginBgEnd: '#450a0a',
      focusRing: '#ef4444',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Forest green — earthy and grounded',
    colors: {
      primary: '#15803d',
      primaryLight: '#f0fdf4',
      primaryDark: '#166534',
      accent: '#4d7c0f',
      accentLight: '#f7fee7',
      gradientFrom: '#15803d',
      gradientTo: '#166534',
      sidebarBg: '#052e16',
      sidebarBgEnd: '#04200f',
      loginBgStart: '#03180b',
      loginBgEnd: '#052e16',
      focusRing: '#22c55e',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Navy & sky — deep and professional',
    colors: {
      primary: '#1e40af',
      primaryLight: '#eff6ff',
      primaryDark: '#1e3a8a',
      accent: '#0369a1',
      accentLight: '#f0f9ff',
      gradientFrom: '#1e40af',
      gradientTo: '#1e3a8a',
      sidebarBg: '#111c44',
      sidebarBgEnd: '#0a1230',
      loginBgStart: '#060b1f',
      loginBgEnd: '#111c44',
      focusRing: '#3b82f6',
    },
  },
  {
    id: 'coral',
    name: 'Coral',
    description: 'Rose pink — soft and friendly',
    colors: {
      primary: '#be185d',
      primaryLight: '#fdf2f8',
      primaryDark: '#9d174d',
      accent: '#c2410c',
      accentLight: '#fff7ed',
      gradientFrom: '#be185d',
      gradientTo: '#9d174d',
      sidebarBg: '#500724',
      sidebarBgEnd: '#38051a',
      loginBgStart: '#280312',
      loginBgEnd: '#500724',
      focusRing: '#ec4899',
    },
  },
];

export const DEFAULT_THEME_ID = 'ocean';

export function getThemeById(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}

/** Apply theme colors as CSS custom properties on :root */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty('--theme-primary', colors.primary);
  root.style.setProperty('--theme-primary-light', colors.primaryLight);
  root.style.setProperty('--theme-primary-dark', colors.primaryDark);
  root.style.setProperty('--theme-accent', colors.accent);
  root.style.setProperty('--theme-accent-light', colors.accentLight);
  root.style.setProperty('--theme-gradient-from', colors.gradientFrom);
  root.style.setProperty('--theme-gradient-to', colors.gradientTo);
  root.style.setProperty('--theme-sidebar-bg', colors.sidebarBg);
  root.style.setProperty('--theme-sidebar-bg-end', colors.sidebarBgEnd);
  root.style.setProperty('--theme-login-bg-start', colors.loginBgStart);
  root.style.setProperty('--theme-login-bg-end', colors.loginBgEnd);
  root.style.setProperty('--theme-focus-ring', colors.focusRing);
}
