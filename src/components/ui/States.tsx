import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { errorMessage, isAppError } from '@/services/errors';
import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  description?: string;
  tone?: Tone;
  action?: { label: string; onPress: () => void; icon?: IconName };
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({ icon, title, description, tone = 'neutral', action, compact, style }: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.container, compact && styles.compact, style]}>
      <View style={[styles.well, { backgroundColor: colors.tones[tone].bg }]}>
        <Icon name={icon} size={28} color={colors.tones[tone].fg} />
      </View>
      <View style={styles.texts}>
        <Text variant="title3" align="center">
          {title}
        </Text>
        {description ? (
          <Text variant="callout" color="secondary" align="center">
            {description}
          </Text>
        ) : null}
      </View>
      {action && <Button label={action.label} icon={action.icon} onPress={action.onPress} variant="secondary" size="sm" />}
    </Animated.View>
  );
}

/** Error state. Detects offline errors and shows the offline variant. */
export function ErrorState({
  error,
  onRetry,
  compact,
  style,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const offline = isAppError(error) && error.code === 'NETWORK_ERROR';
  return (
    <EmptyState
      icon={offline ? 'cloudOff' : 'warning'}
      tone={offline ? 'neutral' : 'danger'}
      title={offline ? 'Está offline' : 'Algo correu mal'}
      description={offline ? 'Mostramos os dados assim que a ligação voltar.' : errorMessage(error)}
      action={onRetry ? { label: 'Tentar novamente', onPress: onRetry, icon: 'refresh' } : undefined}
      compact={compact}
      style={style}
    />
  );
}

const useStyles = createStyles((t) => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.lg,
    paddingVertical: t.spacing.huge,
    paddingHorizontal: t.spacing.xxl,
  },
  compact: {
    paddingVertical: t.spacing.xxl,
  },
  well: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    gap: t.spacing.xs,
    alignItems: 'center',
    maxWidth: 320,
  },
}));
