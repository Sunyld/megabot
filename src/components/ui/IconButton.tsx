import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, hitSlop, type IconName, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type IconButtonProps = {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'tonal' | 'surface';
  size?: number;
  iconColor?: string;
  badge?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = 40,
  iconColor,
  badge,
  disabled,
  style,
}: IconButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const bg = variant === 'tonal' ? colors.surfaceMuted : variant === 'surface' ? colors.surface : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${accessibilityLabel}, ${badge} novas` : accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: pressed ? colors.surfacePressed : bg },
        variant === 'surface' && styles.surface,
        disabled && { opacity: 0.4 },
        style,
      ]}>
      <Icon name={icon} size={Math.round(size * 0.55)} color={iconColor ?? colors.text} />
      {badge ? (
        <View style={styles.badge}>
          <Text variant="captionStrong" color="onBrand" style={styles.badgeText}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = createStyles((t) => ({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  surface: {
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: t.colors.brand,
    borderWidth: 2,
    borderColor: t.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
  },
}));
