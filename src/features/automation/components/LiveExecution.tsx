import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Timeline, type TimelineItem } from '@/components/ui/Timeline';
import { createStyles } from '@/theme';

type ScriptStep = Omit<TimelineItem, 'state' | 'key'> & { outcome: 'done' | 'failed' };

/**
 * Scripted replay of TASK #92831 — the failover scenario from the product
 * brief — so sellers can see how the dispatcher reasons, step by step.
 */
const script: ScriptStep[] = [
  { title: 'Pagamento confirmado', description: 'PP…i58382 · 30 MT · regras OK', outcome: 'done' },
  { title: 'Device Principal · SIM 1', description: 'Indisponível — ocupado com outra ativação', outcome: 'failed' },
  { title: 'Device Principal · SIM 2', description: 'Indisponível — ocupado com outra ativação', outcome: 'failed' },
  { title: 'Worker 02 · SIM 1 selecionado', description: 'Failover automático · 4/10 ativações hoje', outcome: 'done', icon: 'failover' },
  { title: 'USSD executado', description: '*123*1250*840745232#', outcome: 'done', icon: 'ussd' },
  { title: 'Pacote ativado', description: '1250 MB → 84 074 5232 · cliente notificado', outcome: 'done', icon: 'bolt' },
];

const STEP_MS = 900;

export function LiveExecution() {
  const styles = useStyles();
  /** Number of completed steps; `script.length` = finished. */
  const [progress, setProgress] = useState(script.length);
  const running = progress < script.length;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setProgress((p) => p + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [progress, running]);

  const items: TimelineItem[] = script.map((step, index) => ({
    key: `${index}`,
    title: step.title,
    description: index <= progress ? step.description : undefined,
    icon: step.icon,
    state: index < progress ? (step.outcome === 'failed' ? 'failed' : 'done') : index === progress ? 'current' : 'pending',
  }));

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="mono">TASK #92831</Text>
          <Text variant="caption" color="muted">
            1250 MB · 30 MT · 84 074 5232
          </Text>
        </View>
        <Badge
          label={running ? 'A executar' : 'Sucesso'}
          tone={running ? 'info' : 'success'}
          icon={running ? 'sync' : 'checkCircle'}
          size="sm"
        />
      </View>
      <Timeline key={running ? 'running' : 'done'} items={items} animated={false} />
      <Button
        label={running ? 'A simular…' : 'Simular execução'}
        icon="play"
        variant="secondary"
        disabled={running}
        fullWidth
        onPress={() => setProgress(0)}
      />
    </Card>
  );
}

const useStyles = createStyles((t) => ({
  card: {
    gap: t.spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  flex: {
    flex: 1,
  },
}));
