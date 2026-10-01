import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Text } from '@/components/ui/Text';
import { createStyles, type IconName, type Tone, useTheme } from '@/theme';

/** Small product vignettes built from real UI primitives (no bitmap assets). */

function Frame({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.frame}>
      {children}
    </View>
  );
}

function Bubble({ text, out, mono }: { text: string; out?: boolean; mono?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
      <Text variant={mono ? 'monoSmall' : 'callout'}>{text}</Text>
    </View>
  );
}

export function SellIllustration() {
  const styles = useStyles();
  return (
    <Frame>
      <View style={styles.chat}>
        <Bubble text="tabela" />
        <Bubble out mono text={'💠 1024 MB → 24 MT\n💠 1250 MB → 30 MT\n💠 2048 MB → 45 MT'} />
        <Bubble text="1250" />
        <View style={[styles.bubble, styles.bubbleOut, styles.row]}>
          <Icon name="orders" size={16} />
          <Text variant="calloutStrong">Pedido ORD-92831 criado</Text>
        </View>
      </View>
    </Frame>
  );
}

function Check({ label }: { label: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Icon name="checkCircle" size={18} color={colors.tones.success.solid} />
      <Text variant="callout" color="secondary">
        {label}
      </Text>
    </View>
  );
}

export function ConfirmIllustration() {
  const styles = useStyles();
  return (
    <Frame>
      <View style={styles.card}>
        <View style={styles.spread}>
          <Text variant="overline" color="muted">
            Pagamento
          </Text>
          <Badge label="Confirmado" tone="success" icon="checkCircle" size="sm" />
        </View>
        <Text variant="hero" style={styles.amount}>
          30 MT
        </Text>
        <Text variant="monoSmall" color="secondary">
          PP260929.1938.i58382
        </Text>
        <View style={styles.divider} />
        <Check label="ID da transação coincide" />
        <Check label="Valor igual ao pedido" />
        <Check label="Conta de destino correta" />
      </View>
    </Frame>
  );
}

function Step({ icon, label, tone, last }: { icon: IconName; label: string; tone: Tone; last?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={[styles.stepNode, { backgroundColor: colors.tones[tone].bg }]}>
          <Icon name={icon} size={16} color={colors.tones[tone].fg} />
        </View>
        {!last && <View style={styles.stepLine} />}
      </View>
      <Text variant="calloutStrong" style={styles.stepLabel}>
        {label}
      </Text>
    </View>
  );
}

export function ActivateIllustration() {
  const styles = useStyles();
  return (
    <Frame>
      <View style={styles.card}>
        <Step icon="checkCircle" label="Pagamento confirmado" tone="success" />
        <Step icon="dispatcher" label="Worker 02 · SIM 1" tone="info" />
        <Step icon="ussd" label="USSD executado" tone="info" />
        <Step icon="bolt" label="1250 MB ativado ✓" tone="success" last />
      </View>
    </Frame>
  );
}

function DeviceTile({ name, online, battery }: { name: string; online: boolean; battery: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Icon name="devices" size={22} color={online ? colors.text : colors.textMuted} />
      <Text variant="captionStrong" numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.row}>
        <StatusDot tone={online ? 'success' : 'neutral'} pulse={online} size={7} />
        <Text variant="caption" color="secondary">
          {online ? battery : 'Offline'}
        </Text>
      </View>
    </View>
  );
}

export function DevicesIllustration() {
  const styles = useStyles();
  return (
    <Frame>
      <View style={styles.grid}>
        <DeviceTile name="Principal" online battery="78%" />
        <DeviceTile name="Worker 02" online battery="64%" />
        <DeviceTile name="Worker 03" online={false} battery="" />
        <DeviceTile name="Worker 04" online battery="92%" />
      </View>
    </Frame>
  );
}

const useStyles = createStyles((t) => ({
  frame: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing.xl,
  },
  chat: {
    width: '92%',
    gap: t.spacing.sm,
    padding: t.spacing.lg,
    borderRadius: t.radius.xl,
    backgroundColor: t.colors.chat.wallpaper,
    ...t.shadows.md,
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  bubbleIn: {
    alignSelf: 'flex-start',
    backgroundColor: t.colors.chat.incoming,
  },
  bubbleOut: {
    alignSelf: 'flex-end',
    backgroundColor: t.colors.chat.outgoing,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    width: '92%',
    gap: t.spacing.sm,
    padding: t.spacing.xl,
    borderRadius: t.radius.xl,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadows.md,
  },
  amount: {
    marginTop: t.spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: t.colors.border,
    marginVertical: t.spacing.xs,
  },
  step: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  stepRail: {
    alignItems: 'center',
  },
  stepNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLine: {
    width: 2,
    height: 14,
    backgroundColor: t.colors.border,
  },
  stepLabel: {
    paddingTop: 6,
  },
  grid: {
    width: '92%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.md,
  },
  tile: {
    width: '47%',
    flexGrow: 1,
    gap: t.spacing.xs,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadows.md,
  },
}));
