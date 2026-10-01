import { View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { intentLabels } from '@/constants/labels';
import { createStyles, useTheme } from '@/theme';
import type { ChatMessage } from '@/types';
import { formatTime } from '@/utils/format';

/** Renders WhatsApp inline formatting (*bold*). */
function formatted(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.length > 2 && part.startsWith('*') && part.endsWith('*') ? (
      <Text key={i} variant="calloutStrong">
        {part.slice(1, -1)}
      </Text>
    ) : (
      part
    )
  );
}

/** Plain-text preview of a WhatsApp message (formatting markers removed). */
export const previewText = (text: string) => text.replace(/\*([^*\n]+)\*/g, '$1');

/** WhatsApp-style bubble. Incoming messages show the AI-detected intent. */
export function ChatBubble({ message, animated }: { message: ChatMessage; animated?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const entering = animated ? FadeInUp.duration(260) : undefined;

  if (message.direction === 'system') {
    return (
      <Animated.View entering={entering} style={styles.system}>
        <Icon name="bot" size={14} color={colors.textSecondary} />
        <Text variant="caption" color="secondary" style={styles.systemText}>
          {message.text}
        </Text>
      </Animated.View>
    );
  }

  const out = message.direction === 'out';

  return (
    <Animated.View entering={entering} style={[styles.wrap, out ? styles.wrapOut : styles.wrapIn]}>
      <View style={[styles.bubble, { backgroundColor: out ? colors.chat.outgoing : colors.chat.incoming }]}>
        {out && (
          <View style={styles.botRow}>
            <Icon name="bot" size={12} color={colors.tones.success.fg} />
            <Text variant="captionStrong" color="success">
              MegaBot
            </Text>
          </View>
        )}
        <Text variant="callout" selectable>
          {formatted(message.text)}
        </Text>
        <Text variant="caption" colorValue={colors.chat.meta} style={styles.time}>
          {formatTime(message.at)}
        </Text>
      </View>
      {!out && message.intent && message.intent !== 'UNKNOWN' && (
        <Badge label={`${intentLabels[message.intent]} · ${message.intent}`} tone="ai" icon="ai" size="sm" style={styles.intent} />
      )}
    </Animated.View>
  );
}

const useStyles = createStyles((t) => ({
  wrap: {
    maxWidth: '86%',
    gap: 4,
  },
  wrapIn: {
    alignSelf: 'flex-start',
  },
  wrapOut: {
    alignSelf: 'flex-end',
  },
  bubble: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.sm,
    paddingBottom: 6,
    borderRadius: t.radius.md,
    boxShadow: '0px 1px 1px rgba(0,0,0,0.08)',
  },
  botRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  time: {
    alignSelf: 'flex-end',
    fontSize: 10,
    marginTop: 2,
  },
  intent: {
    marginLeft: 4,
  },
  system: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '90%',
    paddingHorizontal: t.spacing.md,
    paddingVertical: 6,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    opacity: 0.95,
  },
  systemText: {
    flexShrink: 1,
  },
}));
