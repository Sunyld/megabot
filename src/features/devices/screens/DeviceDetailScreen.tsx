import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListItem } from '@/components/ui/ListItem';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { Timeline, type TimelineItem } from '@/components/ui/Timeline';
import { toast } from '@/components/ui/Toast';
import { deviceStatusMeta } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useCreatePairingCode, useDevice, useNow, useSetDevicePaused, useSims, useTestUssd } from '@/hooks';
import { errorMessage } from '@/services';
import { createStyles, type IconName, useTheme } from '@/theme';
import type { Device, DeviceEvent, DevicePairing } from '@/types';
import { formatDuration, formatRelative, formatRelativeLong, formatTime } from '@/utils/format';

import { AddSimSheet, PairingCodeSheet } from '../components/DeviceSheets';
import { SimCard, usageTone } from '../components/SimCard';
import { SimSheet } from '../components/SimSheet';
import { batteryIcon, networkIcon } from '../components/Telemetry';

const historyIcon: Record<DeviceEvent['type'], IconName> = {
  online: 'power',
  offline: 'cloudOff',
  task: 'bolt',
  sim: 'sim',
  battery: 'batteryMid',
  sync: 'sync',
  error: 'warning',
};

function historyItems(device: Device): TimelineItem[] {
  return device.history.map((event) => ({
    key: event.id,
    title: event.title,
    description: event.description,
    time: `${formatRelative(event.at)} · ${formatTime(event.at)}`,
    state: event.type === 'offline' || event.type === 'error' ? 'warning' : 'done',
    icon: historyIcon[event.type],
  }));
}

const subtitleOf = (device: Device) =>
  [device.model, device.androidVersion].filter(Boolean).join(' · ') || (device.status === 'unregistered' ? 'Por emparelhar' : undefined);

export function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const now = useNow();
  const { user } = useCurrentSession();
  const device = useDevice(id);
  const sims = useSims(id);
  const setPaused = useSetDevicePaused();
  const testUssd = useTestUssd();
  const createPairingCode = useCreatePairingCode();
  const [simId, setSimId] = useState<string | null>(null);
  const [addingSim, setAddingSim] = useState(false);
  const [pairing, setPairing] = useState<DevicePairing | null>(null);
  const [ussdResult, setUssdResult] = useState<{ ok: boolean; response: string; durationMs: number } | null>(null);

  // UI only: the database restricts device management to owner / admin.
  const canManage = user.role === 'owner' || user.role === 'admin';
  const d = device.data;
  const selectedSim = sims.data?.find((s) => s.id === simId) ?? null;

  const runTest = async () => {
    try {
      setUssdResult(await testUssd.mutateAsync(id));
    } catch (e) {
      toast.error('Teste indisponível', errorMessage(e));
    }
  };

  const togglePause = async () => {
    if (!d) return;
    const pausing = d.status !== 'paused';
    try {
      await setPaused.mutateAsync({ id, paused: pausing });
      toast.success(pausing ? 'Dispositivo desativado' : 'Dispositivo reativado', pausing ? 'Não recebe novas tarefas.' : 'Volta à rotação.');
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
    }
  };

  const newPairingCode = async () => {
    try {
      setPairing(await createPairingCode.mutateAsync(id));
    } catch (e) {
      toast.error('Não foi possível gerar o código', errorMessage(e));
    }
  };

  const footer = (() => {
    if (!d || !canManage) return null;
    if (d.status === 'unregistered') {
      return (
        <View style={styles.footer}>
          <Button label="Gerar código de emparelhamento" icon="link" style={styles.flex} loading={createPairingCode.isPending} onPress={newPairingCode} />
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        <Button
          label={d.status === 'paused' ? 'Reativar' : 'Desativar'}
          icon={d.status === 'paused' ? 'play' : 'pause'}
          variant="secondary"
          style={styles.flex}
          loading={setPaused.isPending}
          onPress={togglePause}
        />
        {d.status !== 'offline' && d.status !== 'paused' ? (
          <Button label="Testar USSD" icon="ussd" style={styles.flex} loading={testUssd.isPending} onPress={runTest} />
        ) : null}
      </View>
    );
  })();

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={device.isRefreshing}
      onRefresh={() => {
        void device.refetch();
        void sims.refetch();
      }}
      header={<StackHeader title={d?.name ?? 'Dispositivo'} subtitle={d ? subtitleOf(d) : undefined} />}
      footer={footer}>
      <QueryView
        query={device}
        loading={
          <View style={styles.stack}>
            <Skeleton height={120} radius={16} />
            <Skeleton height={200} radius={16} />
          </View>
        }>
        {(dev) => {
          const offline = dev.status === 'offline';
          const usage = dev.usage.capacityPerDay ? dev.usage.tasksToday / dev.usage.capacityPerDay : 0;
          const deviceSims = sims.data ?? [];
          return (
            <Animated.View entering={FadeInDown.duration(260)} style={styles.stack}>
              {dev.status === 'unregistered' ? (
                <View style={[styles.banner, { backgroundColor: colors.tones.info.bg }]}>
                  <Icon name="link" size={28} color={colors.tones.info.fg} />
                  <View style={styles.flex}>
                    <Text variant="title3">À espera de emparelhamento</Text>
                    <Text variant="callout" color="secondary">
                      No telemóvel Android: Mais › Modo worker › Emparelhar, e introduza o código. Cada código vale 15 minutos e só uma vez.
                    </Text>
                  </View>
                </View>
              ) : offline ? (
                <View style={[styles.banner, { backgroundColor: colors.surfaceInverse }]} accessibilityRole="alert">
                  <Icon name="cloudOff" size={28} color={colors.textInverse} />
                  <View style={styles.flex}>
                    <Text variant="title3" color="inverse">
                      Dispositivo offline
                    </Text>
                    <Text variant="callout" color="inverse" style={styles.dim}>
                      {dev.lastSeenAt ? `Última ligação ${formatRelativeLong(dev.lastSeenAt, now)}.` : 'Ainda sem ligação.'}
                    </Text>
                    <Text variant="callout" color="inverse" style={styles.dim}>
                      Não recebe tarefas até voltar a ligar-se.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.statusRow}>
                  <StatusBadge meta={deviceStatusMeta[dev.status]} />
                  {dev.role === 'primary' && <Badge label="Principal" tone="brand" />}
                  <Text variant="caption" color="muted" style={styles.flex} align="right">
                    {dev.syncedAt ? `Sincronizado ${formatRelative(dev.syncedAt, now)}` : ''}
                  </Text>
                </View>
              )}

              {dev.status !== 'unregistered' && (
                <View style={styles.grid}>
                  <StatCard
                    label="Bateria"
                    value={dev.battery ? `${dev.battery.level}%` : '—'}
                    icon={batteryIcon(dev.battery)}
                    tone={!dev.battery ? 'neutral' : dev.battery.level < 25 && !dev.battery.charging ? 'warning' : 'success'}
                    caption={!dev.battery ? 'Sem dados' : dev.battery.charging ? 'A carregar' : 'Na bateria'}
                  />
                  <StatCard
                    label="Rede"
                    value={!dev.network || dev.network.type === 'none' ? '—' : dev.network.type}
                    icon={networkIcon(dev.network)}
                    tone={!dev.network || dev.network.type === 'none' ? 'neutral' : 'info'}
                    caption={!dev.network ? 'Sem dados' : dev.network.type === 'none' ? 'Sem ligação' : `Sinal ${dev.network.signal}/4`}
                  />
                </View>
              )}

              <Card style={styles.usage}>
                <View style={styles.usageHead}>
                  <Text variant="bodyStrong">Uso de hoje</Text>
                  <Text variant="bodyStrong" tabular>
                    {dev.usage.capacityPerDay !== null ? `${dev.usage.tasksToday} / ${dev.usage.capacityPerDay}` : `${dev.usage.tasksToday} tentativas`}
                  </Text>
                </View>
                {dev.usage.capacityPerDay !== null && <ProgressBar value={usage} tone={usageTone(usage)} height={8} />}
                <View style={styles.usageStats}>
                  <Text variant="caption" color="success">{`✓ ${dev.usage.successToday} com sucesso`}</Text>
                  <Text variant="caption" color={dev.usage.failedToday ? 'danger' : 'muted'}>{`${dev.usage.failedToday} sem sucesso`}</Text>
                  <Text variant="caption" color="muted">{dev.appVersion ? `App ${dev.appVersion}` : 'App —'}</Text>
                </View>
              </Card>

              <Section
                title="SIMs"
                right={
                  canManage && dev.status !== 'paused' ? (
                    <Button label="Registar SIM" icon="add" variant="secondary" size="sm" onPress={() => setAddingSim(true)} />
                  ) : undefined
                }>
                <View style={styles.list}>
                  {deviceSims.map((sim) => (
                    <SimCard key={sim.id} sim={sim} onPress={() => setSimId(sim.id)} />
                  ))}
                  {!sims.data && <Skeleton height={110} radius={16} />}
                  {sims.data && deviceSims.length === 0 && (
                    <Card>
                      <EmptyState
                        compact
                        icon="sim"
                        title="Sem SIMs registados"
                        description="Registe os SIMs deste telemóvel e a operadora de cada um. Sem SIM ativo da rede certa, o dispatcher não lhe entrega tarefas."
                      />
                    </Card>
                  )}
                </View>
              </Section>

              <Section title="Capacidades" subtitle="Comunicadas pelo próprio telemóvel">
                <ListGroup>
                  <ListItem icon="ussd" iconTone={dev.capabilities.ussd ? 'success' : 'neutral'} title="Executar USSD" value={dev.capabilities.ussd ? 'Sim' : 'Não'} divider />
                  <ListItem
                    icon="ussd"
                    iconTone={dev.capabilities.ussdInteractive ? 'success' : 'neutral'}
                    title="Menus USSD interativos"
                    value={dev.capabilities.ussdInteractive ? 'Sim' : 'Não'}
                    divider
                  />
                  <ListItem icon="sms" iconTone={dev.capabilities.sms ? 'success' : 'neutral'} title="Ler SMS de pagamento" value={dev.capabilities.sms ? 'Sim' : 'Não'} divider />
                  <ListItem icon="sim" iconTone={dev.capabilities.dualSim ? 'success' : 'neutral'} title="Vários SIMs" value={dev.capabilities.dualSim ? 'Sim' : 'Não'} />
                </ListGroup>
                {dev.status !== 'unregistered' && !(dev.capabilities.ussd && dev.capabilities.ussdInteractive) && (
                  <Text variant="caption" color="warning">
                    Sem USSD interativo este telemóvel não recebe ativações. É preciso a versão da app com o módulo USSD nativo (build de desenvolvimento ou produção, não o Expo Go).
                  </Text>
                )}
              </Section>

              {canManage && dev.status !== 'unregistered' && (
                <Section title="Emparelhamento" subtitle="Telemóvel novo ou app reinstalada">
                  <ListGroup>
                    <ListItem
                      icon="link"
                      iconTone="info"
                      title="Gerar novo código"
                      subtitle="Ao emparelhar de novo, o telemóvel anterior deixa de funcionar."
                      chevron
                      onPress={newPairingCode}
                    />
                  </ListGroup>
                </Section>
              )}

              <Section title="Erros" subtitle={dev.errors.length ? `${dev.errors.length} nas últimas 24 h` : undefined}>
                {dev.errors.length ? (
                  <ListGroup>
                    {dev.errors.map((error, index) => (
                      <ListItem
                        key={error.id}
                        icon={error.severity === 'danger' ? 'error' : 'warning'}
                        iconTone={error.severity}
                        title={error.message}
                        subtitle={`${error.code} · ${formatRelative(error.at, now)}`}
                        divider={index < dev.errors.length - 1}
                      />
                    ))}
                  </ListGroup>
                ) : (
                  <Card>
                    <EmptyState compact icon="shield" tone="success" title="Sem erros" description="Nenhuma falha registada nas últimas 24 horas." />
                  </Card>
                )}
              </Section>

              <Section title="Histórico">
                <Card>
                  <Timeline items={historyItems(dev)} />
                </Card>
              </Section>
            </Animated.View>
          );
        }}
      </QueryView>

      <SimSheet sim={selectedSim} onClose={() => setSimId(null)} />
      {d && (
        <AddSimSheet
          deviceId={d.id}
          usedSlots={(sims.data ?? []).map((sim) => sim.slot - 1)}
          visible={addingSim}
          onClose={() => setAddingSim(false)}
        />
      )}
      <PairingCodeSheet pairing={pairing} deviceName={d?.name} onClose={() => setPairing(null)} />

      <BottomSheet
        visible={ussdResult !== null}
        onClose={() => setUssdResult(null)}
        title="Teste de USSD"
        subtitle="*100# · consulta de saldo (sem custos)"
        footer={<Button label="Fechar" variant="secondary" fullWidth onPress={() => setUssdResult(null)} />}>
        {ussdResult && (
          <>
            <View style={[styles.banner, { backgroundColor: colors.tones[ussdResult.ok ? 'success' : 'danger'].bg }]}>
              <Icon name={ussdResult.ok ? 'checkCircle' : 'error'} size={24} color={colors.tones[ussdResult.ok ? 'success' : 'danger'].fg} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">{ussdResult.ok ? 'USSD a funcionar' : 'Falha no USSD'}</Text>
                {ussdResult.ok && (
                  <Text variant="caption" color="secondary">{`Resposta em ${formatDuration(ussdResult.durationMs / 1000)}`}</Text>
                )}
              </View>
            </View>
            <View style={styles.raw}>
              <Text variant="monoSmall" color="secondary">
                {ussdResult.response}
              </Text>
            </View>
          </>
        )}
      </BottomSheet>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  stack: {
    gap: t.spacing.xxl,
  },
  flex: {
    flex: 1,
  },
  dim: {
    opacity: 0.8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  usage: {
    gap: t.spacing.md,
  },
  usageHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  usageStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: t.spacing.lg,
    rowGap: t.spacing.xs,
  },
  list: {
    gap: t.spacing.md,
  },
  raw: {
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  footer: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
}));
