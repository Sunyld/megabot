import { useDeferredValue, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectivityBanner } from '@/components/layout/ConnectivityBanner';
import { ScreenHeader } from '@/components/layout/Headers';
import { ChipGroup } from '@/components/ui/Chips';
import { SearchInput } from '@/components/ui/Input';
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { paymentFilterOptions } from '@/constants/labels';
import { useNow, usePayments, usePaymentsSummary } from '@/hooks';
import { createStyles, useTheme } from '@/theme';
import type { PaymentFilter } from '@/types';
import { formatMoney, formatNumber } from '@/utils/format';

import { PaymentCard } from '../components/PaymentCard';

function SummaryGrid({ onSelect }: { onSelect: (filter: PaymentFilter) => void }) {
  const styles = useStyles();
  const summary = usePaymentsSummary();
  const s = summary.data;

  if (!s) {
    return (
      <View style={styles.grid}>
        {[0, 1].map((row) => (
          <View key={row} style={styles.gridRow}>
            <Skeleton height={86} radius={16} style={styles.flex} />
            <Skeleton height={86} radius={16} style={styles.flex} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      <View style={styles.gridRow}>
        <StatCard label="Recebidos" value={formatNumber(s.received)} icon="receipt" tone="neutral" onPress={() => onSelect('all')} />
        <StatCard
          label="Confirmados"
          value={formatNumber(s.confirmed)}
          icon="checkCircle"
          tone="success"
          caption={formatMoney(s.confirmedAmount)}
          onPress={() => onSelect('confirmed')}
        />
      </View>
      <View style={styles.gridRow}>
        <StatCard label="Pendentes" value={formatNumber(s.pending)} icon="pending" tone="info" onPress={() => onSelect('pending')} />
        <StatCard
          label="Revisão"
          value={formatNumber(s.review)}
          icon="warning"
          tone="warning"
          caption={s.review ? 'Requer a sua decisão' : 'Nada por rever'}
          onPress={() => onSelect('review')}
        />
      </View>
    </View>
  );
}

export function PaymentsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const now = useNow();
  const [filter, setFilter] = useState<PaymentFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const payments = usePayments({ filter, search: deferredSearch || undefined });
  const summary = usePaymentsSummary();

  const refresh = () => {
    void payments.refetch();
    void summary.refetch();
  };

  const renderEmpty = () => {
    if (payments.isLoading) return <SkeletonList count={3} lines={3} />;
    if (payments.isError) return <ErrorState error={payments.error} onRetry={refresh} />;
    if (deferredSearch) {
      return <EmptyState icon="search" title="Sem resultados" description="Pesquise pelo ID da transação, pedido ou nome do pagador." />;
    }
    return (
      <EmptyState
        icon="payments"
        title="Sem pagamentos"
        description="Os comprovativos enviados pelos clientes e as mensagens da carteira aparecem aqui."
      />
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <FlatList
        data={payments.data ?? []}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PaymentCard payment={item} now={now} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title="Pagamentos" subtitle="Reconciliados pelo ID da transação" />
            <ConnectivityBanner />
            <View style={styles.padded}>
              <Text variant="overline" color="muted">
                Pagamentos hoje
              </Text>
              <SummaryGrid onSelect={setFilter} />
              <SearchInput value={search} onChangeText={setSearch} placeholder="ID da transação, pedido ou pagador" />
            </View>
            <ChipGroup options={paymentFilterOptions} value={filter} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={<View style={styles.padded}>{renderEmpty()}</View>}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={payments.isRefreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
        style={payments.isPlaceholder ? styles.stale : undefined}
      />
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  header: {
    gap: t.spacing.md,
    paddingBottom: t.spacing.lg,
    marginHorizontal: -t.spacing.gutter,
  },
  padded: {
    paddingHorizontal: t.spacing.gutter,
    gap: t.spacing.md,
  },
  list: {
    paddingHorizontal: t.spacing.gutter,
    paddingBottom: t.spacing.xxxl,
    flexGrow: 1,
  },
  grid: {
    gap: t.spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  flex: {
    flex: 1,
  },
  separator: {
    height: t.spacing.md,
  },
  stale: {
    opacity: 0.6,
  },
}));
