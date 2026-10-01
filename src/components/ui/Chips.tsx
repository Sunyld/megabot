import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, useTheme } from '@/theme';

import { Text } from './Text';

export type FilterChipProps = {
  label: string;
  count?: number;
  selected?: boolean;
  onPress?: () => void;
};

export function FilterChip({ label, count, selected = false, onPress }: FilterChipProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.idle,
        pressed && !selected && { backgroundColor: colors.surfacePressed },
      ]}>
      <Text variant="calloutStrong" colorValue={selected ? colors.textInverse : colors.text}>
        {label}
      </Text>
      {count !== undefined && (
        <View style={[styles.count, { backgroundColor: selected ? 'rgba(255,255,255,0.18)' : colors.surfaceMuted }]}>
          <Text variant="captionStrong" colorValue={selected ? colors.textInverse : colors.textSecondary}>
            {count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export type ChipOption<T extends string> = { value: T; label: string; count?: number };

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.group}
      style={style}
      accessibilityRole="tablist">
      {options.map((option) => (
        <FilterChip
          key={option.value}
          label={option.label}
          count={option.count}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}>
            <Text
              variant="calloutStrong"
              colorValue={selected ? colors.text : colors.textSecondary}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  group: {
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.gutter,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: t.radius.pill,
  },
  idle: {
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  selected: {
    backgroundColor: t.colors.surfaceInverse,
    borderWidth: 1,
    borderColor: t.colors.surfaceInverse,
  },
  count: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.sm,
    paddingHorizontal: 4,
  },
  segmentSelected: {
    backgroundColor: t.colors.surface,
    ...t.shadows.sm,
  },
}));
