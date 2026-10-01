import { router } from 'expo-router';
import { Fragment } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Text } from '@/components/ui/Text';
import { createStyles, useTheme } from '@/theme';
import type { DashboardSummary } from '@/types';
import { formatDuration, formatNumber } from '@/utils/format';

/**
 * The product promise in one card: order → payment → activation → customer,
 * with today's counts at each stage. Tapping opens the automation console.
 */
export function AutomationHero({ summary, active }: { summary: DashboardSummary; active: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const ink = active ? '#FFFFFF' : colors.textInverse;
  const soft = active ? 'rgba(255,255,255,0.78)' : colors.textMuted;
  const stages = [
    { label: 'Pedidos', value: summary.pipeline.received },
    { label: 'Pagos', value: summary.pipeline.paid },
    { label: 'Ativados', value: summary.pipeline.activated },
    { label: 'Entregues', value: summary.pipeline.delivered },
  ];

  return (
    <Card
      variant={active ? 'brand' : 'inverse'}
      padding={18}
      onPress={() => router.push('/automation')}
      accessibilityLabel={`Automação ${active ? 'ativa' : 'pausada'}. Abrir consola de automação`}>
      <View style={styles.top}>
        <View style={styles.status}>
          <StatusDot tone={active ? 'success' : 'warning'} pulse={active} size={8} />
          <Text variant="captionStrong" color={active ? 'onBrand' : 'inverse'}>
            {active ? 'AUTOMAÇÃO ATIVA' : 'AUTOMAÇÃO PAUSADA'}
          </Text>
        </View>
        <Icon name="chevronRight" size={20} color={ink} />
      </View>

      <Text variant="title2" color={active ? 'onBrand' : 'inverse'} style={styles.headline}>
        {active ? 'O MegaBot está a vender por si' : 'Os pedidos aguardam a sua ação'}
      </Text>

      <View style={styles.pipeline}>
        {stages.map((stage, index) => (
          <Fragment key={stage.label}>
            <View style={styles.stage}>
              <Text variant="stat" color={active ? 'onBrand' : 'inverse'}>
                {formatNumber(stage.value)}
              </Text>
              <Text variant="caption" colorValue={soft} numberOfLines={1}>
                {stage.label}
              </Text>
            </View>
            {index < stages.length - 1 && (
              <Icon name="chevronRight" size={16} color={soft} />
            )}
          </Fragment>
        ))}
      </View>

      <View style={[styles.footer, active ? styles.footerActive : styles.footerPaused]}>
        <Icon name="speed" size={16} color={ink} />
        <Text variant="captionStrong" color={active ? 'onBrand' : 'inverse'} style={styles.flex} numberOfLines={1}>
          {summary.avgActivationSeconds
            ? `Ativação média em ${formatDuration(summary.avgActivationSeconds)}`
            : 'Sem ativações hoje'}
        </Text>
      </View>
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  headline: {
    marginTop: t.spacing.sm,
  },
  pipeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: t.spacing.lg,
    gap: 2,
  },
  stage: {
    flex: 1,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginTop: t.spacing.lg,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  footerActive: {
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  footerPaused: {
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  flex: {
    flex: 1,
  },
}));
