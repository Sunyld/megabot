import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StackHeader } from '@/components/layout/Headers';
import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { conversationStatusMeta } from '@/constants/labels';
import { queryKeys, useConversation } from '@/hooks';
import { invalidateQueries } from '@/lib/query';
import { createStyles, useTheme } from '@/theme';
import type { ChatMessage } from '@/types';
import { formatDayLabel, formatPhone } from '@/utils/format';

import { ChatBubble } from '../components/ChatBubble';

const REPLAY_STEP_MS = 850;

export function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles();
  const conversation = useConversation(id);
  const scrollRef = useRef<ScrollView>(null);

  /** null = show everything; a number = replaying, showing that many messages. */
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [sent, setSent] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const c = conversation.data;
  const all = [...(c?.messages ?? []), ...sent];
  const shown = visibleCount === null ? all : all.slice(0, visibleCount);
  const replaying = visibleCount !== null;
  const loadedId = c?.id;

  useEffect(() => {
    // Opening a conversation marks it as read — refresh the unread badges.
    if (loadedId) invalidateQueries(queryKeys.whatsapp.conversations());
  }, [loadedId]);

  useEffect(() => {
    if (visibleCount === null) return;
    if (visibleCount >= all.length) {
      const done = setTimeout(() => setVisibleCount(null), REPLAY_STEP_MS);
      return () => clearTimeout(done);
    }
    const id = setTimeout(() => setVisibleCount((n) => (n === null ? null : n + 1)), REPLAY_STEP_MS);
    return () => clearTimeout(id);
  }, [visibleCount, all.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setSent((list) => [...list, { id: `local_${Date.now()}`, direction: 'out', text, at: new Date().toISOString() }]);
    setDraft('');
    toast.show({ title: 'Mensagem enviada', description: 'Resposta manual — o bot retoma depois.', tone: 'success', icon: 'send' });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StackHeader
        title={c?.customerName ?? 'Conversa'}
        subtitle={c ? [c.groupName, formatPhone(c.customerPhone)].filter(Boolean).join(' · ') : undefined}
        right={
          <IconButton
            icon={replaying ? 'pause' : 'play'}
            accessibilityLabel={replaying ? 'Parar reprodução' : 'Reproduzir conversa'}
            variant="tonal"
            disabled={!c}
            onPress={() => setVisibleCount(replaying ? null : 1)}
          />
        }
      />

      {c && (
        <View style={styles.meta}>
          <StatusBadge meta={conversationStatusMeta[c.status]} size="sm" />
          {c.orderId && (
            <Card
              variant="muted"
              padding={0}
              onPress={() => router.push({ pathname: '/orders/[id]', params: { id: c.orderId! } })}
              style={styles.orderChip}
              accessibilityLabel={`Abrir pedido ${c.orderCode}`}>
              <Icon name="orders" size={14} color={colors.textSecondary} />
              <Text variant="captionStrong" color="secondary">
                {`#${c.orderCode}`}
              </Text>
              <Icon name="chevronRight" size={14} color={colors.textMuted} />
            </Card>
          )}
        </View>
      )}

      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          style={[styles.flex, { backgroundColor: colors.chat.wallpaper }]}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: replaying })}>
          {conversation.isLoading && (
            <View style={styles.loading}>
              <Skeleton width="55%" height={40} radius={12} />
              <Skeleton width="70%" height={120} radius={12} style={styles.alignEnd} />
              <Skeleton width="40%" height={40} radius={12} />
            </View>
          )}
          {conversation.isError && !c && <ErrorState error={conversation.error} onRetry={conversation.refetch} />}
          {c && (
            <View style={styles.day}>
              <Text variant="captionStrong" color="secondary">
                {formatDayLabel(c.messages[0]?.at ?? c.lastMessageAt)}
              </Text>
            </View>
          )}
          {shown.map((message) => (
            <ChatBubble key={message.id} message={message} animated={replaying} />
          ))}
          {replaying && visibleCount !== null && visibleCount < all.length && (
            <View style={[styles.typing, all[visibleCount]?.direction === 'out' ? styles.alignEnd : null]}>
              <Text variant="caption" color="muted">
                {all[visibleCount]?.direction === 'out' ? 'MegaBot a escrever…' : 'Cliente a escrever…'}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Responder como vendedor…"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.brand}
            style={styles.input}
            multiline
            accessibilityLabel="Escrever mensagem"
          />
          <IconButton
            icon="send"
            accessibilityLabel="Enviar"
            variant="tonal"
            iconColor={draft.trim() ? colors.tones.success.fg : colors.textMuted}
            disabled={!draft.trim()}
            onPress={send}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.surface,
  },
  flex: {
    flex: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.gutter,
    paddingBottom: t.spacing.sm,
  },
  orderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: t.radius.pill,
  },
  messages: {
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  loading: {
    gap: t.spacing.md,
  },
  alignEnd: {
    alignSelf: 'flex-end',
  },
  day: {
    alignSelf: 'center',
    paddingHorizontal: t.spacing.md,
    paddingVertical: 4,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surface,
    marginBottom: t.spacing.xs,
  },
  typing: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing.md,
    paddingVertical: 6,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: t.spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: t.colors.surfaceMuted,
    color: t.colors.text,
    fontSize: 15,
  },
}));
