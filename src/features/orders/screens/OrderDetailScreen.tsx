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
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { Timeline } from '@/components/ui/Timeline';
import { toast } from '@/components/ui/Toast';
import { orderEventLabels, orderStatusMeta, taskStatusMeta } from '@/constants/labels';
import { TaskAttempts } from '@/features/automation/components/TaskAttempts';
import {
  useCancelOrder,
  useConversations,
  useMarkOrderAwaitingPayment,
  useOrder,
  useResendConfirmation,
  useRetryActivation,
  useTask,
  useVerifyActivation,
} from '@/hooks';
import { errorMessage } from '@/services';
import { ORDER_RULES } from '@/services/orderRules';
import { createStyles, useTheme } from '@/theme';
import type { Order, OrderEvent } from '@/types';
import {
  formatDataAmount,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatPhone,
  formatPrice,
  formatTime,
} from '@/utils/format';

import { buildOrderTimeline, isVerifyingActivation } from '../timeline';

function statusExplanation(order: Order): string {
  switch (order.status) {
    case 'COMPLETED': {
      const activated = order.events.find((e) => e.type === 'activated');
      const seconds = activated ? (new Date(activated.at).getTime() - new Date(order.createdAt).getTime()) / 1000 : 0;
      const manual = order.events.some((e) => e.type === 'payment_confirmed' && e.description?.includes('manualmente'));
      if (seconds <= 0) return 'Pacote entregue ao cliente.';
      return manual
        ? `Pacote entregue ${formatDuration(seconds)} depois do pedido, após a sua aprovação do pagamento.`
        : `Pacote entregue ${formatDuration(seconds)} depois do pedido, sem intervenção humana.`;
    }
    case 'PENDING':
      return order.destination
        ? 'Pedido registado. Envie os dados de pagamento ao cliente e marque-o como "a aguardar pagamento".'
        : 'O cliente ainda não indicou o número que vai receber o pacote.';
    case 'AWAITING_PAYMENT':
      return order.paymentId
        ? 'Comprovativo recebido. A aguardar a mensagem de confirmação da carteira para validar o ID da transação.'
        : 'A aguardar o pagamento do cliente.';
    case 'VERIFYING':
      return 'Os dados do pagamento não coincidem com o pedido. A decisão é sua.';
    case 'PAID':
      return 'Pagamento confirmado.';
    case 'READY_FOR_ACTIVATION':
      return 'Pagamento confirmado por regras. A ativação está na fila.';
    case 'ACTIVATING':
      return isVerifyingActivation(order)
        ? 'O USSD foi enviado mas a operadora não confirmou. O MegaBot verifica o resultado antes de repetir — nunca duplica uma ativação.'
        : 'O USSD está a ser executado num dos seus dispositivos.';
    case 'FAILED':
      return order.failureReason ?? 'A ativação falhou.';
    case 'CANCELLED':
      return order.cancelReason ? `Pedido cancelado: ${order.cancelReason}` : 'Este pedido foi cancelado e não será ativado.';
    case 'EXPIRED':
      return 'O prazo para pagamento terminou. Este pedido expirou e não será ativado.';
  }
}

/** One line per history entry: "Pendente → Aguarda pagamento", reasons, demo journey details. */
function eventSubtitle(event: OrderEvent): string | undefined {
  if (event.type === 'status_changed' && event.fromStatus && event.toStatus) {
    return `${orderStatusMeta[event.fromStatus].label} → ${orderStatusMeta[event.toStatus].label}`;
  }
  return event.description;
}

function DetailSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.stack}>
      <Skeleton height={92} radius={16} />
      <SkeletonCard lines={5} />
      <Skeleton height={320} radius={16} />
    </View>
  );
}

export function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const order = useOrder(id);
  const task = useTask(order.data?.taskId ?? '');
  const conversations = useConversations();

  const retry = useRetryActivation();
  const verify = useVerifyActivation();
  const cancel = useCancelOrder();
  const requestPayment = useMarkOrderAwaitingPayment();
  const resend = useResendConfirmation();

  const [retryOpen, setRetryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const conversation = conversations.data?.find((c) => c.orderId === id);
  const destinationValid = destination.replace(/\D/g, '').length === 9;

  const openRetry = (current: string | null) => {
    setDestination(current ?? '');
    setRetryOpen(true);
  };

  const runRetry = async () => {
    try {
      await retry.mutateAsync({ id, destination });
      setRetryOpen(false);
      toast.success('Ativação reiniciada', 'Acompanhe o progresso na linha do tempo.');
    } catch (e) {
      toast.error('Não foi possível repetir', errorMessage(e));
    }
  };

  const runVerify = async () => {
    try {
      await verify.mutateAsync(id);
      toast.show({ title: 'A verificar com a operadora…', tone: 'info', icon: 'history' });
    } catch (e) {
      toast.error('Falha na verificação', errorMessage(e));
    }
  };

  const runRequestPayment = async () => {
    try {
      await requestPayment.mutateAsync(id);
      toast.success('A aguardar pagamento', 'O pedido passou para "Aguarda pagamento".');
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
    }
  };

  const runCancel = async () => {
    try {
      await cancel.mutateAsync({ id, reason: cancelReason });
      setCancelOpen(false);
      setCancelReason('');
      toast.success('Pedido cancelado');
    } catch (e) {
      toast.error('Não foi possível cancelar', errorMessage(e));
    }
  };

  const runResend = async () => {
    try {
      await resend.mutateAsync(id);
      toast.success('Confirmação reenviada', 'O cliente recebeu a mensagem no WhatsApp.');
    } catch (e) {
      toast.error('Falha ao reenviar', errorMessage(e));
    }
  };

  const data = order.data;
  const actions = data
    ? {
        requestPayment: data.status === 'PENDING' && data.destination !== null,
        cancel: data.status === 'PENDING' || data.status === 'AWAITING_PAYMENT',
        reviewPayment: data.status === 'VERIFYING' && data.paymentId !== null,
        retry: data.status === 'FAILED' && data.taskId !== null,
        verify: isVerifyingActivation(data) && data.taskId !== null,
        resend: data.status === 'COMPLETED' && data.channel !== null,
      }
    : null;
  const hasFooterAction = actions ? Object.values(actions).some(Boolean) : false;

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={order.isRefreshing}
      onRefresh={() => {
        void order.refetch();
        void task.refetch();
      }}
      header={
        <StackHeader
          title={data ? data.code : 'Pedido'}
          subtitle={data ? `${formatDayLabel(data.createdAt)} às ${formatTime(data.createdAt)}` : undefined}
        />
      }
      footer={
        data && actions && hasFooterAction ? (
          <View style={styles.footer}>
            {actions.requestPayment && (
              <Button label="Pedir pagamento" icon="wallet" fullWidth loading={requestPayment.isPending} onPress={runRequestPayment} />
            )}
            {actions.retry && (
              <Button label="Corrigir número e repetir" icon="refresh" fullWidth onPress={() => openRetry(data.destination)} />
            )}
            {actions.verify && (
              <Button label="Verificar agora" icon="history" fullWidth loading={verify.isPending} onPress={runVerify} />
            )}
            {actions.reviewPayment && (
              <Button
                label="Rever pagamento"
                icon="payments"
                fullWidth
                onPress={() => router.push({ pathname: '/payments/[id]', params: { id: data.paymentId! } })}
              />
            )}
            {actions.resend && (
              <Button label="Reenviar confirmação" icon="send" variant="secondary" fullWidth loading={resend.isPending} onPress={runResend} />
            )}
            {actions.cancel && (
              <Button label="Cancelar pedido" icon="cancel" variant="danger" fullWidth onPress={() => setCancelOpen(true)} />
            )}
          </View>
        ) : null
      }>
      <QueryView query={order} loading={<DetailSkeleton />}>
        {(o) => (
          <Animated.View entering={FadeInDown.duration(280)} style={styles.stack}>
            <Card
              padding={16}
              style={[styles.statusCard, { backgroundColor: colors.tones[orderStatusMeta[o.status].tone].bg, borderColor: 'transparent' }]}>
              <View style={styles.statusRow}>
                <Icon name={orderStatusMeta[o.status].icon} size={24} color={colors.tones[orderStatusMeta[o.status].tone].fg} />
                <Text variant="title3" colorValue={colors.tones[orderStatusMeta[o.status].tone].fg}>
                  {orderStatusMeta[o.status].label}
                </Text>
              </View>
              <Text variant="callout" color="secondary">
                {statusExplanation(o)}
              </Text>
            </Card>

            <Card>
              <View style={styles.productRow}>
                <View style={styles.flex}>
                  <Text variant="overline" color="muted">
                    Produto
                  </Text>
                  <Text variant="title1">{o.productName}</Text>
                </View>
                <View style={styles.price}>
                  <Text variant="overline" color="muted">
                    Preço
                  </Text>
                  <Text variant="title1">{formatPrice(o.price, o.currency)}</Text>
                </View>
              </View>
              <View style={styles.kv}>
                <KeyValue label="Dados" value={formatDataAmount(o.dataAmount, o.dataUnit)} />
                <KeyValue label="Número de destino" value={o.destination ? formatPhone(o.destination) : 'Pendente'} />
                <KeyValue label="Cliente" value={o.customer.name ?? '—'} />
                {o.customer.whatsapp ? <KeyValue label="WhatsApp" value={formatPhone(o.customer.whatsapp)} /> : null}
                <KeyValue label="Canal" value={o.channel?.name ?? 'Registado na app'} />
                <KeyValue label="Referência" value={o.code} mono />
                <KeyValue label="Criado em" value={formatDateTime(o.createdAt, true)} last />
              </View>
              <Text variant="caption" color="muted" style={styles.snapshotNote}>
                Produto, preço e dados ficam fixados no momento do pedido — alterações futuras ao produto não mudam este pedido.
              </Text>
            </Card>

            <Section title="Pagamento">
              <ListGroup>
                {o.paymentId ? (
                  <ListItem
                    icon="receipt"
                    iconTone="success"
                    title={o.transactionId ?? 'Pagamento'}
                    subtitle="ID da transação · referência de reconciliação"
                    chevron
                    onPress={() => router.push({ pathname: '/payments/[id]', params: { id: o.paymentId! } })}
                  />
                ) : (
                  <ListItem icon="pending" iconTone="warning" title="Sem pagamento" subtitle="Nenhum pagamento associado a este pedido." />
                )}
              </ListGroup>
            </Section>

            <Section title="Linha do tempo">
              <Card>
                <Timeline items={buildOrderTimeline(o)} />
              </Card>
            </Section>

            <Section title="Histórico" subtitle="Registo de cada alteração do pedido.">
              <ListGroup>
                {[...o.events].reverse().map((event, index, list) => (
                  <ListItem
                    key={event.id}
                    icon={event.type === 'cancelled' || event.type === 'expired' || event.type === 'failed' ? 'cancel' : 'history'}
                    iconTone={event.type === 'cancelled' || event.type === 'failed' ? 'danger' : 'neutral'}
                    title={orderEventLabels[event.type]}
                    subtitle={eventSubtitle(event)}
                    value={formatDateTime(event.at)}
                    divider={index < list.length - 1}
                  />
                ))}
              </ListGroup>
            </Section>

            {o.taskId && (
              <Section
                title="Ativação"
                right={task.data ? <StatusBadge meta={{ ...taskMeta(task.data.status) }} size="sm" /> : undefined}>
                <Card style={styles.taskCard}>
                  {task.data ? (
                    <>
                      <KeyValue label="Tarefa" value={task.data.code} mono />
                      <KeyValue label="Código USSD" value={task.data.ussdCode} mono />
                      {task.data.operatorResponse ? <KeyValue label="Resposta" value={task.data.operatorResponse} last /> : null}
                      <TaskAttempts attempts={task.data.attempts} />
                    </>
                  ) : (
                    <Skeleton height={120} />
                  )}
                </Card>
              </Section>
            )}

            {conversation && (
              <ListGroup>
                <ListItem
                  icon="whatsapp"
                  iconTone="success"
                  title="Ver conversa no WhatsApp"
                  subtitle={`${conversation.messages.length} mensagens com ${conversation.customerName}`}
                  chevron
                  onPress={() => router.push({ pathname: '/whatsapp/[id]', params: { id: conversation.id } })}
                />
              </ListGroup>
            )}
          </Animated.View>
        )}
      </QueryView>

      <BottomSheet
        visible={retryOpen}
        onClose={() => setRetryOpen(false)}
        title="Repetir ativação"
        subtitle="Confirme o número com o cliente antes de repetir."
        footer={
          <Button label="Repetir ativação" icon="bolt" fullWidth disabled={!destinationValid} loading={retry.isPending} onPress={runRetry} />
        }>
        <Input
          label="Número de destino"
          icon="phone"
          value={destination}
          onChangeText={setDestination}
          keyboardType="phone-pad"
          maxLength={12}
          placeholder="84 000 0000"
          error={destination && !destinationValid ? 'O número deve ter 9 dígitos (ex: 840745232).' : null}
          hint="O pagamento já foi confirmado — não será cobrado de novo."
        />
      </BottomSheet>

      <BottomSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar pedido?"
        subtitle="O pedido deixa de poder ser pago ou ativado. Esta ação não pode ser desfeita."
        footer={
          <Button label="Cancelar pedido" icon="cancel" variant="danger" fullWidth loading={cancel.isPending} onPress={runCancel} />
        }>
        <Input
          label="Motivo (opcional)"
          icon="info"
          value={cancelReason}
          onChangeText={setCancelReason}
          maxLength={ORDER_RULES.reasonMax}
          placeholder="Ex.: cliente desistiu"
          hint="Fica registado no histórico do pedido."
        />
      </BottomSheet>
    </Screen>
  );
}

const taskMeta = (status: keyof typeof taskStatusMeta) => {
  const { label, tone, icon } = taskStatusMeta[status];
  return { label, tone, icon };
};

const useStyles = createStyles((t) => ({
  stack: {
    gap: t.spacing.xxl,
  },
  flex: {
    flex: 1,
  },
  statusCard: {
    gap: t.spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  productRow: {
    flexDirection: 'row',
    gap: t.spacing.lg,
    paddingBottom: t.spacing.md,
  },
  price: {
    alignItems: 'flex-end',
  },
  kv: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  snapshotNote: {
    paddingTop: t.spacing.sm,
  },
  taskCard: {
    gap: t.spacing.xs,
  },
  footer: {
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
    gap: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
}));
