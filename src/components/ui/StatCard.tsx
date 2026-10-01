import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Card } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';

export type StatCardProps = {
  label: string;
  value: string;
  icon?: IconName;
  tone?: Tone;
  caption?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Stat tile: sentence-case label, a semibold value in proportional figures,
 * optional caption. The tone colors only the icon well — never the value.
 */
export function StatCard({ label, value, icon, tone = 'neutral', caption, onPress, style }: StatCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <Card onPress={onPress} style={[styles.card, style]} padding={14} accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.header}>
        <Text variant="callout" color="secondary" numberOfLines={2} style={styles.label}>
          {label}
        </Text>
        {icon && (
          <View style={[styles.well, { backgroundColor: colors.tones[tone].bg }]}>
            <Icon name={icon} size={16} color={colors.tones[tone].fg} />
          </View>
        )}
      </View>
      <Text variant="stat" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" color="muted" numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    flex: 1,
    gap: t.spacing.xs,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
    marginBottom: 2,
  },
  label: {
    flex: 1,
  },
  well: {
    width: 28,
    height: 28,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
