import type { PropsWithChildren } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, useTheme } from '@/theme';

export type CardProps = PropsWithChildren<{
  onPress?: () => void;
  variant?: 'default' | 'muted' | 'brand' | 'inverse';
  padding?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}>;

export function Card({ children, onPress, variant = 'default', padding, style, accessibilityLabel }: CardProps) {
  const { colors, spacing } = useTheme();
  const styles = useStyles();

  const base = [styles.card, styles[variant], { padding: padding ?? spacing.lg }, style];

  if (!onPress) {
    return <View style={base}>{children}</View>;
  }

  const pressedBg =
    variant === 'brand' ? colors.brandPressed : variant === 'inverse' ? colors.surfaceInverse : colors.surfacePressed;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { backgroundColor: pressedBg }]}>
      {children}
    </Pressable>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    borderRadius: t.radius.lg,
  },
  default: {
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadows.sm,
  },
  muted: {
    backgroundColor: t.colors.surfaceMuted,
  },
  brand: {
    backgroundColor: t.colors.brand,
  },
  inverse: {
    backgroundColor: t.colors.surfaceInverse,
  },
}));
