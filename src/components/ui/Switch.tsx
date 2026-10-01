import { Platform, Switch as RNSwitch } from 'react-native';

import { useTheme } from '@/theme';

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function Switch({ value, onValueChange, disabled, accessibilityLabel }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.borderStrong, true: colors.tones.success.solid }}
      thumbColor={Platform.OS === 'ios' ? undefined : '#FFFFFF'}
      {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF' } as object) : null)}
      ios_backgroundColor={colors.borderStrong}
    />
  );
}
