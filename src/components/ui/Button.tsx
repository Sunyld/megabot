import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type IconName, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

const heights: Record<ButtonSize, number> = { sm: 36, md: 46, lg: 54 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const palette = {
    primary: { bg: colors.brand, pressed: colors.brandPressed, fg: colors.onBrand, border: 'transparent' },
    secondary: { bg: colors.surfaceMuted, pressed: colors.surfacePressed, fg: colors.text, border: 'transparent' },
    outline: { bg: 'transparent', pressed: colors.surfaceMuted, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', pressed: colors.surfaceMuted, fg: colors.tones.brand.fg, border: 'transparent' },
    danger: { bg: colors.tones.danger.bg, pressed: colors.surfacePressed, fg: colors.tones.danger.fg, border: 'transparent' },
    success: { bg: colors.tones.success.solid, pressed: colors.tones.success.fg, fg: '#FFFFFF', border: 'transparent' },
  }[variant];

  const inactive = disabled || loading;
  const iconSize = size === 'sm' ? 18 : 20;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
        },
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <View style={styles.content}>
          {icon && <Icon name={icon} size={iconSize} color={palette.fg} />}
          <Text
            variant={size === 'sm' ? 'calloutStrong' : 'bodyStrong'}
            colorValue={palette.fg}
            numberOfLines={1}>
            {label}
          </Text>
          {iconRight && <Icon name={iconRight} size={iconSize} color={palette.fg} />}
        </View>
      )}
    </Pressable>
  );
}

const useStyles = createStyles((t) => ({
  base: {
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.45,
  },
}));
