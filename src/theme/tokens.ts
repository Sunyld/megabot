import { Platform, type TextStyle } from 'react-native';

/** 4pt spacing scale. `gutter` is the horizontal screen padding (fits 360dp screens). */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  gutter: 16,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

const fontFamily = Platform.select({
  ios: { sans: 'System', mono: 'Menlo' },
  android: { sans: 'sans-serif', mono: 'monospace' },
  default: { sans: 'System', mono: 'monospace' },
});

export type TypographyVariant =
  | 'hero'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'body'
  | 'bodyMedium'
  | 'bodyStrong'
  | 'callout'
  | 'calloutStrong'
  | 'caption'
  | 'captionStrong'
  | 'overline'
  | 'stat'
  | 'mono'
  | 'monoSmall';

/**
 * Type scale. Large standalone figures use proportional digits;
 * `tabular` is applied per-usage (aligned columns) via the Text component.
 */
export const typography: Record<TypographyVariant, TextStyle> = {
  hero: { fontSize: 40, lineHeight: 46, fontWeight: 700, letterSpacing: -0.8 },
  title1: { fontSize: 26, lineHeight: 32, fontWeight: 700, letterSpacing: -0.4 },
  title2: { fontSize: 20, lineHeight: 26, fontWeight: 700, letterSpacing: -0.2 },
  title3: { fontSize: 17, lineHeight: 22, fontWeight: 600 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: 400 },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: 500 },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: 600 },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  calloutStrong: { fontSize: 14, lineHeight: 20, fontWeight: 600 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: 500 },
  captionStrong: { fontSize: 12, lineHeight: 16, fontWeight: 700 },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stat: { fontSize: 24, lineHeight: 30, fontWeight: 700, letterSpacing: -0.4 },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: 600, fontFamily: fontFamily.mono },
  monoSmall: { fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: fontFamily.mono },
};

export const fonts = fontFamily;

/**
 * Elevation. Cards rely primarily on a hairline border for definition; shadows
 * stay subtle so the UI never looks heavy.
 */
export const shadows = {
  none: {},
  sm: { boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)' },
  md: { boxShadow: '0px 4px 12px rgba(16, 24, 40, 0.08)' },
  lg: { boxShadow: '0px 12px 32px rgba(16, 24, 40, 0.16)' },
} as const;

export const motion = {
  fast: 150,
  base: 220,
  slow: 360,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
