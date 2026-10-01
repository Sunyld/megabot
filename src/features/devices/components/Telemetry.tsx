import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { type IconName, useTheme } from '@/theme';
import type { Device } from '@/types';

export function batteryIcon({ level, charging }: Device['battery']): IconName {
  if (charging) return 'batteryCharging';
  if (level >= 90) return 'batteryFull';
  if (level >= 60) return 'batteryHigh';
  if (level >= 35) return 'batteryMid';
  if (level >= 15) return 'batteryLow';
  return 'batteryAlert';
}

export function BatteryIndicator({ battery, muted }: { battery: Device['battery']; muted?: boolean }) {
  const { colors } = useTheme();
  const low = battery.level < 25 && !battery.charging;
  const color = muted ? colors.textMuted : low ? colors.tones.warning.fg : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={batteryIcon(battery)} size={18} color={color} />
      <Text variant="captionStrong" colorValue={color} tabular>
        {`${battery.level}%`}
      </Text>
    </View>
  );
}

export function SignalIndicator({ network, muted }: { network: Device['network']; muted?: boolean }) {
  const { colors } = useTheme();
  const none = network.type === 'none';
  const color = muted || none ? colors.textMuted : colors.textSecondary;
  const icon: IconName = none ? 'signalOff' : network.type === 'WiFi' ? 'wifi' : 'signal';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={18} color={color} />
      <Text variant="captionStrong" colorValue={color}>
        {none ? 'Sem rede' : network.type}
      </Text>
    </View>
  );
}
