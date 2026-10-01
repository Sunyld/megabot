import type { ReactNode } from 'react';
import { View } from 'react-native';

import { createStyles } from '@/theme';

import { Text } from './Text';

export type KeyValueProps = {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: ReactNode;
  last?: boolean;
};

/** Label / value row used in detail cards. Long values wrap instead of overflowing. */
export function KeyValue({ label, value, mono, children, last }: KeyValueProps) {
  const styles = useStyles();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text variant="callout" color="secondary" style={styles.label}>
        {label}
      </Text>
      <View style={styles.valueWrap}>
        {children ?? (
          <Text variant={mono ? 'mono' : 'calloutStrong'} align="right" selectable>
            {value ?? '—'}
          </Text>
        )}
      </View>
    </View>
  );
}

const useStyles = createStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
    paddingVertical: t.spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  label: {
    flexShrink: 0,
    maxWidth: '45%',
  },
  valueWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
}));
