import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ScreenHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListItem } from '@/components/ui/ListItem';
import { ListGroup, Section } from '@/components/ui/Section';
import { Text } from '@/components/ui/Text';
import { planLabels } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useUnreadCount } from '@/hooks';
import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

import { SignOutDialog } from '../components/SignOutDialog';

type Shortcut = { key: string; label: string; caption: string; icon: IconName; tone: Tone; href: Href; badge?: number };

export function MoreScreen() {
  const { user, tenant } = useCurrentSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const unread = useUnreadCount();
  const [signOutOpen, setSignOutOpen] = useState(false);

  const shortcuts: Shortcut[] = [
    { key: 'products', label: 'Produtos', caption: 'Pacotes e preços', icon: 'product', tone: 'brand', href: '/products' },
    { key: 'sims', label: 'SIMs', caption: 'Limites e rotação', icon: 'sim', tone: 'info', href: '/sims' },
    { key: 'whatsapp', label: 'WhatsApp', caption: 'Conversas e grupos', icon: 'whatsapp', tone: 'success', href: '/whatsapp' },
    { key: 'automation', label: 'Automação', caption: 'Regras e tarefas', icon: 'bolt', tone: 'ai', href: '/automation' },
    { key: 'notifications', label: 'Notificações', caption: unread ? `${unread} por ler` : 'Tudo lido', icon: 'bell', tone: 'warning', href: '/notifications', badge: unread },
    { key: 'settings', label: 'Definições', caption: 'Conta e aplicação', icon: 'settings', tone: 'neutral', href: '/settings' },
  ];

  const rows: Shortcut[][] = [];
  for (let i = 0; i < shortcuts.length; i += 2) rows.push(shortcuts.slice(i, i + 2));

  return (
    <Screen header={<ScreenHeader title="Mais" />}>
      <Card
        onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'profile' } })}
        style={styles.profile}
        accessibilityLabel={`Perfil de ${user.name}`}>
        <Avatar name={user.name} size={56} />
        <View style={styles.flex}>
          <Text variant="title3" numberOfLines={1}>
            {user.name}
          </Text>
          <Text variant="callout" color="secondary" numberOfLines={1}>
            {user.email}
          </Text>
          <View style={styles.badges}>
            <Badge label={tenant.name} tone="brand" icon="business" size="sm" />
            {tenant.plan ? <Badge label={planLabels[tenant.plan]} tone="warning" icon="subscription" size="sm" /> : null}
          </View>
        </View>
        <Icon name="chevronRight" size={20} color={colors.textMuted} />
      </Card>

      <Section title="Operação">
        <View style={styles.grid}>
          {rows.map((row) => (
            <View key={row[0].key} style={styles.row}>
              {row.map((item) => (
                <Card key={item.key} padding={14} style={styles.tile} onPress={() => router.push(item.href)} accessibilityLabel={item.label}>
                  <View style={[styles.well, { backgroundColor: colors.tones[item.tone].bg }]}>
                    <Icon name={item.icon} size={22} color={colors.tones[item.tone].fg} />
                    {item.badge ? <View style={styles.dot} /> : null}
                  </View>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {item.caption}
                  </Text>
                </Card>
              ))}
            </View>
          ))}
        </View>
      </Section>

      <ListGroup>
        <ListItem icon="help" iconTone="info" title="Ajuda e suporte" chevron divider onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'help' } })} />
        <ListItem icon="logout" title="Terminar sessão" destructive onPress={() => setSignOutOpen(true)} />
      </ListGroup>

      <Text variant="caption" color="muted" align="center">
        MegaBot 1.0.0 · Fase 1 · dados simulados
      </Text>

      <SignOutDialog visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  grid: {
    gap: t.spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  tile: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  well: {
    width: 40,
    height: 40,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing.sm,
  },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.brand,
  },
}));
