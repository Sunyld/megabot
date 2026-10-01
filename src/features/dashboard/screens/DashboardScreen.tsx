import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { planLabels, severityTone } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useActivity, useAutomationSettings, useDashboard, useNow, useUnreadCount } from '@/hooks';
import { createStyles, useTheme } from '@/theme';
import type { AttentionItem } from '@/types';
import { formatNumber, formatRelative, greeting } from '@/utils/format';
import { hrefFor } from '@/utils/navigation';

import { ActivityRow } from '../components/ActivityRow';
import { AutomationHero } from '../components/AutomationHero';
import { RevenueCard } from '../components/RevenueCard';
import { SystemsRow } from '../components/SystemsRow';

function DashboardSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.stack}>
      <Skeleton height={196} radius={16} />
      <Skeleton height={236} radius={16} />
      <View style={styles.grid}>
        <Skeleton height={96} radius={16} style={styles.flex} />
        <Skeleton height={96} radius={16} style={styles.flex} />
      </View>
      <View style={styles.grid}>
        <Skeleton height={96} radius={16} style={styles.flex} />
        <Skeleton height={96} radius={16} style={styles.flex} />
      </View>
    </View>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tone = colors.tones[severityTone[item.severity]];
  return (
    <Card padding={14} onPress={() => router.push(hrefFor(item.target))} style={[styles.attention, { borderLeftColor: tone.solid }]}>
      <Icon name={item.severity === 'danger' ? 'error' : 'warning'} size={22} color={tone.fg} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="callout" color="secondary" numberOfLines={2}>
          {item.description}
        </Text>
      </View>
      <Icon name="chevronRight" size={20} color={colors.textMuted} />
    </Card>
  );
}

export function DashboardScreen() {
  const { user, tenant } = useCurrentSession();
  const styles = useStyles();
  const now = useNow();
  const dashboard = useDashboard();
  const activity = useActivity();
  const automation = useAutomationSettings();
  const unread = useUnreadCount();

  const refresh = () => {
    void dashboard.refetch();
    void activity.refetch();
  };

  const firstName = user.name.split(' ')[0];

  return (
    <Screen
      refreshing={dashboard.isRefreshing}
      onRefresh={refresh}
      header={
        <View style={styles.header}>
          <Avatar name={tenant.name} tone="brand" size={44} shape="rounded" />
          <View style={styles.flex}>
            <Text variant="title2" numberOfLines={1}>
              {`${greeting(new Date(now))}, ${firstName} 👋`}
            </Text>
            <Text variant="callout" color="secondary" numberOfLines={1}>
              {tenant.plan ? `${tenant.name} · ${planLabels[tenant.plan]}` : tenant.name}
            </Text>
          </View>
          <IconButton
            icon="bell"
            variant="surface"
            accessibilityLabel="Notificações"
            badge={unread}
            onPress={() => router.push('/notifications')}
          />
        </View>
      }>
      <QueryView query={dashboard} loading={<DashboardSkeleton />}>
        {(summary) => (
          <Animated.View entering={FadeInDown.duration(320)} style={styles.stack}>
            <AutomationHero summary={summary} active={automation.data?.enabled ?? true} />

            <Section title="Hoje" subtitle="Atualizado em tempo real">
              <RevenueCard summary={summary} />
              <View style={styles.grid}>
                <StatCard label="Vendas" value={formatNumber(summary.sales)} icon="sales" tone="info" onPress={() => router.navigate('/orders')} />
                <StatCard label="Pacotes ativados" value={formatNumber(summary.activated)} icon="bolt" tone="success" onPress={() => router.navigate({ pathname: '/orders', params: { filter: 'completed' } })} />
              </View>
              <View style={styles.grid}>
                <StatCard
                  label="Pendentes"
                  value={formatNumber(summary.pending)}
                  icon="pending"
                  tone="warning"
                  caption="Número ou pagamento"
                  onPress={() => router.navigate({ pathname: '/orders', params: { filter: 'pending' } })}
                />
                <StatCard
                  label="Falhas"
                  value={formatNumber(summary.failed)}
                  icon="error"
                  tone="danger"
                  caption={summary.failed ? 'Requerem atenção' : 'Tudo em ordem'}
                  onPress={() => router.navigate({ pathname: '/orders', params: { filter: 'failed' } })}
                />
              </View>
            </Section>

            <Section title="Sistemas">
              <SystemsRow systems={summary.systems} />
            </Section>

            {summary.attention.length > 0 && (
              <Section title="Precisa de atenção" subtitle={`${summary.attention.length} ${summary.attention.length === 1 ? 'item requer' : 'itens requerem'} intervenção humana`}>
                <View style={styles.list}>
                  {summary.attention.map((item) => (
                    <AttentionCard key={item.id} item={item} />
                  ))}
                </View>
              </Section>
            )}

            <Section title="Atividade recente" action={{ label: 'Ver tudo', onPress: () => router.push('/notifications') }}>
              <QueryView
                query={activity}
                loading={<Skeleton height={280} radius={16} />}
                isEmpty={(items) => items.length === 0}
                empty={
                  <ListGroup>
                    <EmptyState compact icon="history" title="Sem atividade ainda" description="Os eventos de vendas e ativações aparecem aqui." />
                  </ListGroup>
                }>
                {(items) => (
                  <ListGroup>
                    {items.map((item, index) => (
                      <ActivityRow
                        key={item.id}
                        kind={item.kind}
                        severity={item.severity}
                        title={item.title}
                        description={item.description}
                        meta={formatRelative(item.at, now)}
                        divider={index < items.length - 1}
                        onPress={item.target ? () => router.push(hrefFor(item.target!)) : undefined}
                      />
                    ))}
                  </ListGroup>
                )}
              </QueryView>
            </Section>
          </Animated.View>
        )}
      </QueryView>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.md,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  stack: {
    gap: t.spacing.xxl,
  },
  grid: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  list: {
    gap: t.spacing.sm,
  },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    borderLeftWidth: 4,
  },
}));
