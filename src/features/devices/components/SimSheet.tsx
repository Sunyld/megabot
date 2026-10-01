import { View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { KeyValue } from '@/components/ui/KeyValue';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { operatorLabels, paymentMethodMeta, simStatusMeta } from '@/constants/labels';
import { useSetSimPaused } from '@/hooks';
import { errorMessage } from '@/services';
import { createStyles } from '@/theme';
import type { Sim } from '@/types';
import { formatData, formatMoney, formatPhone, formatRelative } from '@/utils/format';

import { usageTone } from './SimCard';

export function SimSheet({ sim, onClose }: { sim: Sim | null; onClose: () => void }) {
  const styles = useStyles();
  const setPaused = useSetSimPaused();

  const toggle = async () => {
    if (!sim) return;
    const pausing = sim.status !== 'paused';
    try {
      await setPaused.mutateAsync({ id: sim.id, paused: pausing });
      toast.success(pausing ? 'SIM pausado' : 'SIM retomado', pausing ? 'Fica fora da rotação de ativações.' : 'Volta a receber tarefas.');
      onClose();
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
    }
  };

  const ratio = sim && sim.dailyLimit ? sim.activationsToday / sim.dailyLimit : 0;

  return (
    <BottomSheet
      visible={sim !== null}
      onClose={onClose}
      title={sim ? `SIM ${sim.slot} · ${operatorLabels[sim.operator]}` : ''}
      subtitle={sim ? sim.deviceName : undefined}
      footer={
        sim && sim.status !== 'offline' ? (
          <Button
            label={sim.status === 'paused' ? 'Retomar ativações' : 'Pausar ativações'}
            icon={sim.status === 'paused' ? 'play' : 'pause'}
            variant={sim.status === 'paused' ? 'primary' : 'secondary'}
            fullWidth
            loading={setPaused.isPending}
            onPress={toggle}
          />
        ) : null
      }>
      {sim && (
        <>
          <View style={styles.row}>
            <StatusBadge meta={simStatusMeta[sim.status]} />
            <Text variant="callout" color="secondary">
              {sim.lastUsedAt ? `Usado ${formatRelative(sim.lastUsedAt)}` : 'Nunca usado'}
            </Text>
          </View>
          <View style={styles.usage}>
            <View style={styles.row}>
              <Text variant="bodyMedium">Ativações hoje</Text>
              <Text variant="bodyStrong" tabular>{`${sim.activationsToday} de ${sim.dailyLimit}`}</Text>
            </View>
            <ProgressBar value={ratio} tone={usageTone(ratio)} height={8} />
            {sim.status === 'limit_reached' && (
              <Text variant="caption" color="warning">
                Limite diário atingido. O dispatcher usa outros SIMs até amanhã.
              </Text>
            )}
          </View>
          <View>
            <KeyValue label="Número" value={formatPhone(sim.msisdn)} />
            <KeyValue label="Dados" value={`${formatData(sim.dataUsedMb)} de ${formatData(sim.dataTotalMb)}`} />
            <KeyValue label="Saldo" value={sim.balance !== null ? formatMoney(sim.balance) : 'Indisponível'} />
            <KeyValue
              label="Pagamentos"
              value={sim.paymentWallet ? `Lê SMS ${paymentMethodMeta[sim.paymentWallet].label}` : 'Não monitoriza'}
              last
            />
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
  },
  usage: {
    gap: t.spacing.sm,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceMuted,
  },
}));
