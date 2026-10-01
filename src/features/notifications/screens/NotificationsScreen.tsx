import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chips';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { ActivityRow } from '@/features/dashboard/components/ActivityRow';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useNow } from '@/hooks';
import { createStyles } from '@/theme';
import type { AppNotification } from '@/types';
import { formatDayLabel, formatRelative } from '@/utils/format';
import { hrefFor } from '@/utils/navigation';

type Filter = 'all' | 'unread' | 'alerts';

const matches = (n: AppNotification, filter: Filter) =>
  filter === 'unread' ? !n.read : filter === 'alerts' ? n.severity === 'warning' || n.severity === 'danger' : true;

export function NotificationsScreen() {
  const styles = useStyles();
  const now = useNow();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<Filter>('all');

  const list = notifications.data ?? [];
  const unread = list.filter((n) => !n.read).length;

  const options = [
    { value: 'all' as const, label: 'Todas', count: list.length },
    { value: 'unread' as const, label: 'Não lidas', count: unread },
    { value: 'alerts' as const, label: 'Alertas', count: list.filter((n) => matches(n, 'alerts')).length },
  ];

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.target) router.push(hrefFor(n.target));
  };

  const groups = (items: AppNotification[]) => {
    const out: { day: string; items: AppNotification[] }[] = [];
    for (const n of items) {
      const day = formatDayLabel(n.createdAt, now);
      const group = out.find((g) => g.day === day);
      if (group) group.items.push(n);
      else out.push({ day, items: [n] });
    }
    return out;
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={notifications.isRefreshing}
      onRefresh={() => void notifications.refetch()}
      header={
        <StackHeader
          title="Notificações"
          subtitle={unread ? `${unread} por ler` : 'Tudo lido'}
          right={
            unread ? (
              <Button label="Ler todas" variant="ghost" size="sm" onPress={() => markAll.mutate(undefined)} />
            ) : undefined
          }
        />
      }>
      <View style={styles.chips}>
        <ChipGroup options={options} value={filter} onChange={setFilter} />
      </View>

      <QueryView
        query={notifications}
        loading={<Skeleton height={360} radius={16} />}
        isEmpty={(items) => items.filter((n) => matches(n, filter)).length === 0}
        empty={
          <EmptyState
            icon="bell"
            tone="success"
            title={filter === 'unread' ? 'Está tudo em dia' : 'Sem notificações'}
            description="Avisamos aqui quando algo precisar da sua atenção."
          />
        }>
        {(items) => (
          <Animated.View key={filter} entering={FadeIn.duration(200)} style={styles.stack}>
            {groups(items.filter((n) => matches(n, filter))).map((group) => (
              <View key={group.day} style={styles.group}>
                <Text variant="overline" color="muted">
                  {group.day}
                </Text>
                <ListGroup>
                  {group.items.map((n, index) => (
                    <ActivityRow
                      key={n.id}
                      kind={n.kind}
                      severity={n.severity}
                      title={n.title}
                      description={n.body}
                      meta={formatRelative(n.createdAt, now)}
                      unread={!n.read}
                      divider={index < group.items.length - 1}
                      onPress={() => open(n)}
                    />
                  ))}
                </ListGroup>
              </View>
            ))}
          </Animated.View>
        )}
      </QueryView>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  chips: {
    marginHorizontal: -t.spacing.gutter,
  },
  stack: {
    gap: t.spacing.xl,
  },
  group: {
    gap: t.spacing.sm,
  },
}));
