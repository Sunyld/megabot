import { View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { type IconName, useTheme } from '@/theme';
import type { Device } from '@/types';

type Battery = NonNullable<Device['battery']>;
type Network = NonNullable<Device['network']>;

export function batteryIcon(battery: Battery | null): IconName {
  if (!battery) return 'batteryMid';
  const { level, charging } = battery;
  if (charging) return 'batteryCharging';
  if (level >= 90) return 'batteryFull';
  if (level >= 60) return 'batteryHigh';
  if (level >= 35) return 'batteryMid';
  if (level >= 15) return 'batteryLow';
  return 'batteryAlert';
}

export const networkIcon = (network: Network | null): IconName =>
  !network || network.type === 'none' ? 'signalOff' : network.type === 'WiFi' ? 'wifi' : 'signal';

/** `null` = the worker has not reported it: shown as unknown, never guessed. */
export function BatteryIndicator({ battery, muted }: { battery: Battery | null; muted?: boolean }) {
  const { colors } = useTheme();
  const low = !!battery && battery.level < 25 && !battery.charging;
  const color = muted || !battery ? colors.textMuted : low ? colors.tones.warning.fg : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={batteryIcon(battery)} size={18} color={color} />
      <Text variant="captionStrong" colorValue={color} tabular>
        {battery ? `${battery.level}%` : '—'}
      </Text>
    </View>
  );
}

export function SignalIndicator({ network, muted }: { network: Network | null; muted?: boolean }) {
  const { colors } = useTheme();
  const none = !network || network.type === 'none';
  const color = muted || none ? colors.textMuted : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={networkIcon(network)} size={18} color={color} />
      <Text variant="captionStrong" colorValue={color}>
        {!network ? 'Rede —' : network.type === 'none' ? 'Sem rede' : network.type}
      </Text>
    </View>
  );
}
