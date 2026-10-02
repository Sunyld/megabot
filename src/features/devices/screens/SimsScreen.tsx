import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { ChipGroup } from '@/components/ui/Chips';
import { QueryView } from '@/components/ui/QueryView';
import { SkeletonList } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { useSims } from '@/hooks';
import { createStyles } from '@/theme';
import type { Sim } from '@/types';

import { SimCard } from '../components/SimCard';
import { SimSheet } from '../components/SimSheet';

type SimFilter = 'all' | 'available' | 'limit' | 'unavailable';

const matches = (sim: Sim, filter: SimFilter) => {
  if (filter === 'available') return sim.status === 'available';
  if (filter === 'limit') return sim.status === 'limit_reached';
  if (filter === 'unavailable') return ['offline', 'paused', 'error', 'unavailable'].includes(sim.status);
  return true;
};

export function SimsScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const styles = useStyles();
  const sims = useSims();
  const [filter, setFilter] = useState<SimFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null);

  const list = sims.data ?? [];
  const selected = list.find((s) => s.id === selectedId) ?? null;
  const activationSims = list.filter((s) => !(s.status === 'paused' && s.paymentWallet));
  const used = activationSims.reduce((sum, s) => sum + s.activationsToday, 0);
  const limit = activationSims.reduce((sum, s) => sum + (s.dailyLimit ?? 0), 0);

  const options = [
    { value: 'all' as const, label: 'Todos', count: list.length },
    { value: 'available' as const, label: 'Disponíveis', count: list.filter((s) => matches(s, 'available')).length },
    { value: 'limit' as const, label: 'Limite', count: list.filter((s) => matches(s, 'limit')).length },
    { value: 'unavailable' as const, label: 'Indisponíveis', count: list.filter((s) => matches(s, 'unavailable')).length },
  ];

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={sims.isRefreshing}
      onRefresh={() => void sims.refetch()}
      header={<StackHeader title="SIMs" subtitle="Rotação, limites e pagamentos" />}>
      {sims.data && (
        <View style={styles.grid}>
          <StatCard label="Disponíveis" value={`${options[1].count}/${list.length}`} icon="sim" tone="success" />
          <StatCard label="Ativações hoje" value={limit ? `${used}/${limit}` : `${used}`} icon="bolt" tone="info" />
        </View>
      )}

      <View style={styles.chips}>
        <ChipGroup options={options} value={filter} onChange={setFilter} />
      </View>

      <QueryView
        query={sims}
        loading={<SkeletonList count={4} lines={3} />}
        isEmpty={(data) => data.filter((s) => matches(s, filter)).length === 0}
        empty={<EmptyState icon="sim" title="Nenhum SIM nesta vista" description="Altere o filtro para ver outros SIMs." />}>
        {(data) => (
          <View style={styles.list}>
            {data
              .filter((s) => matches(s, filter))
              .map((sim, index) => (
                <Animated.View key={sim.id} entering={FadeInDown.delay(index * 40).duration(240)}>
                  <SimCard sim={sim} showDevice onPress={() => setSelectedId(sim.id)} />
                </Animated.View>
              ))}
          </View>
        )}
      </QueryView>

      <Text variant="caption" color="muted" align="center">
        O dispatcher só usa SIMs ativos da rede do pacote, num telemóvel online e livre — nunca dois trabalhos no mesmo SIM.
      </Text>

      <SimSheet sim={selected} onClose={() => setSelectedId(null)} />
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  grid: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  chips: {
    marginHorizontal: -t.spacing.gutter,
  },
  list: {
    gap: t.spacing.md,
  },
}));
