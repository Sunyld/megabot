import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Text } from '@/components/ui/Text';
import { deviceStatusMeta } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { Device, Sim } from '@/types';
import { formatRelativeLong } from '@/utils/format';

import { SimChip } from './SimCard';
import { BatteryIndicator, SignalIndicator } from './Telemetry';

export function DeviceCard({ device, sims, now }: { device: Device; sims: Sim[]; now?: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const offline = device.status === 'offline';
  const status = deviceStatusMeta[device.status];

  return (
    <Card
      padding={16}
      style={styles.card}
      onPress={() => router.push({ pathname: '/devices/[id]', params: { id: device.id } })}
      accessibilityLabel={`${device.name}, ${status.label}`}>
      <View style={styles.header}>
        <View style={[styles.phone, offline && styles.phoneOffline]}>
          <Icon name="devices" size={24} color={offline ? colors.textMuted : colors.text} />
        </View>
        <View style={styles.flex}>
          <Text variant="title3" numberOfLines={1}>
            {device.name}
          </Text>
          <View style={styles.nameRow}>
            <Text variant="caption" color="muted" numberOfLines={1} style={styles.flexShrink}>
              {device.model}
            </Text>
            {device.role === 'primary' && <Badge label="Principal" tone="brand" size="sm" />}
          </View>
        </View>
        <View style={styles.status}>
          <StatusDot tone={status.tone} pulse={device.status === 'online'} />
          <Text variant="captionStrong" color={offline ? 'muted' : status.tone}>
            {status.label}
          </Text>
        </View>
      </View>

      {offline ? (
        <View style={styles.offline}>
          <Text variant="callout" color="secondary">
            {`Última ligação ${formatRelativeLong(device.lastSeenAt, now)}`}
          </Text>
          <View style={styles.redirect}>
            <Icon name="failover" size={16} color={colors.tones.info.fg} />
            <Text variant="caption" color="info" style={styles.flex}>
              As tarefas são redirecionadas para outro dispositivo disponível.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.telemetry}>
          <BatteryIndicator battery={device.battery} />
          <SignalIndicator network={device.network} />
          <View style={styles.tasks}>
            <Icon name="bolt" size={16} color={colors.textSecondary} />
            <Text variant="captionStrong" color="secondary">
              {`${device.usage.tasksToday} tarefas hoje`}
            </Text>
          </View>
        </View>
      )}

      {sims.length > 0 && (
        <View style={styles.sims}>
          {sims.map((sim) => (
            <SimChip key={sim.id} sim={sim} />
          ))}
        </View>
      )}
      {device.status === 'paused' && <StatusBadge meta={status} size="sm" />}
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    gap: t.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  phone: {
    width: 44,
    height: 44,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceMuted,
  },
  phoneOffline: {
    opacity: 0.6,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  flexShrink: {
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  telemetry: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: t.spacing.lg,
    rowGap: t.spacing.xs,
  },
  tasks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  offline: {
    gap: t.spacing.sm,
  },
  redirect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.sm,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.tones.info.bg,
  },
  sims: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
}));
