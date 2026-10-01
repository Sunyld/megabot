import { router } from 'expo-router';
import { useState } from 'react';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { ListItem } from '@/components/ui/ListItem';
import { ListGroup, Section } from '@/components/ui/Section';
import { Text } from '@/components/ui/Text';

import { SignOutDialog } from '../components/SignOutDialog';
import { settingsGroups } from '../sections';

export function SettingsScreen() {
  const [signOutOpen, setSignOutOpen] = useState(false);

  return (
    <Screen edges={['top', 'bottom']} header={<StackHeader title="Definições" />}>
      {settingsGroups.map((group) => (
        <Section key={group.title} title={group.title}>
          <ListGroup>
            {group.entries.map((entry, index) => (
              <ListItem
                key={entry.key}
                icon={entry.icon}
                iconTone={entry.tone}
                title={entry.title}
                subtitle={entry.subtitle}
                chevron
                divider={index < group.entries.length - 1}
                onPress={() => router.push(entry.href)}
              />
            ))}
          </ListGroup>
        </Section>
      ))}

      <ListGroup>
        <ListItem icon="logout" title="Terminar sessão" destructive onPress={() => setSignOutOpen(true)} />
      </ListGroup>

      <Text variant="caption" color="muted" align="center">
        MegaBot 1.0.0 (1) · Expo SDK 57
      </Text>

      <SignOutDialog visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </Screen>
  );
}
