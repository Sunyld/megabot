import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FilterChip } from '@/components/ui/Chips';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { checkLabels, paymentStatusMeta } from '@/constants/labels';
import { useApprovePayment, usePayment, useRejectPayment } from '@/hooks';
import { errorMessage } from '@/services';
import { createStyles, type Tone, useTheme } from '@/theme';
import type { Payment, ReconciliationCheck } from '@/types';
import { formatDateTime, formatMoney, formatPercent, formatPhone, formatTime } from '@/utils/format';

import { PaymentMethodBadge } from '../components/PaymentCard';

const rejectReasons = [
  { value: 'Valor insuficiente', label: 'Valor insuficiente' },
  { value: 'Comprovativo inválido', label: 'Comprovativo inválido' },
  { value: 'ID de transação duplicado', label: 'ID duplicado' },
  { value: 'Pagamento não recebido', label: 'Não recebido' },
];

function decision(payment: Payment): { tone: Tone; title: string; body: string } {
  switch (payment.status) {
    case 'confirmed':
      return payment.confirmedBy === 'manual'
        ? { tone: 'success', title: 'Aprovado manualmente', body: 'Aprovou este pagamento apesar das diferenças. A ativação foi iniciada.' }
        : {
            tone: 'success',
            title: 'Confirmado por regras',
            body: 'O ID da transação, o valor, a conta e a data coincidem com a mensagem real da carteira.',
          };
    case 'pending':
      return {
        tone: 'info',
        title: 'A aguardar a carteira',
        body: 'O comprovativo foi lido, mas a mensagem de confirmação (SMS) com este ID ainda não chegou a nenhum dispositivo.',
      };
    case 'review':
      return { tone: 'warning', title: 'Precisa da sua decisão', body: payment.reviewReason ?? 'Os dados não coincidem.' };
    case 'rejected':
      return { tone: 'danger', title: 'Rejeitado', body: payment.reviewReason ?? 'Pagamento rejeitado.' };
  }
}

function CheckRow({ check, last }: { check: ReconciliationCheck; last: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const icon = check.result === 'match' ? 'checkCircle' : check.result === 'mismatch' ? 'cancel' : 'pending';
  const tone = check.result === 'match' ? 'success' : check.result === 'mismatch' ? 'danger' : 'neutral';

  return (
    <View style={[styles.check, !last && styles.divider]}>
      <Icon name={icon} size={22} color={colors.tones[tone].solid} />
      <View style={styles.flex}>
        <Text variant="bodyMedium">{checkLabels[check.key]}</Text>
        {check.result === 'mismatch' ? (
          <Text variant="caption" color="danger">
            {`Esperado ${check.expected ?? '—'} · Recebido ${check.actual ?? '—'}`}
          </Text>
        ) : check.result === 'missing' ? (
          <Text variant="caption" color="muted">
            A aguardar a mensagem da carteira
          </Text>
        ) : check.actual ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {check.actual}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function RawMessage({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.raw}>
      <Text variant="monoSmall" color="secondary" selectable>
        {text}
      </Text>
    </View>
  );
}

export function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const payment = usePayment(id);
  const approve = useApprovePayment();
  const reject = useRejectPayment();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState(rejectReasons[0].value);

  const runApprove = async () => {
    try {
      await approve.mutateAsync(id);
      setApproveOpen(false);
      toast.success('Pagamento aprovado', 'A ativação do pacote foi iniciada.');
    } catch (e) {
      toast.error('Não foi possível aprovar', errorMessage(e));
    }
  };

  const runReject = async () => {
    try {
      await reject.mutateAsync({ id, reason });
      setRejectOpen(false);
      toast.show({ title: 'Pagamento rejeitado', description: 'O cliente será informado no WhatsApp.', tone: 'danger', icon: 'cancel' });
    } catch (e) {
      toast.error('Não foi possível rejeitar', errorMessage(e));
    }
  };

  const data = payment.data;

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={payment.isRefreshing}
      onRefresh={() => void payment.refetch()}
      header={<StackHeader title="Pagamento" subtitle={data?.transactionId} />}
      footer={
        data?.status === 'review' ? (
          <View style={styles.footer}>
            <Button label="Rejeitar" variant="danger" icon="cancel" style={styles.flex} onPress={() => setRejectOpen(true)} />
            <Button label="Aprovar e ativar" variant="success" icon="check" style={styles.flex} onPress={() => setApproveOpen(true)} />
          </View>
        ) : null
      }>
      <QueryView
        query={payment}
        loading={
          <View style={styles.stack}>
            <Skeleton height={150} radius={16} />
            <SkeletonCard lines={5} />
          </View>
        }>
        {(p) => {
          const d = decision(p);
          return (
            <Animated.View entering={FadeInDown.duration(280)} style={styles.stack}>
              <Card style={styles.hero}>
                <View style={styles.heroTop}>
                  <PaymentMethodBadge method={p.method} />
                  <StatusBadge meta={paymentStatusMeta[p.status]} />
                </View>
                <Text variant="hero">{formatMoney(p.amount)}</Text>
                <Text variant="mono" color="secondary" selectable>
                  {p.transactionId}
                </Text>
                <Text variant="caption" color="muted">
                  {`Pago em ${formatDateTime(p.paidAt, true)}${p.payerName ? ` por ${p.payerName}` : ''}`}
                </Text>
              </Card>

              <View style={[styles.decision, { backgroundColor: colors.tones[d.tone].bg }]}>
                <Icon name={d.tone === 'success' ? 'shield' : d.tone === 'danger' ? 'cancel' : d.tone === 'warning' ? 'warning' : 'pending'} size={22} color={colors.tones[d.tone].fg} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" colorValue={colors.tones[d.tone].fg}>
                    {d.title}
                  </Text>
                  <Text variant="callout" color="secondary">
                    {d.body}
                  </Text>
                </View>
              </View>

              <Section title="Reconciliação" subtitle="Regras determinísticas — a IA nunca confirma pagamentos">
                <Card padding={0} style={styles.checks}>
                  {p.checks.map((check, index) => (
                    <CheckRow key={check.key} check={check} last={index === p.checks.length - 1} />
                  ))}
                </Card>
              </Section>

              <Section
                title="Comprovativo do cliente"
                right={p.proof ? <Badge label={`IA · ${formatPercent(p.proof.confidence)}`} tone="ai" icon="ai" size="sm" /> : undefined}>
                {p.proof ? (
                  <Card style={styles.proof}>
                    <RawMessage text={p.proof.rawText} />
                    <View>
                      <Text variant="overline" color="muted" style={styles.overline}>
                        Dados extraídos
                      </Text>
                      <KeyValue label="ID da transação" value={p.proof.fields.transactionId} mono />
                      <KeyValue label="Valor" value={p.proof.fields.amount !== null ? formatMoney(p.proof.fields.amount) : null} />
                      <KeyValue label="Conta" value={p.proof.fields.account} />
                      <KeyValue label="Data e hora" value={p.proof.fields.datetime ? formatDateTime(p.proof.fields.datetime, true) : null} />
                      <KeyValue
                        label="Número de destino"
                        value={p.proof.fields.destination ? formatPhone(p.proof.fields.destination) : null}
                        last
                      />
                    </View>
                    <View style={styles.aiNote}>
                      <Icon name="info" size={16} color={colors.textMuted} />
                      <Text variant="caption" color="muted" style={styles.flex}>
                        A IA apenas interpreta a mensagem. A confirmação usa a mensagem real da carteira.
                      </Text>
                    </View>
                  </Card>
                ) : (
                  <Card>
                    <EmptyState compact icon="receipt" title="Sem comprovativo" description="Pagamento detetado apenas pela mensagem da carteira." />
                  </Card>
                )}
              </Section>

              <Section title="Mensagem da carteira" subtitle="Fonte de verdade da reconciliação">
                {p.walletEvent ? (
                  <Card style={styles.proof}>
                    <RawMessage text={p.walletEvent.rawText} />
                    <View style={styles.aiNote}>
                      <Icon name="sms" size={16} color={colors.textMuted} />
                      <Text variant="caption" color="muted" style={styles.flex}>
                        {`Lida por ${p.walletEvent.deviceName} · SIM ${p.walletEvent.simSlot} às ${formatTime(p.walletEvent.receivedAt, true)}`}
                      </Text>
                    </View>
                  </Card>
                ) : (
                  <Card>
                    <EmptyState
                      compact
                      icon="sms"
                      tone={p.status === 'rejected' ? 'danger' : 'info'}
                      title={p.status === 'rejected' ? 'Sem mensagem válida' : 'Ainda não recebida'}
                      description={
                        p.status === 'rejected'
                          ? 'Nenhuma nova mensagem da carteira corresponde a este comprovativo.'
                          : 'Assim que o SMS da carteira chegar, a confirmação é automática.'
                      }
                    />
                  </Card>
                )}
              </Section>

              {p.orderId && (
                <ListGroup>
                  <ListItem
                    icon="orders"
                    iconTone="info"
                    title={`Pedido #${p.orderCode}`}
                    subtitle="Ver pedido e ativação"
                    chevron
                    onPress={() => router.push({ pathname: '/orders/[id]', params: { id: p.orderId! } })}
                  />
                </ListGroup>
              )}
            </Animated.View>
          );
        }}
      </QueryView>

      <Dialog
        visible={approveOpen}
        onClose={() => setApproveOpen(false)}
        icon="checkCircle"
        tone="success"
        title="Aprovar pagamento?"
        message={
          data
            ? `Recebeu ${formatMoney(data.amount)}. Ao aprovar, o pacote é ativado de imediato e a diferença fica por sua conta.`
            : undefined
        }
        confirmLabel="Aprovar"
        confirmVariant="success"
        loading={approve.isPending}
        onConfirm={runApprove}
      />

      <Dialog
        visible={rejectOpen}
        onClose={() => setRejectOpen(false)}
        icon="cancel"
        tone="danger"
        title="Rejeitar pagamento?"
        message="O pedido será cancelado e o cliente recebe o motivo no WhatsApp."
        confirmLabel="Rejeitar"
        confirmVariant="danger"
        loading={reject.isPending}
        onConfirm={runReject}>
        <View style={styles.reasons}>
          <Text variant="captionStrong" color="secondary">
            Motivo
          </Text>
          <View style={styles.reasonChips}>
            {rejectReasons.map((r) => (
              <FilterChip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
            ))}
          </View>
        </View>
      </Dialog>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: t.spacing.sm,
  },
  decision: {
    flexDirection: 'row',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
  },
  checks: {
    paddingHorizontal: t.spacing.lg,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingVertical: t.spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  proof: {
    gap: t.spacing.md,
  },
  raw: {
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  overline: {
    marginBottom: t.spacing.xs,
  },
  aiNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.sm,
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
  reasons: {
    gap: t.spacing.sm,
  },
  reasonChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
}));
