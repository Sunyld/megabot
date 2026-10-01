import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ScreenHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { QueryView } from '@/components/ui/QueryView';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useDevices, useDevicesSummary, useNow, useSims } from '@/hooks';
import { createStyles, useTheme } from '@/theme';

import { DeviceCard } from '../components/DeviceCard';
import { usageTone } from '../components/SimCard';

function PairingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const steps = [
    'Instale a app MegaBot Worker no telemóvel Android.',
    'Abra a app e toque em “Emparelhar com vendedor”.',
    'Leia o código QR ou introduza o código abaixo.',
  ];
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Adicionar dispositivo"
      subtitle="Cada Android ligado aumenta a capacidade e a resiliência."
      footer={<Button label="Concluído" variant="secondary" fullWidth onPress={onClose} />}>
      <View style={styles.qr}>
        <Icon name="qr" size={120} color={colors.text} />
        <Text variant="title2" style={styles.code}>
          MB-4821-KX
        </Text>
        <Text variant="caption" color="muted">
          Código válido durante 10 minutos
        </Text>
      </View>
      {steps.map((step, index) => (
        <View key={step} style={styles.step}>
          <View style={styles.stepNumber}>
            <Text variant="captionStrong" color="brand">
              {index + 1}
            </Text>
          </View>
          <Text variant="callout" style={styles.flex}>
            {step}
          </Text>
        </View>
      ))}
      <View style={styles.note}>
        <Icon name="info" size={16} color={colors.tones.info.fg} />
        <Text variant="caption" color="info" style={styles.flex}>
          O emparelhamento real chega com o Android Device Worker (SMS, SIM e USSD).
        </Text>
      </View>
    </BottomSheet>
  );
}

export function DevicesScreen() {
  const styles = useStyles();
  const now = useNow();
  const devices = useDevices();
  const summary = useDevicesSummary();
  const sims = useSims();
  const [pairing, setPairing] = useState(false);

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
          right={<IconButton icon="add" variant="surface" accessibilityLabel="Adicionar dispositivo" onPress={() => setPairing(true)} />}
        />
      }>
      {s && (
        <Animated.View entering={FadeInDown.duration(260)}>
          <Card style={styles.capacity}>
            <View style={styles.capacityHead}>
              <View style={styles.flex}>
                <Text variant="callout" color="secondary">
                  Capacidade de ativação hoje
                </Text>
                <Text variant="stat">{`${s.capacityUsed} / ${s.capacityTotal}`}</Text>
              </View>
              <Button label="Gerir SIMs" icon="sim" variant="secondary" size="sm" onPress={() => router.push('/sims')} />
            </View>
            <ProgressBar value={capacity} tone={usageTone(capacity)} height={8} />
            <Text variant="caption" color="muted">
              {`${s.simsAvailable} de ${s.simsTotal} SIMs disponíveis para ativações · failover ativo`}
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
            action={{ label: 'Adicionar dispositivo', icon: 'add', onPress: () => setPairing(true) }}
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

      <PairingSheet visible={pairing} onClose={() => setPairing(false)} />
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
  qr: {
    alignItems: 'center',
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xl,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.borderStrong,
  },
  code: {
    letterSpacing: 2,
    marginTop: t.spacing.sm,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tones.brand.bg,
  },
  note: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.info.bg,
  },
}));
