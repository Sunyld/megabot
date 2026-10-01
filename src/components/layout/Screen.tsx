import type { PropsWithChildren, ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createStyles, useTheme } from '@/theme';

import { ConnectivityBanner } from './ConnectivityBanner';

export type ScreenProps = PropsWithChildren<{
  /** Fixed header rendered above the scroll area. */
  header?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal gutter + vertical rhythm on the content. */
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Screens inside the tab navigator don't need the bottom safe area. */
  edges?: ('top' | 'bottom')[];
  footer?: ReactNode;
}>;

export function Screen({
  header,
  scroll = true,
  refreshing = false,
  onRefresh,
  padded = true,
  contentStyle,
  edges = ['top'],
  footer,
  children,
}: ScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {header}
      <ConnectivityBanner />
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[padded && styles.padded, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.brand}
                colors={[colors.brand]}
                progressBackgroundColor={colors.surface}
              />
            ) : undefined
          }>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padded && styles.padded, contentStyle]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.xxxl,
    gap: t.spacing.xxl,
  },
}));
