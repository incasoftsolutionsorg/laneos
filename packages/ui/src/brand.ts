// Tenant brand colour and seasonal themes (Figma 1-3701). These are the only colour values outside
// theme.css: they are choices a shop stores, applied by overriding the brand tokens at runtime.

/** Swatches offered under "Brand colour". The first is the LaneOS default (theme.css --color-brand-primary). */
export const BRAND_SWATCHES = ['#0E7C66', '#1D4ED8', '#B91C1C', '#7C3AED', '#C2410C', '#111827'] as const;

export interface Season { key: string; name: string; text: string; color: string; accent: string }

export const SEASONS: Season[] = [
  { key: 'default', name: 'LaneOS default', text: 'Everyday green theme', color: '#0E7C66', accent: '#CFEDE5' },
  { key: 'christmas', name: 'Christmas', text: 'Red & green, snow accents on lanes', color: '#B91C1C', accent: '#15803D' },
  { key: 'awurudu', name: 'Awurudu (New Year)', text: 'Sinhala & Tamil New Year · April', color: '#C2410C', accent: '#FACC15' },
  { key: 'vesak', name: 'Vesak', text: 'Lantern colours · May', color: '#1D4ED8', accent: '#FDE68A' },
  { key: 'deepavali', name: 'Deepavali', text: 'Festival of lights · Oct/Nov', color: '#7C3AED', accent: '#F59E0B' },
  { key: 'ramadan', name: 'Ramadan & Eid', text: 'Crescent accents', color: '#065F46', accent: '#FDE68A' },
];

/** Theme in force on a day. Auto-apply covers the fixed-date seasons; Deepavali and Ramadan move each year, so they are set by hand. */
export function activeSeason(theme: string, auto: boolean, on: Date = new Date()): Season | null {
  if (theme !== 'default') return SEASONS.find((s) => s.key === theme) ?? null;
  if (!auto) return null;
  const local = new Date(on.getTime() + 5.5 * 3600_000);
  const m = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  if (m === 4 && d >= 10 && d <= 16) return SEASONS.find((s) => s.key === 'awurudu')!;
  if (m === 5 && d >= 10 && d <= 20) return SEASONS.find((s) => s.key === 'vesak')!;
  if (m === 12) return SEASONS.find((s) => s.key === 'christmas')!;
  return null;
}

/** Inline style that re-points the brand tokens at a colour. Lighter and darker steps are mixed from it. */
export function brandStyle(color: string | null | undefined): Record<string, string> | undefined {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color) || color.toUpperCase() === BRAND_SWATCHES[0]) return undefined;
  return {
    '--color-brand-primary': color,
    '--color-brand-dark': `color-mix(in srgb, ${color} 78%, black)`,
    '--color-brand-light': `color-mix(in srgb, ${color} 10%, white)`,
    '--color-brand-soft': `color-mix(in srgb, ${color} 22%, white)`,
  };
}
