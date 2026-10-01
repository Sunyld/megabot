import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BrandMark } from '@/components/brand/BrandMark';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme';

const MIN_VISIBLE_MS = 1300;
const MARK_SIZE = 96;

/**
 * Animated launch screen. Continues the native splash seamlessly (same color,
 * same mark at the same size and position), then fades away once the app is
 * ready and a short brand moment has passed.
 */
export function AppSplash({ ready }: { ready: boolean }) {
  const { colors } = useTheme();
  const [minElapsed, setMinElapsed] = useState(false);
  const scale = useSharedValue(1);
  const wordmark = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    const id = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    scale.value = withSequence(withTiming(1.08, { duration: 220 }), withSpring(1, { damping: 9 }));
    wordmark.value = withDelay(180, withTiming(1, { duration: 420 }));
    progress.value = withDelay(
      400,
      withRepeat(
        withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 0 })),
        -1
      )
    );
    return () => clearTimeout(id);
  }, [scale, wordmark, progress]);

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordmark.value,
    transform: [{ translateY: (1 - wordmark.value) * 8 }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -60 + progress.value * 120 }],
  }));

  if (ready && minElapsed) return null;

  return (
    <Animated.View
      exiting={FadeOut.duration(320)}
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.brand }]}
      accessibilityLabel="A carregar o MegaBot">
      <Animated.View style={markStyle}>
        <BrandMark size={MARK_SIZE} inverse />
      </Animated.View>
      <Animated.View style={[styles.words, wordStyle]}>
        <Text variant="title1" color="onBrand">
          MegaBot
        </Text>
        <Text variant="callout" colorValue="rgba(255,255,255,0.8)">
          Vendas de internet no piloto automático
        </Text>
      </Animated.View>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, barStyle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  words: {
    position: 'absolute',
    top: '50%',
    marginTop: MARK_SIZE / 2 + 24,
    alignItems: 'center',
    gap: 4,
  },
  track: {
    position: 'absolute',
    bottom: 96,
    width: 120,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  bar: {
    width: 60,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
});
