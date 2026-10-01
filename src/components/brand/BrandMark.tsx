import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme';

/**
 * MegaBot mark: a chat bubble carrying signal bars — selling connectivity
 * through conversations. Drawn with views so it stays crisp at any size.
 * Keep in sync with scripts/generate-brand-assets.mjs (app icon & splash).
 */
export function BrandMark({ size = 48, inverse = false }: { size?: number; inverse?: boolean }) {
  const { colors } = useTheme();
  const tile = inverse ? '#FFFFFF' : colors.brand;
  const bubble = inverse ? colors.brand : '#FFFFFF';
  const bar = inverse ? '#FFFFFF' : colors.brand;

  const bubbleW = size * 0.62;
  const bubbleH = size * 0.46;
  const barW = size * 0.075;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="MegaBot"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: tile,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View style={{ width: bubbleW, height: bubbleH + size * 0.08, marginTop: -size * 0.02 }}>
        <View
          style={{
            width: bubbleW,
            height: bubbleH,
            borderRadius: size * 0.13,
            backgroundColor: bubble,
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: size * 0.05,
            paddingBottom: bubbleH * 0.22,
          }}>
          {[0.32, 0.5, 0.68].map((h) => (
            <View key={h} style={{ width: barW, height: bubbleH * h, borderRadius: barW / 2, backgroundColor: bar }} />
          ))}
        </View>
        <View
          style={{
            position: 'absolute',
            left: bubbleW * 0.185,
            bottom: size * 0.025,
            width: size * 0.13,
            height: size * 0.13,
            backgroundColor: bubble,
            transform: [{ rotate: '45deg' }],
            borderBottomRightRadius: size * 0.02,
          }}
        />
      </View>
    </View>
  );
}

export function BrandLockup({ size = 36, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }}>
      <BrandMark size={size} inverse={inverse} />
      <Text
        variant="title2"
        color={inverse ? 'onBrand' : 'primary'}
        style={{ fontSize: size * 0.62, lineHeight: size * 0.8, letterSpacing: -0.5 }}>
        MegaBot
      </Text>
    </View>
  );
}
