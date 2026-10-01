import { router } from 'expo-router';

import { Screen } from '@/components/layout/Screen';
import { EmptyState } from '@/components/ui/States';

export function NotFoundScreen() {
  return (
    <Screen scroll={false} edges={['top', 'bottom']} contentStyle={{ justifyContent: 'center' }}>
      <EmptyState
        icon="unknown"
        title="Página não encontrada"
        description="Este ecrã não existe ou foi movido."
        action={{ label: 'Ir para o início', icon: 'home', onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
