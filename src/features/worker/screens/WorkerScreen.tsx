import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { ListGroup, Section } from '@/components/ui/Section';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { errorMessage } from '@/services';
import { normalizePairingCode } from '@/services/activationRules';
import { createStyles, useTheme } from '@/theme';
import { formatRelative, formatTime } from '@/utils/format';

import { workerPlatformSupported } from '../instance';
import { useWorker } from '../useWorker';

/**
 * Worker mode: this phone executes activation tasks. Kept apart from the
 * normal screens. It shows exactly what the phone can and cannot do — no
 * simulated success outside mock mode.
 */
export function WorkerScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { state, runtime } = useWorker();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const caps = state.capabilities;
  const canExecute = !!caps?.ussd && !!caps.ussdInteractive;

  const pair = async () => {
    if (!normalizePairingCode(code)) {
      setCodeError('Código inválido: 8 caracteres, por exemplo ABCD-EF23.');
      return;
    }
    setPairing(true);
    try {
      await runtime.pair(code);
      setCode('');
      toast.success('Telemóvel emparelhado', 'Registe os SIMs deste telemóvel no painel e inicie o worker.');
    } catch (e) {
      toast.error('Não foi possível emparelhar', errorMessage(e));
    } finally {
      setPairing(false);
    }
  };

  if (!workerPlatformSupported) {
    return (
      <Screen edges={['top', 'bottom']} header={<StackHeader title="Modo worker" />}>
        <EmptyState
          icon="devices"
          title="Disponível só em Android"
          description="O worker executa USSD com um SIM físico. Abra o MegaBot num telemóvel Android para o emparelhar."
        />
      </Screen>
    );
  }

  const footer =
    state.phase === 'stopped' ? (
      <View style={styles.footer}>
        <Button label="Iniciar worker" icon="play" fullWidth onPress={() => runtime.start()} />
      </View>
    ) : state.phase === 'running' ? (
      <View style={styles.footer}>
        <Button label="Parar worker" icon="pause" variant="secondary" fullWidth onPress={() => runtime.stop()} />
      </View>
    ) : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Screen edges={['top', 'bottom']} header={<StackHeader title="Modo worker" subtitle={state.device?.name ?? 'Este telemóvel executa as ativações'} />} footer={footer}>
        <Card style={styles.card}>
          <View style={styles.row}>
            <Icon name="ussd" size={22} color={canExecute ? colors.tones.success.fg : colors.tones.warning.fg} />
            <Text variant="bodyStrong" style={styles.flex}>
              {canExecute ? 'USSD disponível neste telemóvel' : 'USSD indisponível neste telemóvel'}
            </Text>
            <Badge label={state.executor === 'mock' ? 'Simulado' : 'Android'} tone={state.executor === 'mock' ? 'ai' : 'info'} size="sm" />
          </View>
          <Text variant="callout" color="secondary">
            {caps?.reason ??
              (canExecute
                ? 'Os menus USSD dos produtos são executados no SIM indicado pelo servidor.'
                : 'Sem USSD interativo o servidor não entrega tarefas a este telemóvel.')}
          </Text>
          {state.executor === 'mock' && (
            <Text variant="caption" color="muted">
              Modo de demonstração: as respostas da operadora são simuladas e nada chega ao Supabase.
            </Text>
          )}
        </Card>

        {state.phase === 'unpaired' && (
          <Section title="Emparelhar este telemóvel" subtitle="O dono ou administrador gera o código em Dispositivos › +">
            <Input
              label="Código de emparelhamento"
              icon="link"
              value={code}
              onChangeText={(value) => {
                setCode(value.toUpperCase());
                setCodeError(null);
              }}
              placeholder="ABCD-EF23"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              error={codeError}
              hint="Válido 15 minutos, uma única vez."
            />
            <Button label="Emparelhar" icon="link" loading={pairing} onPress={() => void pair()} />
          </Section>
        )}

        {state.device && (
          <Section title="Estado">
            <Card>
              <KeyValue label="Dispositivo" value={state.device.name} />
              <KeyValue label="Worker" value={state.phase === 'running' ? 'A correr' : 'Parado'} />
              <KeyValue label="Último sinal" value={state.lastHeartbeatAt ? `${formatRelative(state.lastHeartbeatAt)} (${formatTime(state.lastHeartbeatAt, true)})` : '—'} />
              <KeyValue label="Tarefa em curso" value={state.currentTaskId ? state.currentTaskId.slice(0, 8) : 'Nenhuma'} mono />
              <KeyValue label="Resultados por enviar" value={String(state.pendingReports)} last />
            </Card>
            {state.lastError && (
              <Text variant="caption" color="danger">
                {state.lastError}
              </Text>
            )}
            <Text variant="caption" color="muted">
              O worker corre enquanto a app está aberta. Para correr em segundo plano é preciso um serviço Android em primeiro plano (próximo passo).
            </Text>
          </Section>
        )}

        {state.log.length > 0 && (
          <Section title="Atividade">
            <ListGroup>
              {state.log.slice(0, 15).map((entry, index, shown) => (
                <ListItem
                  key={entry.id}
                  icon={entry.tone === 'success' ? 'checkCircle' : entry.tone === 'danger' ? 'error' : entry.tone === 'warning' ? 'warning' : 'info'}
                  iconTone={entry.tone === 'info' ? 'neutral' : entry.tone}
                  title={entry.message}
                  subtitle={formatTime(entry.at, true)}
                  divider={index < shown.length - 1}
                />
              ))}
            </ListGroup>
          </Section>
        )}

        {state.device && (
          <ListGroup>
            <ListItem
              icon="logout"
              title="Esquecer emparelhamento neste telemóvel"
              subtitle="Para voltar a usar, gere um novo código no painel."
              destructive
              onPress={() => void runtime.unpair()}
            />
          </ListGroup>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  card: {
    gap: t.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  footer: {
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.background,
  },
}));
