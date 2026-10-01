import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { createStyles, useTheme } from '@/theme';

import { Text } from './Text';

export type BarDatum = { key: string; label: string; value: number; detail?: string };

export type BarChartProps = {
  data: BarDatum[];
  height?: number;
  /** Index drawn in the accent color (e.g. the current hour). */
  highlightIndex?: number;
  formatValue: (value: number) => string;
  /** Show every n-th x label to avoid collisions on narrow screens. */
  labelEvery?: number;
  accessibilityLabel: string;
};

/**
 * Single-series column chart. Bars are ≤ 24px with 4px rounded tops anchored
 * to a hairline baseline; the highlighted period uses the accent and the rest
 * a recessive neutral. Tap a column to read its value (the "tooltip" row).
 */
export function BarChart({
  data,
  height = 112,
  highlightIndex,
  formatValue,
  labelEvery = 3,
  accessibilityLabel,
}: BarChartProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const active = selected ?? highlightIndex ?? data.length - 1;
  const activeDatum = data[active];

  return (
    <View accessibilityLabel={accessibilityLabel}>
      {activeDatum && (
        <View style={styles.readout}>
          <Text variant="captionStrong" color="secondary">
            {activeDatum.label}
          </Text>
          <Text variant="captionStrong" tabular>
            {formatValue(activeDatum.value)}
            {activeDatum.detail ? (
              <Text variant="caption" color="muted">
                {`  ·  ${activeDatum.detail}`}
              </Text>
            ) : null}
          </Text>
        </View>
      )}
      <View style={[styles.plot, { height }]}>
        {data.map((d, i) => {
          const barHeight = d.value > 0 ? Math.max(4, (d.value / max) * height) : 2;
          const isActive = i === active;
          const color =
            i === highlightIndex ? colors.chart.barHighlight : isActive ? colors.textSecondary : colors.chart.bar;
          return (
            <Pressable
              key={d.key}
              onPress={() => setSelected(i === selected ? null : i)}
              style={styles.slot}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${formatValue(d.value)}`}>
              <Animated.View
                entering={FadeIn.delay(i * 25).duration(300)}
                style={[
                  styles.bar,
                  { height: barHeight, backgroundColor: d.value > 0 ? color : colors.chart.grid },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.baseline} />
      <View style={styles.labels}>
        {data.map((d, i) => (
          <View key={d.key} style={styles.slotLabel}>
            {(i % labelEvery === 0 || i === data.length - 1) && (
              <Text variant="caption" color="muted" numberOfLines={1} style={styles.labelText}>
                {d.key}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createStyles((t) => ({
  readout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: t.spacing.sm,
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  slot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '78%',
    maxWidth: 24,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  baseline: {
    height: 1,
    backgroundColor: t.colors.border,
  },
  labels: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 6,
  },
  slotLabel: {
    flex: 1,
    alignItems: 'center',
    overflow: 'visible',
  },
  labelText: {
    fontSize: 10,
    width: 32,
    textAlign: 'center',
  },
}));
