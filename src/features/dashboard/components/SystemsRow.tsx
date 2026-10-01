import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Text } from '@/components/ui/Text';
import { createStyles, type IconName, type Tone, useTheme } from '@/theme';
import type { DashboardSummary } from '@/types';

type Tile = { key: string; icon: IconName; label: string; value: string; tone: Tone; pulse: boolean; href: Href };

/** Health of the three pillars the automation depends on. */
export function SystemsRow({ systems }: { systems: DashboardSummary['systems'] }) {
  const { colors } = useTheme();
  const styles = useStyles();

  const allDevices = systems.devicesOnline === systems.devicesTotal;
  const tiles: Tile[] = [
    {
      key: 'devices',
      icon: 'devices',
      label: 'Dispositivos',
      value: `${systems.devicesOnline}/${systems.devicesTotal} online`,
      tone: systems.devicesOnline === 0 ? 'danger' : allDevices ? 'success' : 'warning',
      pulse: systems.devicesOnline > 0,
      href: '/devices',
    },
    {
      key: 'whatsapp',
      icon: 'whatsapp',
      label: 'WhatsApp',
      value: systems.whatsapp === 'connected' ? 'Conectado' : systems.whatsapp === 'connecting' ? 'A ligar…' : 'Desligado',
      tone: systems.whatsapp === 'connected' ? 'success' : systems.whatsapp === 'connecting' ? 'warning' : 'danger',
      pulse: systems.whatsapp === 'connected',
      href: '/whatsapp',
    },
    {
      key: 'payments',
      icon: 'sms',
      label: 'Pagamentos',
      value: systems.paymentsMonitoring ? 'Monitorando' : 'Pausado',
      tone: systems.paymentsMonitoring ? 'success' : 'warning',
      pulse: systems.paymentsMonitoring,
      href: '/payments',
    },
  ];

  return (
    <View style={styles.row}>
      {tiles.map((tile) => (
        <Card
          key={tile.key}
          padding={12}
          style={styles.tile}
          onPress={() => router.navigate(tile.href)}
          accessibilityLabel={`${tile.label}: ${tile.value}`}>
          <Icon name={tile.icon} size={20} color={colors.textSecondary} />
          <Text variant="caption" color="secondary" numberOfLines={1}>
            {tile.label}
          </Text>
          <View style={styles.status}>
            <StatusDot tone={tile.tone} pulse={tile.pulse} size={7} />
            <Text variant="captionStrong" numberOfLines={1} style={styles.flex} adjustsFontSizeToFit minimumFontScale={0.85}>
              {tile.value}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    gap: t.spacing.sm,
  },
  tile: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flex: {
    flex: 1,
  },
}));
