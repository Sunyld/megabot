import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme, type Tone, type TypographyVariant } from '@/theme';

export type TextColor = 'primary' | 'secondary' | 'muted' | 'inverse' | 'onBrand' | Tone;

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: TextColor;
  /** Explicit color value; wins over `color`. Use sparingly. */
  colorValue?: string;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
  /** Tabular digits — for numbers aligned in columns. */
  tabular?: boolean;
};

export function Text({
  variant = 'body',
  color = 'primary',
  colorValue,
  align,
  weight,
  tabular,
  style,
  ...rest
}: TextProps) {
  const { colors, typography } = useTheme();

  const resolved =
    colorValue ??
    (color === 'primary'
      ? colors.text
      : color === 'secondary'
        ? colors.textSecondary
        : color === 'muted'
          ? colors.textMuted
          : color === 'inverse'
            ? colors.textInverse
            : color === 'onBrand'
              ? colors.onBrand
              : colors.tones[color].fg);

  return (
    <RNText
      maxFontSizeMultiplier={1.4}
      style={[
        typography[variant],
        { color: resolved },
        align && { textAlign: align },
        weight !== undefined && { fontWeight: weight },
        tabular && { fontVariant: ['tabular-nums'] },
        style,
      ]}
      {...rest}
    />
  );
}
