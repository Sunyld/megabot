import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useConnectivity } from '@/hooks/useConnectivity';
import { createStyles, useTheme } from '@/theme';

/** Slim banner shown on every screen while the device is offline. */
export function ConnectivityBanner() {
  const { isOnline } = useConnectivity();
  const { colors } = useTheme();
  const styles = useStyles();

  if (isOnline) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={styles.banner}
      accessibilityRole="alert">
      <Icon name="wifiOff" size={16} color={colors.textInverse} />
      <Text variant="captionStrong" color="inverse" style={styles.text} numberOfLines={1}>
        Sem ligação · a mostrar os últimos dados
      </Text>
    </Animated.View>
  );
}

const useStyles = createStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginHorizontal: t.spacing.gutter,
    marginBottom: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceInverse,
  },
  text: {
    flex: 1,
  },
}));
