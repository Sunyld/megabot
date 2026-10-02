import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { StatusBadge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { Timeline, type TimelineItem } from '@/components/ui/Timeline';
import { toast } from '@/components/ui/Toast';
import { operatorLabels, taskStatusMeta } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useActivationTask, useResolveActivationTask, useRetryActivationTask } from '@/hooks';
import { errorMessage } from '@/services';
import { ACTIVATION_RULES, resultCodeText } from '@/services/activationRules';
import { EVENT_TEXT } from '@/services/supabase/activation';
import { createStyles, useTheme } from '@/theme';
import type { ActivationAttemptRecord, ActivationTaskDetail, ActivationTaskRecord } from '@/types';
import { formatDateTime, formatPhone, formatPrice } from '@/utils/format';
import { describeUssdFlow } from '@/utils/ussd';

type Decision = 'retry' | 'SUCCESS' | 'FAILED';

const SOURCE_TEXT: Record<ActivationAttemptRecord['source'], string> = {
  WORKER: 'Relatado pelo telemóvel',
  SYSTEM: 'Sem resposta (tempo limite)',
  MANUAL: 'Decisão manual',
};

function banner(task: ActivationTaskRecord): { tone: 'success' | 'danger' | 'warning' | 'info'; title: string; body: string } {
  switch (task.status) {
    case 'SUCCESS':
      return { tone: 'success', title: 'Ativação confirmada', body: 'A resposta da operadora corresponde ao texto de sucesso do produto (ou foi confirmada por uma pessoa).' };
    case 'FAILED':
      return {
        tone: 'danger',
        title: 'A ativação falhou',
        body: `${resultCodeText(task.resultCode) ?? 'Falha.'} Pode repetir depois de corrigir a causa.`,
      };
    case 'UNKNOWN':
      return {
        tone: 'warning',
        title: 'Sem confirmação — precisa de verificação',
        body: 'O USSD pode ter sido executado, mas nada prova o resultado. Não é repetido automaticamente: confirme com o cliente ou a operadora antes de decidir.',
      };
    case 'QUEUED':
      return { tone: 'info', title: 'Na fila', body: 'À espera de um telemóvel online com um SIM ativo da mesma rede.' };
    default:
      return { tone: 'info', title: taskStatusMeta[task.status].label, body: taskStatusMeta[task.status].description };
  }
}

function historyItems(detail: ActivationTaskDetail): TimelineItem[] {
  return detail.events.map((e) => ({
    key: e.id,
    title: EVENT_TEXT[e.type] ?? e.type,
    description: e.actorUserId ? 'Por um utilizador' : 'Sistema',
    time: formatDateTime(e.at, true),
    state: e.toStatus === 'FAILED' ? 'failed' : e.toStatus === 'UNKNOWN' ? 'warning' : 'done',
  }));
}

export function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const { user } = useCurrentSession();
  const detail = useActivationTask(id);
  const retry = useRetryActivationTask();
  const resolve = useResolveActivationTask();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');

  // UI only: the database restricts these decisions to owner / admin.
  const canDecide = user.role === 'owner' || user.role === 'admin';
  const task = detail.data?.task;

  const submit = async () => {
    if (!decision) return;
    try {
      if (decision === 'retry') {
        await retry.mutateAsync({ id, note: note.trim() || undefined });
        toast.success('Nova tentativa', 'A tarefa voltou à fila.');
      } else {
        await resolve.mutateAsync({ id, outcome: decision, note });
        toast.success(decision === 'SUCCESS' ? 'Ativação confirmada' : 'Marcada como falhada', 'A decisão ficou registada na auditoria.');
      }
      setDecision(null);
      setNote('');
    } catch (e) {
      toast.error('Não foi possível registar a decisão', errorMessage(e));
    }
  };

  const footer =
    task && canDecide && (task.status === 'FAILED' || task.status === 'UNKNOWN') ? (
      <View style={styles.footer}>
        {task.status === 'FAILED' ? (
          <Button label="Repetir ativação" icon="sync" style={styles.flex} onPress={() => setDecision('retry')} />
        ) : (
          <>
            <Button label="Falhou" icon="cancel" variant="danger" style={styles.flex} onPress={() => setDecision('FAILED')} />
            <Button label="Foi ativado" icon="check" variant="success" style={styles.flex} onPress={() => setDecision('SUCCESS')} />
          </>
        )}
      </View>
    ) : null;

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={detail.isRefreshing}
      onRefresh={() => void detail.refetch()}
      header={<StackHeader title="Tarefa de ativação" subtitle={detail.data?.order?.code} />}
      footer={footer}>
      <QueryView
        query={detail}
        loading={
          <View style={styles.stack}>
            <Skeleton height={140} radius={16} />
            <Skeleton height={220} radius={16} />
          </View>
        }>
        {(d) => {
          const b = banner(d.task);
          return (
            <Animated.View entering={FadeInDown.duration(260)} style={styles.stack}>
              <Card style={styles.hero}>
                <View style={styles.heroTop}>
                  <Text variant="title3" style={styles.flex} numberOfLines={1}>
                    {d.order?.productName ?? 'Produto'}
                  </Text>
                  <StatusBadge meta={taskStatusMeta[d.task.status]} />
                </View>
                <Text variant="mono" color="secondary">
                  {d.order ? formatPhone(d.order.destination) : '—'}
                </Text>
                <Text variant="caption" color="muted">
                  {`${operatorLabels[d.task.operator]} · tentativa ${d.task.attemptCount} de ${d.task.maxAttempts}`}
                </Text>
              </Card>

              <View style={[styles.banner, { backgroundColor: colors.tones[b.tone].bg }]}>
                <Icon
                  name={b.tone === 'success' ? 'checkCircle' : b.tone === 'danger' ? 'error' : b.tone === 'warning' ? 'unknown' : 'queue'}
                  size={22}
                  color={colors.tones[b.tone].fg}
                />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" colorValue={colors.tones[b.tone].fg}>
                    {b.title}
                  </Text>
                  <Text variant="callout" color="secondary">
                    {b.body}
                  </Text>
                </View>
              </View>

              {d.order && (
                <ListGroup>
                  <ListItem
                    icon="orders"
                    iconTone="info"
                    title={`Pedido ${d.order.code}`}
                    subtitle={formatPrice(d.order.price, d.order.currency)}
                    chevron
                    onPress={() => router.push({ pathname: '/orders/[id]', params: { id: d.task.orderId } })}
                  />
                </ListGroup>
              )}

              <Section title="Execução">
                <Card>
                  <KeyValue label="Dispositivo" value={d.device?.name ?? (d.task.deviceId ? 'Dispositivo' : 'Ainda não atribuído')} />
                  <KeyValue label="SIM" value={d.sim ? `Slot ${d.sim.slotIndex + 1} · ${operatorLabels[d.sim.operator]}` : '—'} />
                  <KeyValue label="Fluxo USSD" value={d.task.ussdFlow ? `Versão ${d.task.flowVersion}` : 'Sem fluxo (produto não configurado)'} />
                  {d.task.ussdFlow && (
                    <KeyValue
                      label="Sequência"
                      value={describeUssdFlow(d.task.ussdFlow, d.order ? { destination_number: d.order.destination.replace(/^\+258/, '') } : {})}
                      mono
                    />
                  )}
                  <KeyValue label="Criada" value={formatDateTime(d.task.createdAt, true)} />
                  <KeyValue label="Atribuída" value={d.task.assignedAt ? formatDateTime(d.task.assignedAt, true) : '—'} />
                  <KeyValue label="Iniciada" value={d.task.startedAt ? formatDateTime(d.task.startedAt, true) : '—'} />
                  <KeyValue label="Submetida" value={d.task.submittedAt ? formatDateTime(d.task.submittedAt, true) : '—'} />
                  <KeyValue label="Resultado em" value={d.task.completedAt ? formatDateTime(d.task.completedAt, true) : '—'} last />
                </Card>
              </Section>

              {(d.task.resultCode || d.task.resultMessage) && (
                <Section title="Resultado">
                  <Card style={styles.result}>
                    <KeyValue label="Código" value={d.task.resultCode ?? '—'} mono={!!d.task.resultCode} />
                    <KeyValue label="Significado" value={resultCodeText(d.task.resultCode) ?? '—'} last={!d.task.resultMessage} />
                    {d.task.resultMessage && (
                      <View style={styles.raw}>
                        <Text variant="monoSmall" color="secondary" selectable>
                          {d.task.resultMessage}
                        </Text>
                      </View>
                    )}
                  </Card>
                </Section>
              )}

              <Section title="Tentativas" subtitle="Registos imutáveis — nunca reescritos">
                {d.attempts.length ? (
                  <ListGroup>
                    {d.attempts.map((attempt, index) => (
                      <ListItem
                        key={attempt.id}
                        icon={attempt.outcome === 'SUCCESS' ? 'checkCircle' : attempt.outcome === 'FAILED' ? 'error' : 'unknown'}
                        iconTone={attempt.outcome === 'SUCCESS' ? 'success' : attempt.outcome === 'FAILED' ? 'danger' : 'warning'}
                        title={`${attempt.source === 'MANUAL' ? 'Decisão' : `Tentativa ${attempt.attemptNumber}`} · ${resultCodeText(attempt.resultCode) ?? attempt.resultCode}`}
                        subtitle={[
                          SOURCE_TEXT[attempt.source],
                          attempt.slotIndex !== null ? `SIM slot ${attempt.slotIndex + 1}` : null,
                          attempt.retryable ? 'repetível' : null,
                          attempt.note,
                          formatDateTime(attempt.finishedAt, true),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        divider={index < d.attempts.length - 1}
                      />
                    ))}
                  </ListGroup>
                ) : (
                  <Card>
                    <EmptyState compact icon="queue" title="Ainda sem tentativas" description="A primeira tentativa começa quando um telemóvel worker a iniciar." />
                  </Card>
                )}
              </Section>

              <Section title="Histórico">
                <Card>
                  {d.events.length ? (
                    <Timeline items={historyItems(d)} />
                  ) : (
                    <Text variant="callout" color="muted">
                      Sem histórico disponível.
                    </Text>
                  )}
                </Card>
              </Section>
            </Animated.View>
          );
        }}
      </QueryView>

      <BottomSheet
        visible={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === 'retry' ? 'Repetir ativação?' : decision === 'SUCCESS' ? 'Confirmar que foi ativado?' : 'Marcar como falhada?'}
        subtitle={
          decision === 'retry'
            ? 'A tarefa volta à fila e um telemóvel executa o USSD outra vez.'
            : 'Use só depois de verificar com o cliente ou a operadora. A decisão fica auditada.'
        }
        footer={
          <Button
            label={decision === 'retry' ? 'Repetir' : 'Registar decisão'}
            icon="check"
            fullWidth
            loading={retry.isPending || resolve.isPending}
            onPress={() => void submit()}
          />
        }>
        <Input
          label={decision === 'retry' ? 'Nota (opcional)' : 'O que foi verificado'}
          icon="edit"
          value={note}
          onChangeText={setNote}
          placeholder={decision === 'retry' ? 'Ex.: saldo carregado no SIM' : 'Ex.: cliente confirmou que recebeu o pacote'}
          maxLength={ACTIVATION_RULES.noteMax}
          multiline
        />
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
  hero: {
    gap: t.spacing.xs,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  banner: {
    flexDirection: 'row',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
  },
  result: {
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
