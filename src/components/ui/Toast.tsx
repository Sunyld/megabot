import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createStore } from '@/lib/store';
import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

type ToastMessage = { id: number; title: string; description?: string; tone: Tone; icon: IconName };

const store = createStore<ToastMessage | null>(null);
let seq = 0;

const defaultIcon: Partial<Record<Tone, IconName>> = {
  success: 'checkCircle',
  danger: 'error',
  warning: 'warning',
  info: 'info',
};

/** Fire-and-forget feedback, callable from anywhere (components, hooks). */
export const toast = {
  show({ title, description, tone = 'neutral', icon }: { title: string; description?: string; tone?: Tone; icon?: IconName }) {
    store.set({ id: ++seq, title, description, tone, icon: icon ?? defaultIcon[tone] ?? 'info' });
  },
  success(title: string, description?: string) {
    toast.show({ title, description, tone: 'success' });
  },
  error(title: string, description?: string) {
    toast.show({ title, description, tone: 'danger' });
  },
};

/** Mount once near the root. Sits above the tab bar. */
export function ToastHost({ bottomOffset = 88 }: { bottomOffset?: number }) {
  const message = store.useStore();
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => store.set(null), 2800);
    return () => clearTimeout(id);
  }, [message]);

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + bottomOffset }]}>
      {message && (
        <Animated.View
          key={message.id}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(180)}
          style={styles.toast}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          <Icon name={message.icon} size={20} color={message.tone === 'neutral' ? colors.textInverse : colors.tones[message.tone].solid} />
          <View style={styles.texts}>
            <Text variant="calloutStrong" color="inverse">
              {message.title}
            </Text>
            {message.description ? (
              <Text variant="caption" colorValue={colors.textMuted}>
                {message.description}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  host: {
    position: 'absolute',
    left: t.spacing.gutter,
    right: t.spacing.gutter,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    maxWidth: 460,
    alignSelf: 'stretch',
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceInverse,
    ...t.shadows.lg,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
}));
