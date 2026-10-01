import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand/BrandMark';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { createStyles, useTheme } from '@/theme';

/**
 * Shared frame of the auth screens (same layout as Login/Register):
 * brand mark, heading, optional error banner, content.
 */
export function AuthScaffold({
  title,
  description,
  error,
  footer,
  children,
}: PropsWithChildren<{ title: string; description?: string; error?: string | null; footer?: ReactNode }>) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(400)} style={styles.brand}>
            <BrandMark size={56} />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.heading}>
            <Text variant="title1">{title}</Text>
            {description ? (
              <Text variant="body" color="secondary">
                {description}
              </Text>
            ) : null}
          </Animated.View>

          {error ? (
            <Animated.View entering={FadeInDown.duration(220)} style={styles.alert} accessibilityRole="alert">
              <Icon name="error" size={20} color={colors.tones.danger.fg} />
              <Text variant="callout" color="danger" style={styles.flex}>
                {error}
              </Text>
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.body}>
            {children}
          </Animated.View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: t.spacing.xxl,
    paddingTop: t.spacing.xxxl,
    paddingBottom: t.spacing.xxl,
    gap: t.spacing.xxl,
  },
  brand: {
    alignSelf: 'flex-start',
  },
  heading: {
    gap: t.spacing.sm,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.danger.bg,
  },
  body: {
    gap: t.spacing.lg,
  },
  footer: {
    marginTop: 'auto',
    gap: t.spacing.md,
  },
}));
