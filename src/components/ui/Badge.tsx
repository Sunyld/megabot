import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type BadgeProps = {
  label: string;
  tone?: Tone;
  icon?: IconName;
  /** Leading status dot instead of an icon. */
  dot?: boolean;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
};

export function Badge({ label, tone = 'neutral', icon, dot, variant = 'soft', size = 'md', style }: BadgeProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const palette = colors.tones[tone];

  const bg = variant === 'solid' ? palette.solid : variant === 'soft' ? palette.bg : 'transparent';
  const fg = variant === 'solid' ? '#FFFFFF' : palette.fg;

  return (
    <View
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1, borderColor: palette.solid },
        style,
      ]}>
      {dot && <View style={[styles.dot, { backgroundColor: variant === 'solid' ? '#FFFFFF' : palette.solid }]} />}
      {icon && !dot && <Icon name={icon} size={size === 'sm' ? 12 : 14} color={fg} />}
      <Text variant="captionStrong" colorValue={fg} numberOfLines={1} style={size === 'sm' && styles.smText}>
        {label}
      </Text>
    </View>
  );
}

/** Badge driven by a domain status definition (see features/<x>/status.ts). */
export type StatusMeta = { label: string; tone: Tone; icon: IconName };

export function StatusBadge({ meta, size, style }: { meta: StatusMeta; size?: BadgeProps['size']; style?: StyleProp<ViewStyle> }) {
  return <Badge label={meta.label} tone={meta.tone} icon={meta.icon} size={size} style={style} />;
}

const useStyles = createStyles((t) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: t.radius.pill,
  },
  md: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  smText: {
    fontSize: 11,
    lineHeight: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
}));
