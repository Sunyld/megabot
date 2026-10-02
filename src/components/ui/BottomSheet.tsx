import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createStyles } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';
import { EXIT_MS, usePresence } from './usePresence';

export type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
  /** Scrollable body (default). Disable for short, fixed content. */
  scroll?: boolean;
}>;

export function BottomSheet({ visible, onClose, title, subtitle, footer, scroll = true, children }: BottomSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const mounted = usePresence(visible);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        {visible && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(EXIT_MS)} style={styles.backdrop}>
            <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Fechar" accessibilityRole="button" />
          </Animated.View>
        )}
        {visible && (
          <Animated.View
            entering={SlideInDown.duration(280)}
            exiting={SlideOutDown.duration(EXIT_MS)}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            accessibilityViewIsModal>
            <View style={styles.handle} />
            {(title || subtitle) && (
              <View style={styles.header}>
                <View style={styles.titles}>
                  {title ? (
                    <Text variant="title2" accessibilityRole="header">
                      {title}
                    </Text>
                  ) : null}
                  {subtitle ? (
                    <Text variant="callout" color="secondary">
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <IconButton icon="close" accessibilityLabel="Fechar" variant="tonal" size={36} onPress={onClose} />
              </View>
            )}
            {scroll ? (
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            ) : (
              <View style={styles.bodyContent}>{children}</View>
            )}
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    backgroundColor: t.colors.overlay,
  },
  fill: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: t.radius.xxl,
    borderTopRightRadius: t.radius.xxl,
    ...t.shadows.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: t.spacing.sm,
    backgroundColor: t.colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    gap: t.spacing.lg,
  },
  footer: {
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.sm,
    gap: t.spacing.sm,
  },
}));
