import { Tabs } from 'expo-router/js-tabs';

import { AppTabBar } from '@/components/layout/AppTabBar';
import { usePaymentsSummary } from '@/hooks/usePayments';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  const review = usePaymentsSummary().data?.review;

  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        animation: 'shift',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="orders" options={{ title: 'Pedidos' }} />
      <Tabs.Screen name="payments" options={{ title: 'Pagamentos', tabBarBadge: review || undefined }} />
      <Tabs.Screen name="devices" options={{ title: 'Dispositivos' }} />
      <Tabs.Screen name="more" options={{ title: 'Mais' }} />
    </Tabs>
  );
}
