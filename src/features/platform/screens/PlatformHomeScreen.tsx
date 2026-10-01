import { useState } from 'react';
import { View } from 'react-native';

import { ScreenHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { platformPermissionLabels, platformRoleLabels, tenantStatusMeta } from '@/constants/labels';
import { usePlatformSession } from '@/features/auth/session';
import { SignOutDialog } from '@/features/settings/components/SignOutDialog';
import { usePlatformTenants } from '@/hooks';
import { hasPlatformPermission } from '@/services';
import { createStyles } from '@/theme';

/**
 * Platform area shell (MegaBot staff). Opens for ACTIVE platform admins, with
 * or without a tenant. Read-only for now: the full administration area comes
 * in a later phase; every action is authorized again by the database.
 */
export function PlatformHomeScreen() {
  const styles = useStyles();
  const { user, platformAdmin } = usePlatformSession();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const canReadTenants = hasPlatformPermission(platformAdmin, 'tenants.read');
  const tenants = usePlatformTenants({}, { enabled: canReadTenants });
  const roleLabel = platformAdmin.role ? platformRoleLabels[platformAdmin.role] : 'Administração';

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={tenants.isRefreshing}
      onRefresh={canReadTenants ? () => void tenants.refetch() : undefined}
      header={
        <ScreenHeader
          title="Plataforma"
          subtitle="Administração do MegaBot"
          right={<IconButton icon="logout" accessibilityLabel="Terminar sessão" onPress={() => setSignOutOpen(true)} />}
        />
      }>
      <Card style={styles.profile}>
        <View style={styles.identity}>
          <Avatar name={user.name} size={48} />
          <View style={styles.flex}>
            <Text variant="title3" numberOfLines={1}>
              {user.name}
            </Text>
            <Text variant="callout" color="secondary" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>
        <View style={styles.badges}>
          <Badge label={roleLabel} tone="brand" icon="shield" />
          <Badge label="Ativo" tone="success" icon="checkCircle" />
          <Badge label="Sem empresa associada" tone="neutral" />
        </View>
      </Card>

      <Section title="Permissões" subtitle="Calculadas pelo servidor a partir do seu papel.">
        <View style={styles.badges}>
          {platformAdmin.permissions.map((permission) => (
            <Badge key={permission} label={platformPermissionLabels[permission]} tone="info" size="sm" />
          ))}
        </View>
      </Section>

      <Section title="Empresas" subtitle="Vista só de leitura — a gestão completa chega numa próxima fase.">
        {canReadTenants ? (
          <QueryView
            query={tenants}
            loading={<SkeletonList count={3} lines={2} />}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState icon="business" title="Ainda sem empresas" description="As empresas registadas no MegaBot aparecem aqui." />}>
            {(data) => (
              <ListGroup>
                {data.map((tenant, index) => (
                  <ListItem
                    key={tenant.id}
                    icon="business"
                    iconTone={tenant.status === 'active' ? 'brand' : 'neutral'}
                    title={tenant.name}
                    subtitle={`${tenant.slug} · ${tenant.members.total} ${tenant.members.total === 1 ? 'membro' : 'membros'}`}
                    trailing={<StatusBadge meta={tenantStatusMeta[tenant.status]} size="sm" />}
                    divider={index < data.length - 1}
                  />
                ))}
              </ListGroup>
            )}
          </QueryView>
        ) : (
          <EmptyState icon="lock" title="Sem permissão" description="O seu papel não inclui a consulta de empresas." compact />
        )}
      </Section>

      <Button label="Terminar sessão" icon="logout" variant="secondary" fullWidth onPress={() => setSignOutOpen(true)} />

      <SignOutDialog visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  profile: {
    gap: t.spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
}));
