import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { type Tone, useTheme } from '@/theme';

export type StatusDotProps = {
  tone: Tone;
  size?: number;
  /** Soft "live" pulse, for healthy real-time systems. */
  pulse?: boolean;
};

export function StatusDot({ tone, size = 8, pulse = false }: StatusDotProps) {
  const { colors } = useTheme();
  const color = colors.tones[tone].solid;
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!pulse) return;
    progress.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(progress);
  }, [pulse, progress]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.6 }],
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {pulse && (
        <Animated.View
          style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
