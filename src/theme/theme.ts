import { palettes, type ColorSchemeName, type ColorTokens } from './colors';
import { motion, radius, shadows, spacing, typography } from './tokens';

export type Theme = {
  scheme: ColorSchemeName;
  isDark: boolean;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadows: typeof shadows;
  motion: typeof motion;
};

const build = (scheme: ColorSchemeName): Theme => ({
  scheme,
  isDark: scheme === 'dark',
  colors: palettes[scheme],
  spacing,
  radius,
  typography,
  shadows,
  motion,
});

/** Stable theme objects (one per scheme) so memoized styles can be cached by identity. */
export const themes: Record<ColorSchemeName, Theme> = {
  light: build('light'),
  dark: build('dark'),
};
