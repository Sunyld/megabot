import { View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { BarChart } from '@/components/ui/BarChart';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { createStyles } from '@/theme';
import type { DashboardSummary } from '@/types';
import { formatDelta, formatMoney, pluralize } from '@/utils/format';

const pad = (n: number) => String(n).padStart(2, '0');

export function RevenueCard({ summary }: { summary: DashboardSummary }) {
  const styles = useStyles();
  const up = summary.revenueDelta >= 0;

  const data = summary.hourly.map((h) => ({
    key: `${pad(h.hour)}h`,
    label: `${pad(h.hour)}:00 – ${pad((h.hour + 1) % 24)}:00`,
    value: h.revenue,
    detail: pluralize(h.orders, 'venda', 'vendas'),
  }));

  return (
    <Card padding={18} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="callout" color="secondary">
            Receita de hoje
          </Text>
          <Text variant="hero" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatMoney(summary.revenue)}
          </Text>
        </View>
        {summary.revenueDelta !== 0 && (
          <Badge
            label={`${formatDelta(summary.revenueDelta)} vs ontem`}
            tone={up ? 'success' : 'danger'}
            icon={up ? 'revenue' : 'trendDown'}
            size="sm"
          />
        )}
      </View>
      <BarChart
        data={data}
        highlightIndex={data.length - 1}
        formatValue={formatMoney}
        accessibilityLabel="Receita por hora hoje. Toque numa coluna para ver o valor."
      />
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    gap: t.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
}));
