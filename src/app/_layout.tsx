import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { ICON_FONT } from '@/components/ui/Icon';
import { ToastHost } from '@/components/ui/Toast';
import { AppSplash } from '@/features/auth/components/AppSplash';
import { SessionProvider, useSession } from '@/features/auth/session';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { invalidateQueries } from '@/lib/query';
import { simulationStore } from '@/services/mock';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const { colors, isDark } = theme;
  const { status, hasOnboarded } = useSession();
  const [fontsLoaded, fontError] = useFonts({ [ICON_FONT.name]: ICON_FONT.font });

  const fontsReady = fontsLoaded || Boolean(fontError);
  const ready = fontsReady && status !== 'restoring';
  const signedIn = status === 'signedIn';
  const inAuthFlow = status === 'signedOut' || status === 'restoring';

  useRealtimeSync();

  // Simulation switches (offline, errors, empty data) refresh everything on screen.
  useEffect(() => simulationStore.subscribe(() => invalidateQueries()), []);

  useEffect(() => {
    // The JS splash (same color + mark) takes over from the native one.
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      primary: colors.brand,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.brand,
    },
  };

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar style={!ready || isDark ? 'light' : 'dark'} />
        {/* The navigator renders from the first frame; <AppSplash /> covers it until ready. */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}>
          <Stack.Protected guard={inAuthFlow && !hasOnboarded}>
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={inAuthFlow}>
            <Stack.Screen name="login" options={{ animation: 'fade' }} />
            <Stack.Screen name="register" />
            <Stack.Screen name="forgot-password" />
          </Stack.Protected>
          {/* Opened from the reset email; stays reachable while the recovery session is active. */}
          <Stack.Protected guard={inAuthFlow || status === 'recovering'}>
            <Stack.Screen name="reset-password" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'suspended'}>
            <Stack.Screen name="suspended" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="orders/[id]" />
            <Stack.Screen name="payments/[id]" />
            <Stack.Screen name="devices/[id]" />
            <Stack.Screen name="sims" />
            <Stack.Screen name="products/index" />
            <Stack.Screen name="products/new" />
            <Stack.Screen name="products/[id]" />
            <Stack.Screen name="whatsapp/index" />
            <Stack.Screen name="whatsapp/[id]" />
            <Stack.Screen name="automation" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="settings/index" />
            <Stack.Screen name="settings/[section]" />
          </Stack.Protected>
        </Stack>
        <ToastHost />
        <AppSplash ready={ready} />
      </View>
    </NavigationThemeProvider>
  );
}
