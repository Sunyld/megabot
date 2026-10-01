import { View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Text } from '@/components/ui/Text';
import { operatorLabels } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { Product } from '@/types';
import { formatPrice, formatValidity } from '@/utils/format';

export function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const active = product.status === 'ACTIVE';

  return (
    <Card
      padding={14}
      onPress={onPress}
      style={[styles.card, !active && styles.inactive]}
      accessibilityLabel={`${product.name}, ${formatPrice(product.price, product.currency)}, ${formatValidity(product.validityHours)}, ${active ? 'ativo' : 'inativo'}`}>
      <View style={styles.top}>
        <View style={styles.well}>
          <Icon name={product.dataAmount === null ? 'data' : 'bolt'} size={16} color={colors.tones.brand.fg} />
        </View>
        {product.popular && active ? <Badge label="Popular" tone="warning" icon="star" size="sm" /> : null}
        {!active ? <Badge label={product.ussdFlow ? 'Inativo' : 'Sem USSD'} tone="neutral" size="sm" /> : null}
      </View>
      <Text variant="title2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {product.name}
      </Text>
      <Text variant="stat" color="brand">
        {formatPrice(product.price, product.currency)}
      </Text>
      <Text variant="caption" color="muted" numberOfLines={1}>
        {`${formatValidity(product.validityHours)} · ${operatorLabels[product.operator]}`}
      </Text>
      <View style={styles.footer}>
        <StatusDot tone={active ? 'success' : 'neutral'} size={7} />
        <Text variant="caption" color="secondary" numberOfLines={1}>
          {product.soldToday ? `${product.soldToday} vendidos hoje` : 'Sem vendas hoje'}
        </Text>
      </View>
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  inactive: {
    opacity: 0.6,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.spacing.xs,
    minHeight: 28,
  },
  well: {
    width: 28,
    height: 28,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tones.brand.bg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: t.spacing.sm,
    paddingTop: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
}));
