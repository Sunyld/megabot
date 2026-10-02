import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { EmptyState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { taskStatusMeta } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useAutomationSettings, useAutomationStats, useDispatchActivationTasks, useNow, useTasks, useUpdateAutomationSettings } from '@/hooks';
import { errorMessage } from '@/services';
import { createStyles, type IconName, useTheme } from '@/theme';
import type { AutomationSettings, TaskStatus } from '@/types';
import { formatDuration, formatPercent, formatPhone, formatRelative } from '@/utils/format';

import { LiveExecution } from '../components/LiveExecution';

const toggles: { key: Exclude<keyof AutomationSettings, 'enabled'>; title: string; description: string; icon: IconName }[] = [
  { key: 'autoOrders', title: 'Pedidos automáticos', description: 'Responder no WhatsApp e criar pedidos', icon: 'whatsapp' },
  { key: 'autoConfirm', title: 'Confirmação automática', description: 'Confirmar pagamentos quando as regras coincidem', icon: 'shield' },
  { key: 'autoUssd', title: 'USSD automático', description: 'Ativar pacotes sem intervenção', icon: 'ussd' },
  { key: 'failover', title: 'Failover', description: 'Tentar outro SIM/dispositivo se um falhar', icon: 'failover' },
  { key: 'smsMonitoring', title: 'Monitorização de SMS', description: 'Ler as mensagens das carteiras móveis', icon: 'sms' },
];

const lifecycle: TaskStatus[] = ['QUEUED', 'ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN'];

const principles = [
  'A IA interpreta mensagens — nunca confirma pagamentos.',
  'Um pagamento só é confirmado se o ID da transação coincidir com a mensagem real da carteira.',
  'Cada ID de transação só pode ser usado uma vez.',
  'Um USSD sem resposta (UNKNOWN) é verificado antes de qualquer repetição.',
];

export function AutomationScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const now = useNow();
  const settings = useAutomationSettings();
  const stats = useAutomationStats();
  const tasks = useTasks();
  const update = useUpdateAutomationSettings();
  const { user } = useCurrentSession();
  const dispatch = useDispatchActivationTasks();
  // UI only: the database restricts the manual dispatcher run to owner / admin.
  const canDispatch = user.role === 'owner' || user.role === 'admin';

  const runDispatch = async () => {
    try {
      const assigned = await dispatch.mutateAsync();
      toast.success(
        assigned ? `${assigned} tarefa(s) atribuída(s)` : 'Nada para distribuir',
        assigned ? 'Os telemóveis recebem-nas no próximo pedido de trabalho.' : 'Sem tarefas na fila ou sem telemóvel online com SIM compatível.'
      );
    } catch (e) {
      toast.error('Não foi possível distribuir', errorMessage(e));
    }
  };

  const change = async (patch: Partial<AutomationSettings>) => {
    try {
      await update.mutateAsync(patch);
      if (patch.enabled !== undefined) {
        toast.show({
          title: patch.enabled ? 'Automação retomada' : 'Automação pausada',
          description: patch.enabled ? 'O MegaBot volta a vender sozinho.' : 'Novos pedidos ficam à espera da sua ação.',
          tone: patch.enabled ? 'success' : 'warning',
          icon: patch.enabled ? 'play' : 'pause',
        });
      }
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
      void settings.refetch();
    }
  };

  const s = settings.data;

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={stats.isRefreshing}
      onRefresh={() => {
        void settings.refetch();
        void stats.refetch();
        void tasks.refetch();
      }}
      header={<StackHeader title="Automação" subtitle="O motor que trabalha por si" />}>
      <QueryView query={settings} loading={<Skeleton height={140} radius={16} />}>
        {(cfg) => (
          <Card variant={cfg.enabled ? 'brand' : 'inverse'} style={styles.master}>
            <View style={styles.masterRow}>
              <View style={styles.flex}>
                <View style={styles.row}>
                  <StatusDot tone={cfg.enabled ? 'success' : 'warning'} pulse={cfg.enabled} />
                  <Text variant="captionStrong" color={cfg.enabled ? 'onBrand' : 'inverse'}>
                    {cfg.enabled ? 'ATIVA' : 'PAUSADA'}
                  </Text>
                </View>
                <Text variant="title2" color={cfg.enabled ? 'onBrand' : 'inverse'}>
                  {cfg.enabled ? 'Automação ligada' : 'Automação desligada'}
                </Text>
              </View>
              <Switch value={cfg.enabled} onValueChange={(enabled) => void change({ enabled })} accessibilityLabel="Automação" />
            </View>
            <Text variant="callout" colorValue={cfg.enabled ? 'rgba(255,255,255,0.85)' : colors.textMuted}>
              {cfg.enabled
                ? 'Pedidos, confirmações e ativações acontecem sem intervenção humana.'
                : 'Nada é executado automaticamente até voltar a ligar.'}
            </Text>
          </Card>
        )}
      </QueryView>

      {stats.data && (
        <Animated.View entering={FadeInDown.duration(240)} style={styles.grid}>
          <View style={styles.gridRow}>
            <StatCard label="Tarefas hoje" value={`${stats.data.tasksToday}`} icon="bolt" tone="info" />
            <StatCard label="Taxa de sucesso" value={formatPercent(stats.data.successRate)} icon="checkCircle" tone="success" />
          </View>
          <View style={styles.gridRow}>
            <StatCard label="Tempo médio" value={formatDuration(stats.data.avgActivationSeconds)} icon="speed" tone="neutral" />
            <StatCard
              label="Failovers"
              value={`${stats.data.failoversToday}`}
              icon="failover"
              tone="warning"
              caption={stats.data.unknownToday ? `${stats.data.unknownToday} a verificar` : 'Sem pendentes'}
            />
          </View>
        </Animated.View>
      )}

      <Section title="Regras">
        <ListGroup>
          {toggles.map((toggle, index) => (
            <ListItem
              key={toggle.key}
              icon={toggle.icon}
              iconTone={s?.[toggle.key] && s.enabled ? 'success' : 'neutral'}
              title={toggle.title}
              subtitle={toggle.description}
              divider={index < toggles.length - 1}
              trailing={
                <Switch
                  value={Boolean(s?.[toggle.key])}
                  disabled={!s?.enabled}
                  onValueChange={(value) => void change({ [toggle.key]: value })}
                  accessibilityLabel={toggle.title}
                />
              }
            />
          ))}
        </ListGroup>
      </Section>

      <Section title="Execução em tempo real" subtitle="Como o dispatcher escolhe o dispositivo e o SIM">
        <LiveExecution />
      </Section>

      <Section title="Ciclo de vida de uma tarefa">
        <Card padding={0}>
          {lifecycle.map((status, index) => {
            const meta = taskStatusMeta[status];
            return (
              <View key={status} style={[styles.lifecycle, index < lifecycle.length - 1 && styles.divider]}>
                <Badge label={status} tone={meta.tone} icon={meta.icon} size="sm" style={styles.lifecycleBadge} />
                <Text variant="callout" color={status === 'UNKNOWN' ? 'primary' : 'secondary'} style={styles.flex} weight={status === 'UNKNOWN' ? 600 : undefined}>
                  {meta.description}
                </Text>
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title="Princípios de segurança">
        <Card style={styles.principles}>
          {principles.map((text) => (
            <View key={text} style={styles.principle}>
              <Icon name="shield" size={18} color={colors.tones.success.fg} />
              <Text variant="callout" style={styles.flex}>
                {text}
              </Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section
        title="Tarefas recentes"
        right={
          canDispatch ? (
            <Button label="Distribuir" icon="dispatcher" variant="secondary" size="sm" loading={dispatch.isPending} onPress={() => void runDispatch()} />
          ) : undefined
        }>
        <QueryView
          query={tasks}
          loading={<Skeleton height={240} radius={16} />}
          isEmpty={(list) => list.length === 0}
          empty={
            <Card>
              <EmptyState compact icon="bolt" title="Sem tarefas" description="As ativações executadas aparecem aqui." />
            </Card>
          }>
          {(list) => (
            <ListGroup>
              {list.slice(0, 8).map((task, index, shown) => {
                const failover =
                  task.attempts.some((a) => a.result.startsWith('skipped')) || new Set(task.attempts.map((a) => a.simId)).size > 1;
                return (
                  <ListItem
                    key={task.id}
                    icon="bolt"
                    iconTone={taskStatusMeta[task.status].tone}
                    title={`${task.code} · ${task.productName}`}
                    subtitle={`${task.destination ? formatPhone(task.destination) : '—'} · ${formatRelative(task.createdAt, now)}${failover ? ' · failover' : ''}`}
                    trailing={<StatusBadge meta={taskStatusMeta[task.status]} size="sm" />}
                    divider={index < shown.length - 1}
                    onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
                  />
                );
              })}
            </ListGroup>
          )}
        </QueryView>
      </Section>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  master: {
    gap: t.spacing.md,
  },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  grid: {
    gap: t.spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  lifecycle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  },
  lifecycleBadge: {
    width: 118,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  principles: {
    gap: t.spacing.md,
  },
  principle: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
}));
