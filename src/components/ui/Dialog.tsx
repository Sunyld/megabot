import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { usePresence } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export type DialogProps = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  icon?: IconName;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  confirmVariant?: 'primary' | 'danger' | 'success';
  loading?: boolean;
  confirmDisabled?: boolean;
}>;

/** Confirmation modal for consequential actions (approve, reject, cancel…). */
export function Dialog({
  visible,
  onClose,
  title,
  message,
  icon,
  tone = 'brand',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  confirmVariant = 'primary',
  loading,
  confirmDisabled,
  children,
}: DialogProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const mounted = usePresence(visible);

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        {visible && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(200)} style={styles.backdrop}>
            <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Fechar" />
          </Animated.View>
        )}
        {visible && (
          <Animated.View entering={ZoomIn.duration(200)} exiting={FadeOut.duration(160)} style={styles.card} accessibilityViewIsModal>
            {icon && (
              <View style={[styles.well, { backgroundColor: colors.tones[tone].bg }]}>
                <Icon name={icon} size={26} color={colors.tones[tone].fg} />
              </View>
            )}
            <Text variant="title2" align="center" accessibilityRole="header">
              {title}
            </Text>
            {message ? (
              <Text variant="callout" color="secondary" align="center">
                {message}
              </Text>
            ) : null}
            {children}
            <View style={styles.actions}>
              <Button label={cancelLabel} variant="secondary" onPress={onClose} style={styles.action} disabled={loading} />
              {onConfirm && (
                <Button
                  label={confirmLabel}
                  variant={confirmVariant}
                  onPress={onConfirm}
                  loading={loading}
                  disabled={confirmDisabled}
                  style={styles.action}
                />
              )}
            </View>
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xxl,
  },
  backdrop: {
    ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    backgroundColor: t.colors.overlay,
  },
  fill: {
    flex: 1,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.xl,
    padding: t.spacing.xxl,
    gap: t.spacing.md,
    alignItems: 'stretch',
    ...t.shadows.lg,
  },
  well: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
  action: {
    flex: 1,
  },
}));
