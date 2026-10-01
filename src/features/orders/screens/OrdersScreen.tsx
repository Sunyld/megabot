import { useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectivityBanner } from '@/components/layout/ConnectivityBanner';
import { ScreenHeader } from '@/components/layout/Headers';
import { ChipGroup } from '@/components/ui/Chips';
import { SearchInput } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { orderFilterOptions } from '@/constants/labels';
import { useNow, useOrderCounts, useOrders } from '@/hooks';
import { createStyles, useTheme } from '@/theme';
import type { Order, OrderFilter } from '@/types';
import { formatDayLabel, formatMoney } from '@/utils/format';

import { OrderCard } from '../components/OrderCard';

const emptyCopy: Record<OrderFilter, { title: string; description: string }> = {
  all: { title: 'Ainda sem pedidos', description: 'Os pedidos criados pelo MegaBot no WhatsApp aparecem aqui.' },
  pending: { title: 'Nada pendente', description: 'Todos os clientes já enviaram número e pagamento.' },
  paid: { title: 'Sem pedidos na fila', description: 'Pagamentos confirmados são ativados em segundos.' },
  processing: { title: 'Nada em processamento', description: 'Não há ativações em curso neste momento.' },
  completed: { title: 'Sem pedidos concluídos', description: 'Os pacotes entregues aparecem aqui.' },
  failed: { title: 'Sem falhas 🎉', description: 'Nenhuma ativação precisou de intervenção.' },
};

function groupByDay(orders: Order[], now: number) {
  const sections: { title: string; total: number; data: Order[] }[] = [];
  for (const order of orders) {
    const title = formatDayLabel(order.createdAt, now);
    let section = sections.find((s) => s.title === title);
    if (!section) {
      section = { title, total: 0, data: [] };
      sections.push(section);
    }
    section.data.push(order);
    if (['completed', 'paid', 'processing', 'verifying', 'failed'].includes(order.status)) section.total += order.price;
  }
  return sections;
}

export function OrdersScreen() {
  const params = useLocalSearchParams<{ filter?: OrderFilter }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const now = useNow();

  const [filter, setFilter] = useState<OrderFilter>(params.filter ?? 'all');
  const [paramFilter, setParamFilter] = useState(params.filter);
  if (params.filter !== paramFilter) {
    // Deep links from the dashboard (e.g. "Pendentes") update the active filter.
    setParamFilter(params.filter);
    if (params.filter) setFilter(params.filter);
  }

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const orders = useOrders({ filter, search: deferredSearch || undefined });
  const counts = useOrderCounts();

  const options = orderFilterOptions.map((o) => ({ ...o, count: counts.data?.[o.value] }));
  const sections = orders.data ? groupByDay(orders.data, now) : [];

  const refresh = () => {
    void orders.refetch();
    void counts.refetch();
  };

  const renderEmpty = () => {
    if (orders.isLoading) return <SkeletonList count={4} lines={4} />;
    if (orders.isError) return <ErrorState error={orders.error} onRetry={refresh} />;
    if (deferredSearch) {
      return (
        <EmptyState
          icon="search"
          title="Sem resultados"
          description={`Nenhum pedido corresponde a “${deferredSearch}”. Pesquise por código, número ou ID de transação.`}
        />
      );
    }
    return <EmptyState icon="orders" {...emptyCopy[filter]} />;
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Pedidos"
        subtitle={counts.data ? `${counts.data.all} pedidos · ${counts.data.pending} pendentes` : 'A carregar…'}
      />
      <ConnectivityBanner />
      <View style={styles.controls}>
        <View style={styles.search}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Código, número ou ID de transação" />
        </View>
        <ChipGroup options={options} value={filter} onChange={setFilter} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(order) => order.id}
        renderItem={({ item }) => <OrderCard order={item} now={now} />}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <Text variant="overline" color="muted">
              {section.title}
            </Text>
            <Text variant="caption" color="muted">
              {`${section.data.length} pedidos · ${formatMoney(section.total)}`}
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        style={orders.isPlaceholder ? styles.stale : undefined}
      />
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  controls: {
    gap: t.spacing.md,
    paddingBottom: t.spacing.md,
  },
  search: {
    paddingHorizontal: t.spacing.gutter,
  },
  list: {
    paddingHorizontal: t.spacing.gutter,
    paddingBottom: t.spacing.xxxl,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
  },
  separator: {
    height: t.spacing.md,
  },
  stale: {
    opacity: 0.6,
  },
}));
