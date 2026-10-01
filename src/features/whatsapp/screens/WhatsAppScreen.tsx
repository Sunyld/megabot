import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { EmptyState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { conversationStatusMeta } from '@/constants/labels';
import { useConversations, useNow, useSetGroupMonitored, useWhatsAppConnection, useWhatsAppGroups } from '@/hooks';
import { errorMessage } from '@/services';
import { createStyles, useTheme } from '@/theme';
import type { Conversation } from '@/types';

import { previewText } from '../components/ChatBubble';
import { formatNumber, formatPercent, formatRelative, formatRelativeLong } from '@/utils/format';

function ConversationRow({ conversation, now, divider }: { conversation: Conversation; now: number; divider: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const last = conversation.messages.at(-1);
  const preview = last ? `${last.direction === 'out' ? 'Bot: ' : ''}${previewText(last.text.split('\n')[0])}` : '';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/whatsapp/[id]', params: { id: conversation.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Conversa com ${conversation.customerName}. ${preview}`}
      style={({ pressed }) => [styles.conversation, divider && styles.divider, pressed && { backgroundColor: colors.surfacePressed }]}>
      <Avatar name={conversation.customerName} size={44} />
      <View style={styles.flex}>
        <View style={styles.convHead}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {conversation.customerName}
          </Text>
          <Text variant="caption" color={conversation.unread ? 'success' : 'muted'}>
            {formatRelative(conversation.lastMessageAt, now)}
          </Text>
        </View>
        <Text variant="callout" color="secondary" numberOfLines={1}>
          {preview}
        </Text>
        <View style={styles.convMeta}>
          {conversation.status === 'needs_human' ? (
            <StatusBadge meta={conversationStatusMeta.needs_human} size="sm" />
          ) : (
            <Text variant="caption" color="muted" numberOfLines={1} style={styles.flex}>
              {[conversation.groupName, conversation.orderCode].filter(Boolean).join(' · ')}
            </Text>
          )}
          {conversation.unread > 0 && (
            <View style={styles.unread}>
              <Text variant="captionStrong" colorValue="#FFFFFF" style={styles.unreadText}>
                {conversation.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function WhatsAppScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const now = useNow();
  const connection = useWhatsAppConnection();
  const groups = useWhatsAppGroups();
  const conversations = useConversations();
  const setMonitored = useSetGroupMonitored();
  const [sessionOpen, setSessionOpen] = useState(false);

  const refresh = () => {
    void connection.refetch();
    void groups.refetch();
    void conversations.refetch();
  };

  const toggleGroup = async (id: string, monitored: boolean) => {
    try {
      await setMonitored.mutateAsync({ id, monitored });
      toast.success(monitored ? 'Grupo monitorizado' : 'Grupo ignorado', monitored ? 'O MegaBot passa a responder neste grupo.' : 'O MegaBot deixa de responder neste grupo.');
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
    }
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={connection.isRefreshing}
      onRefresh={refresh}
      header={<StackHeader title="WhatsApp" subtitle="Atendimento automático" />}>
      <QueryView
        query={connection}
        loading={
          <View style={styles.stack}>
            <Skeleton height={150} radius={16} />
            <Skeleton height={190} radius={16} />
          </View>
        }>
        {(c) => (
          <Animated.View entering={FadeInDown.duration(260)} style={styles.stack}>
            <Card style={styles.connection} onPress={() => setSessionOpen(true)} accessibilityLabel="Detalhes da sessão WhatsApp">
              <View style={styles.connHead}>
                <View style={[styles.waIcon, { backgroundColor: colors.tones.success.solid }]}>
                  <Icon name="whatsapp" size={26} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <View style={styles.row}>
                    <StatusDot tone={c.status === 'connected' ? 'success' : 'warning'} pulse={c.status === 'connected'} />
                    <Text variant="title3" color={c.status === 'connected' ? 'success' : 'warning'}>
                      {c.status === 'connected' ? 'Conectado' : 'A ligar…'}
                    </Text>
                  </View>
                  <Text variant="bodyStrong" tabular>
                    {c.phone}
                  </Text>
                  <Text variant="caption" color="muted">
                    {`${c.displayName} · ligado ${formatRelativeLong(c.connectedSince, now)}`}
                  </Text>
                </View>
                <Icon name="chevronRight" size={20} color={colors.textMuted} />
              </View>
            </Card>

            <View style={styles.grid}>
              <View style={styles.gridRow}>
                <StatCard label="Grupos" value={formatNumber(c.groupsMonitored)} icon="groups" tone="info" caption="Monitorados" />
                <StatCard label="Mensagens" value={formatNumber(c.messagesProcessed)} icon="chat" tone="neutral" caption="Processadas · 7 dias" />
              </View>
              <View style={styles.gridRow}>
                <StatCard label="Pedidos" value={formatNumber(c.ordersCreated)} icon="orders" tone="success" caption="Criados · 7 dias" />
                <StatCard label="Automação" value={formatPercent(c.automationRate)} icon="bot" tone="ai" caption="Resolvidas pelo bot" />
              </View>
            </View>
          </Animated.View>
        )}
      </QueryView>

      <Section title="Conversas recentes" subtitle="Toque para ver a conversa e as intenções detetadas">
        <QueryView
          query={conversations}
          loading={<Skeleton height={260} radius={16} />}
          isEmpty={(list) => list.length === 0}
          empty={
            <Card>
              <EmptyState compact icon="chat" title="Sem conversas" description="As conversas com clientes aparecem aqui." />
            </Card>
          }>
          {(list) => (
            <ListGroup>
              {list.map((conversation, index) => (
                <ConversationRow key={conversation.id} conversation={conversation} now={now} divider={index < list.length - 1} />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>

      <Section title="Grupos">
        <QueryView
          query={groups}
          loading={<Skeleton height={220} radius={16} />}
          isEmpty={(list) => list.length === 0}
          empty={
            <Card>
              <EmptyState compact icon="groups" title="Sem grupos" description="Adicione o número do bot a um grupo de vendas." />
            </Card>
          }>
          {(list) => (
            <ListGroup>
              {list.map((group, index) => (
                <ListItem
                  key={group.id}
                  leading={<Avatar name={group.name} icon="groups" size={36} shape="rounded" tone={group.monitored ? 'success' : 'neutral'} />}
                  title={group.name}
                  subtitle={`${group.members} membros · ${group.ordersToday} pedidos hoje`}
                  divider={index < list.length - 1}
                  trailing={
                    <Switch
                      value={group.monitored}
                      onValueChange={(value) => void toggleGroup(group.id, value)}
                      accessibilityLabel={`Monitorizar ${group.name}`}
                    />
                  }
                />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>

      <View style={styles.note}>
        <Icon name="ai" size={16} color={colors.tones.ai.fg} />
        <Text variant="caption" color="secondary" style={styles.flex}>
          A IA interpreta as mensagens e deteta intenções. Pedidos e pagamentos são sempre decididos por regras do sistema.
        </Text>
      </View>

      <BottomSheet
        visible={sessionOpen}
        onClose={() => setSessionOpen(false)}
        title="Sessão WhatsApp"
        subtitle="Gateway dedicado, fora do telemóvel"
        footer={
          <Button
            label="Desligar sessão"
            icon="logout"
            variant="danger"
            fullWidth
            onPress={() => {
              setSessionOpen(false);
              toast.show({ title: 'Ação protegida', description: 'Desligar o WhatsApp fica disponível com o gateway real.', icon: 'lock' });
            }}
          />
        }>
        {connection.data && (
          <View>
            <KeyValue label="Número" value={connection.data.phone} />
            <KeyValue label="Nome" value={connection.data.displayName} />
            <KeyValue label="Ligado" value={formatRelativeLong(connection.data.connectedSince, now)} />
            <KeyValue label="Último evento" value={formatRelative(connection.data.lastEventAt, now)} last />
          </View>
        )}
      </BottomSheet>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  stack: {
    gap: t.spacing.lg,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  connection: {
    gap: t.spacing.md,
  },
  connHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  waIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    gap: t.spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  conversation: {
    flexDirection: 'row',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  convHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  convMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginTop: 4,
  },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tones.success.solid,
    marginLeft: 'auto',
  },
  unreadText: {
    fontSize: 11,
  },
  note: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.ai.bg,
  },
}));
