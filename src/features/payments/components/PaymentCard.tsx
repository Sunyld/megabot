import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { paymentMethodMeta, paymentStatusMeta } from '@/constants/labels';
import { createStyles } from '@/theme';
import type { Payment } from '@/types';
import { formatMoney, formatRelative } from '@/utils/format';

export function PaymentMethodBadge({ method }: { method: Payment['method'] }) {
  if (!method) return null;
  const meta = paymentMethodMeta[method];
  return <Badge label={meta.label} tone={meta.tone} variant="outline" size="sm" />;
}

export function PaymentCard({ payment, now }: { payment: Payment; now?: number }) {
  const styles = useStyles();
  const status = paymentStatusMeta[payment.status];

  return (
    <Card
      padding={14}
      style={styles.card}
      onPress={() => router.push({ pathname: '/payments/[id]', params: { id: payment.id } })}
      accessibilityLabel={`Pagamento ${payment.transactionId ?? 'sem ID de transação'}, ${formatMoney(payment.amount)}, ${status.label}`}>
      <View style={styles.row}>
        <Text variant="mono" color={payment.transactionId ? undefined : 'muted'} numberOfLines={1} style={styles.flex}>
          {payment.transactionId ?? 'Sem ID de transação'}
        </Text>
        <StatusBadge meta={status} size="sm" />
      </View>

      <View style={styles.row}>
        <Text variant="title2">{formatMoney(payment.amount)}</Text>
        <PaymentMethodBadge method={payment.method} />
      </View>

      <View style={styles.footer}>
        <Text variant="caption" color="secondary" numberOfLines={1} style={styles.flex}>
          {payment.orderCode ? `Pedido #${payment.orderCode}` : 'Sem pedido associado'}
          {payment.payerName ? ` · ${payment.payerName}` : ''}
        </Text>
        <Text variant="caption" color="muted">
          {formatRelative(payment.receivedAt, now)}
        </Text>
      </View>

      {payment.reviewReason && payment.status !== 'confirmed' ? (
        <Text variant="caption" color={payment.status === 'rejected' ? 'danger' : 'warning'} numberOfLines={2}>
          {payment.reviewReason}
        </Text>
      ) : null}
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    gap: t.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
  },
  flex: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingTop: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
}));
