import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ScreenHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { QueryView } from '@/components/ui/QueryView';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useCurrentSession } from '@/features/auth/session';
import { useDevices, useDevicesSummary, useNow, useSims } from '@/hooks';
import { createStyles } from '@/theme';

import { DeviceCard } from '../components/DeviceCard';
import { AddDeviceSheet } from '../components/DeviceSheets';
import { usageTone } from '../components/SimCard';

export function DevicesScreen() {
  const styles = useStyles();
  const now = useNow();
  const devices = useDevices();
  const summary = useDevicesSummary();
  const sims = useSims();
  const { user } = useCurrentSession();
  const [pairing, setPairing] = useState(false);
  // UI only: the database restricts device management to owner / admin.
  const canManage = user.role === 'owner' || user.role === 'admin';

  const refresh = () => {
    void devices.refetch();
    void summary.refetch();
    void sims.refetch();
  };

  const s = summary.data;
  const capacity = s && s.capacityTotal ? s.capacityUsed / s.capacityTotal : 0;

  return (
    <Screen
      refreshing={devices.isRefreshing}
      onRefresh={refresh}
      header={
        <ScreenHeader
          title="Dispositivos"
          subtitle={s ? `${s.online} / ${s.total} online` : 'A carregar…'}
          right={
            canManage ? (
              <IconButton icon="add" variant="surface" accessibilityLabel="Adicionar dispositivo" onPress={() => setPairing(true)} />
            ) : undefined
          }
        />
      }>
      {s && (
        <Animated.View entering={FadeInDown.duration(260)}>
          <Card style={styles.capacity}>
            <View style={styles.capacityHead}>
              <View style={styles.flex}>
                <Text variant="callout" color="secondary">
                  {s.capacityTotal !== null ? 'Capacidade de ativação hoje' : 'Ativações confirmadas hoje'}
                </Text>
                <Text variant="stat">{s.capacityTotal !== null ? `${s.capacityUsed} / ${s.capacityTotal}` : `${s.capacityUsed}`}</Text>
              </View>
              <Button label="Gerir SIMs" icon="sim" variant="secondary" size="sm" onPress={() => router.push('/sims')} />
            </View>
            {s.capacityTotal !== null && <ProgressBar value={capacity} tone={usageTone(capacity)} height={8} />}
            <Text variant="caption" color="muted">
              {`${s.simsAvailable} de ${s.simsTotal} SIMs disponíveis para ativações`}
            </Text>
          </Card>
        </Animated.View>
      )}

      <QueryView
        query={devices}
        loading={<SkeletonList count={3} lines={4} />}
        isEmpty={(list) => list.length === 0}
        empty={
          <EmptyState
            icon="devices"
            title="Nenhum dispositivo"
            description="Ligue um telemóvel Android para ler pagamentos e ativar pacotes automaticamente."
            action={canManage ? { label: 'Adicionar dispositivo', icon: 'add', onPress: () => setPairing(true) } : undefined}
          />
        }>
        {(list) => (
          <View style={styles.list}>
            {list.map((device, index) => (
              <Animated.View key={device.id} entering={FadeInDown.delay(index * 60).duration(280)}>
                <DeviceCard device={device} sims={(sims.data ?? []).filter((sim) => sim.deviceId === device.id)} now={now} />
              </Animated.View>
            ))}
          </View>
        )}
      </QueryView>

      <AddDeviceSheet visible={pairing} onClose={() => setPairing(false)} />
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  capacity: {
    gap: t.spacing.md,
  },
  capacityHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  list: {
    gap: t.spacing.md,
  },
}));
