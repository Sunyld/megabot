import { View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { attemptResultMeta } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { TaskAttempt } from '@/types';
import { formatDuration, formatTime } from '@/utils/format';

/**
 * The dispatcher's decision trail: every device/SIM it tried, in order.
 * Makes failover visible ("SIM 1 indisponível → SIM 2 indisponível → Worker 02").
 */
export function TaskAttempts({ attempts }: { attempts: TaskAttempt[] }) {
  const { colors } = useTheme();
  const styles = useStyles();

  if (!attempts.length) {
    return (
      <View style={styles.empty}>
        <Icon name="queue" size={18} color={colors.textMuted} />
        <Text variant="callout" color="secondary">
          Na fila — a aguardar um dispositivo e SIM disponíveis.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <Text variant="overline" color="muted" style={styles.title}>
        Percurso do dispatcher
      </Text>
      {attempts.map((attempt, index) => {
        const meta = attemptResultMeta[attempt.result];
        const skipped = attempt.result.startsWith('skipped');
        return (
          <View key={attempt.id}>
            {index > 0 && (
              <View style={styles.connector}>
                <Icon name="failover" size={14} color={colors.textMuted} />
                <Text variant="caption" color="muted">
                  failover
                </Text>
              </View>
            )}
            <View style={[styles.attempt, skipped && styles.skipped]}>
              <View style={styles.device}>
                <Icon name="sim" size={18} color={skipped ? colors.textMuted : colors.text} />
                <View style={styles.flex}>
                  <Text variant="calloutStrong" numberOfLines={1}>
                    {`${attempt.deviceName} · SIM ${attempt.simSlot}`}
                  </Text>
                  <Text variant="caption" color="muted" numberOfLines={2}>
                    {[
                      formatTime(attempt.at, true),
                      attempt.durationMs ? formatDuration(attempt.durationMs / 1000) : null,
                      attempt.reason,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>
              <StatusBadge meta={meta} size="sm" />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  list: {
    marginTop: t.spacing.md,
  },
  title: {
    marginBottom: t.spacing.sm,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.md,
  },
  attempt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  skipped: {
    opacity: 0.75,
  },
  device: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  flex: {
    flex: 1,
  },
  connector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: t.spacing.lg,
    height: 26,
  },
}));
