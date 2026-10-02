import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { deviceStatusMeta, taskStatusMeta } from '@/constants/labels';
import { usePlatformTenantActivationTasks, usePlatformTenantDevices } from '@/hooks';
import { isDeviceOnline, resultCodeText } from '@/services/activationRules';
import { createStyles } from '@/theme';
import type { DeviceRecord, PlatformTenant } from '@/types';
import { formatRelative } from '@/utils/format';

const deviceStatus = (device: DeviceRecord) =>
  device.status === 'UNREGISTERED' ? 'unregistered' : device.status === 'DISABLED' ? 'paused' : isDeviceOnline(device) ? 'online' : 'offline';

/**
 * Platform view of one tenant's activation engine: read-only, through the
 * explicit platform RPCs (permission tenants.read) — never the tenant tables.
 */
function Content({ tenant }: { tenant: PlatformTenant }) {
  const styles = useStyles();
  const devices = usePlatformTenantDevices(tenant.id);
  const tasks = usePlatformTenantActivationTasks(tenant.id);

  return (
    <View style={styles.stack}>
      <Section title="Dispositivos">
        <QueryView
          query={devices}
          loading={<SkeletonList count={2} lines={2} />}
          isEmpty={(list) => list.length === 0}
          empty={<EmptyState compact icon="devices" title="Sem dispositivos" description="Esta empresa ainda não emparelhou nenhum telemóvel." />}>
          {(list) => (
            <ListGroup>
              {list.map((device, index) => (
                <ListItem
                  key={device.id}
                  icon="devices"
                  title={device.name}
                  subtitle={[device.appVersion ? `App ${device.appVersion}` : null, device.lastSeenAt ? `visto ${formatRelative(device.lastSeenAt)}` : 'nunca ligado']
                    .filter(Boolean)
                    .join(' · ')}
                  trailing={<StatusBadge meta={deviceStatusMeta[deviceStatus(device)]} size="sm" />}
                  divider={index < list.length - 1}
                />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>

      <Section title="Tarefas de ativação" subtitle="As 100 mais recentes">
        <QueryView
          query={tasks}
          loading={<SkeletonList count={3} lines={2} />}
          isEmpty={(list) => list.length === 0}
          empty={<EmptyState compact icon="bolt" title="Sem tarefas" description="Nenhum pedido pago desta empresa chegou à ativação." />}>
          {(list) => (
            <>
              <Text variant="caption" color="muted">
                {(['QUEUED', 'EXECUTING', 'SUCCESS', 'FAILED', 'UNKNOWN'] as const)
                  .map((status) => `${taskStatusMeta[status].label}: ${list.filter((t) => t.status === status).length}`)
                  .join(' · ')}
              </Text>
              <ListGroup>
                {list.slice(0, 20).map((task, index, shown) => (
                  <ListItem
                    key={task.id}
                    icon="bolt"
                    iconTone={taskStatusMeta[task.status].tone}
                    title={`${task.operator} · tentativa ${task.attemptCount}/${task.maxAttempts}`}
                    subtitle={[resultCodeText(task.resultCode), formatRelative(task.createdAt)].filter(Boolean).join(' · ')}
                    trailing={<StatusBadge meta={taskStatusMeta[task.status]} size="sm" />}
                    divider={index < shown.length - 1}
                  />
                ))}
              </ListGroup>
            </>
          )}
        </QueryView>
      </Section>
    </View>
  );
}

export function TenantActivationSheet({ tenant, onClose }: { tenant: PlatformTenant | null; onClose: () => void }) {
  return (
    <BottomSheet
      visible={tenant !== null}
      onClose={onClose}
      title={tenant?.name ?? ''}
      subtitle="Motor de ativação · só leitura"
      footer={<Button label="Fechar" variant="secondary" fullWidth onPress={onClose} />}>
      {tenant && <Content tenant={tenant} />}
    </BottomSheet>
  );
}

const useStyles = createStyles((t) => ({
  stack: {
    gap: t.spacing.xl,
  },
}));
