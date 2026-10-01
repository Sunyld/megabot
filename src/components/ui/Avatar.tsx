import { View } from 'react-native';

import { type IconName, type Tone, useTheme } from '@/theme';
import { initials } from '@/utils/format';

import { Icon } from './Icon';
import { Text } from './Text';

const tones: Tone[] = ['info', 'success', 'warning', 'ai', 'brand', 'neutral'];

function toneFor(seed: string): Tone {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

export type AvatarProps = {
  name?: string;
  icon?: IconName;
  tone?: Tone;
  size?: number;
  shape?: 'circle' | 'rounded';
};

/** Initials avatar, or a tinted icon well when `icon` is given. */
export function Avatar({ name = '', icon, tone, size = 40, shape = 'circle' }: AvatarProps) {
  const { colors, radius } = useTheme();
  const palette = colors.tones[tone ?? toneFor(name)];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: shape === 'circle' ? size / 2 : radius.md,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {icon ? (
        <Icon name={icon} size={Math.round(size * 0.5)} color={palette.fg} />
      ) : (
        <Text variant={size >= 48 ? 'title3' : 'calloutStrong'} colorValue={palette.fg}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
