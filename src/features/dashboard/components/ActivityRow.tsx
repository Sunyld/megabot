import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { notificationKindIcon, severityTone } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { NotificationKind, Severity } from '@/types';

export type ActivityRowProps = {
  kind: NotificationKind;
  severity: Severity;
  title: string;
  description?: string;
  meta?: string;
  unread?: boolean;
  onPress?: () => void;
  divider?: boolean;
};

/** Shared row for activity feeds and the notification center. */
export function ActivityRow({ kind, severity, title, description, meta, unread, onPress, divider }: ActivityRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tone = colors.tones[severityTone[severity]];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}. ${description ?? ''}. ${meta ?? ''}`}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && { backgroundColor: colors.surfacePressed }]}>
      <View style={[styles.well, { backgroundColor: tone.bg }]}>
        <Icon name={notificationKindIcon[kind]} size={18} color={tone.fg} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant={unread ? 'bodyStrong' : 'bodyMedium'} numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {meta ? (
            <Text variant="caption" color="muted">
              {meta}
            </Text>
          ) : null}
        </View>
        {description ? (
          <Text variant="callout" color="secondary" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {unread && <View style={styles.unread} accessibilityLabel="Não lida" />}
    </Pressable>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  well: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  title: {
    flex: 1,
  },
  unread: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: t.colors.brand,
  },
}));
