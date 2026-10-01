import { View } from 'react-native';

import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Text } from '@/components/ui/Text';
import { operatorLabels, paymentMethodMeta, simStatusMeta } from '@/constants/labels';
import { createStyles, type Tone, useTheme } from '@/theme';
import type { Sim } from '@/types';
import { formatData, formatPhone } from '@/utils/format';

export const usageTone = (ratio: number): Tone => (ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success');

/** Compact chip for device cards: "SIM 1 ✓". */
export function SimChip({ sim }: { sim: Sim }) {
  const meta = simStatusMeta[sim.status];
  const label = sim.status === 'paused' && sim.paymentWallet ? 'só pagamentos' : meta.label.toLowerCase();
  return <Badge label={`SIM ${sim.slot} · ${label}`} tone={meta.tone} icon={meta.icon} size="sm" />;
}

export function SimCard({ sim, onPress, showDevice }: { sim: Sim; onPress?: () => void; showDevice?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const activationRatio = sim.dailyLimit ? sim.activationsToday / sim.dailyLimit : 0;
  const dataRatio = sim.dataTotalMb ? sim.dataUsedMb / sim.dataTotalMb : 0;
  const paymentsOnly = sim.status === 'paused' && sim.paymentWallet;
  const muted = sim.status === 'offline';

  return (
    <Card padding={14} onPress={onPress} style={[styles.card, muted && styles.muted]} accessibilityLabel={`SIM ${sim.slot}, ${simStatusMeta[sim.status].label}`}>
      <View style={styles.row}>
        <View style={styles.title}>
          <View style={styles.simIcon}>
            <Icon name="sim" size={18} color={colors.text} />
          </View>
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {`SIM ${sim.slot} · ${operatorLabels[sim.operator]}`}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={1} tabular>
              {showDevice ? `${sim.deviceName} · ${formatPhone(sim.msisdn)}` : formatPhone(sim.msisdn)}
            </Text>
          </View>
        </View>
        <StatusBadge
          meta={paymentsOnly ? { label: 'Só pagamentos', tone: 'neutral', icon: 'sms' } : simStatusMeta[sim.status]}
          size="sm"
        />
      </View>

      {!paymentsOnly && (
        <View style={styles.meters}>
          <View style={styles.meter}>
            <View style={styles.meterLabel}>
              <Text variant="caption" color="secondary">
                Ativações hoje
              </Text>
              <Text variant="captionStrong" tabular>
                {`${sim.activationsToday}/${sim.dailyLimit}`}
              </Text>
            </View>
            <ProgressBar value={activationRatio} tone={usageTone(activationRatio)} />
          </View>
          <View style={styles.meter}>
            <View style={styles.meterLabel}>
              <Text variant="caption" color="secondary">
                Dados
              </Text>
              <Text variant="captionStrong" tabular>
                {`${formatData(sim.dataUsedMb)} / ${formatData(sim.dataTotalMb)}`}
              </Text>
            </View>
            <ProgressBar value={dataRatio} tone={usageTone(dataRatio)} />
          </View>
        </View>
      )}

      {sim.paymentWallet && (
        <View style={styles.wallet}>
          <Icon name="sms" size={14} color={colors.textMuted} />
          <Text variant="caption" color="muted">
            {`Monitoriza pagamentos ${paymentMethodMeta[sim.paymentWallet].label}`}
          </Text>
        </View>
      )}
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    gap: t.spacing.md,
  },
  muted: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
  },
  title: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  simIcon: {
    width: 36,
    height: 36,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceMuted,
  },
  flex: {
    flex: 1,
  },
  meters: {
    flexDirection: 'row',
    gap: t.spacing.lg,
  },
  meter: {
    flex: 1,
    gap: 6,
  },
  meterLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: t.spacing.xs,
  },
  wallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
}));
