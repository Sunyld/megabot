import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, hitSlop, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type SectionProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}>;

export function Section({ title, subtitle, action, right, children, style }: SectionProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.section, style]}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text variant="title3" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
        {action && (
          <Pressable onPress={action.onPress} hitSlop={hitSlop} accessibilityRole="button" style={styles.action}>
            <Text variant="calloutStrong" color="brand">
              {action.label}
            </Text>
            <Icon name="chevronRight" size={16} color={colors.tones.brand.fg} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/** Grouped container for list rows (settings-style). */
export function ListGroup({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const styles = useStyles();
  return <View style={[styles.group, style]}>{children}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const styles = useStyles();
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

const useStyles = createStyles((t) => ({
  section: {
    gap: t.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    opacity: 0.95,
  },
  group: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: t.colors.border,
  },
}));
