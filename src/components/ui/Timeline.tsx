import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Icon } from './Icon';
import { StatusDot } from './StatusDot';
import { Text } from './Text';

export type TimelineState = 'done' | 'current' | 'pending' | 'failed' | 'warning';

export type TimelineItem = {
  key: string;
  title: string;
  description?: string;
  time?: string;
  state: TimelineState;
  icon?: IconName;
};

const stateTone: Record<TimelineState, Tone> = {
  done: 'success',
  current: 'info',
  pending: 'neutral',
  failed: 'danger',
  warning: 'warning',
};

const stateIcon: Record<TimelineState, IconName> = {
  done: 'check',
  current: 'dot',
  pending: 'dot',
  failed: 'close',
  warning: 'priority',
};

export function Timeline({ items, animated = true }: { items: TimelineItem[]; animated?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View accessibilityRole="list">
      {items.map((item, index) => {
        const tone = colors.tones[stateTone[item.state]];
        const last = index === items.length - 1;
        const pending = item.state === 'pending';
        const nextDone = items[index + 1] && items[index + 1].state !== 'pending';

        return (
          <Animated.View
            key={item.key}
            entering={animated ? FadeInDown.delay(index * 45).duration(260) : undefined}
            style={styles.row}
            accessibilityLabel={`${item.title}${item.time ? `, ${item.time}` : ''}`}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.node,
                  pending
                    ? { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 2 }
                    : { backgroundColor: item.state === 'current' ? tone.bg : tone.solid },
                ]}>
                {item.state === 'current' ? (
                  <StatusDot tone="info" size={8} pulse />
                ) : pending ? null : (
                  <Icon name={item.icon ?? stateIcon[item.state]} size={14} color="#FFFFFF" />
                )}
              </View>
              {!last && (
                <View style={[styles.line, { backgroundColor: nextDone ? tone.solid : colors.border }]} />
              )}
            </View>
            <View style={[styles.content, !last && styles.contentSpacing]}>
              <View style={styles.titleRow}>
                <Text variant="bodyMedium" color={pending ? 'muted' : 'primary'} style={styles.title}>
                  {item.title}
                </Text>
                {item.time ? (
                  <Text variant="caption" color="muted" tabular>
                    {item.time}
                  </Text>
                ) : null}
              </View>
              {item.description ? (
                <Text variant="callout" color={item.state === 'failed' ? 'danger' : 'secondary'}>
                  {item.description}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  rail: {
    alignItems: 'center',
    width: 24,
  },
  node: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    flex: 1,
    width: 2,
    marginVertical: 2,
    borderRadius: 1,
  },
  content: {
    flex: 1,
    gap: 2,
    paddingTop: 2,
  },
  contentSpacing: {
    paddingBottom: t.spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.sm,
  },
  title: {
    flex: 1,
  },
}));
