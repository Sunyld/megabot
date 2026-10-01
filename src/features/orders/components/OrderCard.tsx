import { router } from 'expo-router';
import { View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { orderStatusMeta } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { Order } from '@/types';
import { formatMoney, formatPhone, formatRelative } from '@/utils/format';

export function OrderCard({ order, now }: { order: Order; now?: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const status = orderStatusMeta[order.status];

  return (
    <Card
      padding={14}
      onPress={() => router.push({ pathname: '/orders/[id]', params: { id: order.id } })}
      accessibilityLabel={`Pedido ${order.code}, ${order.productName}, ${formatMoney(order.price)}, ${status.label}`}
      style={styles.card}>
      <View style={styles.row}>
        <Text variant="mono" color="secondary">
          {`#${order.code}`}
        </Text>
        <StatusBadge meta={status} size="sm" />
      </View>

      <View style={styles.row}>
        <Text variant="title2" numberOfLines={1} style={styles.flex}>
          {order.productName}
        </Text>
        <Text variant="title2">{formatMoney(order.price)}</Text>
      </View>

      <View style={styles.details}>
        <View style={styles.detail}>
          <Icon name="phone" size={16} color={colors.textMuted} />
          <Text variant="callout" color={order.destination ? 'primary' : 'muted'} tabular>
            {order.destination ? formatPhone(order.destination) : 'Número pendente'}
          </Text>
        </View>
        <View style={styles.detail}>
          <Icon name="receipt" size={16} color={colors.textMuted} />
          {order.transactionId ? (
            <Text variant="monoSmall" color="secondary" numberOfLines={1} style={styles.flex}>
              {order.transactionId}
            </Text>
          ) : (
            <Text variant="callout" color="muted">
              Aguardando pagamento
            </Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text variant="caption" color="muted" numberOfLines={1} style={styles.flex}>
          {`${order.customer.name} · ${order.channel.name}`}
        </Text>
        <Text variant="caption" color="muted">
          {formatRelative(order.createdAt, now)}
        </Text>
      </View>
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
  details: {
    gap: 6,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
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
