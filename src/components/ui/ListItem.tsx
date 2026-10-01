import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type ListItemProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconTone?: Tone;
  leading?: ReactNode;
  trailing?: ReactNode;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ListItem({
  title,
  subtitle,
  icon,
  iconTone = 'neutral',
  leading,
  trailing,
  value,
  chevron,
  destructive,
  onPress,
  divider,
  style,
}: ListItemProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tone = destructive ? 'danger' : iconTone;

  const content = (
    <>
      {leading ??
        (icon && (
          <View style={[styles.iconWell, { backgroundColor: colors.tones[tone].bg }]}>
            <Icon name={icon} size={20} color={colors.tones[tone].fg} />
          </View>
        ))}
      <View style={styles.body}>
        <Text variant="bodyMedium" color={destructive ? 'danger' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" color="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="secondary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron && <Icon name="chevronRight" size={20} color={colors.textMuted} />}
    </>
  );

  const rowStyle = [styles.row, divider && styles.divider, style];

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.surfacePressed }]}>
      {content}
    </Pressable>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    minHeight: 56,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  value: {
    maxWidth: '45%',
  },
}));
