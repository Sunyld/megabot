import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { type Tone, useTheme } from '@/theme';

export type ProgressBarProps = {
  /** 0..1 */
  value: number;
  tone?: Tone;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/** Meter: the fill carries severity; the track is a lighter step of the same tone. */
export function ProgressBar({ value, tone = 'brand', height = 6, style }: ProgressBarProps) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(clamped, { duration: 600 });
  }, [clamped, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[{ height, borderRadius: height / 2, backgroundColor: colors.tones[tone].bg, overflow: 'hidden' }, style]}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: colors.tones[tone].solid }, fill]} />
    </View>
  );
}
