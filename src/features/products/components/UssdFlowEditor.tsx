import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FilterChip, SegmentedControl } from '@/components/ui/Chips';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { USSD_INPUT_SOURCES, USSD_RULES, USSD_STEP_TYPES } from '@/services/ussdFlow';
import { createStyles, useTheme } from '@/theme';
import type { UssdStepType } from '@/types';
import { ussdSourceLabels, ussdStepTypeLabels } from '@/utils/ussd';

import { newStep, type ProductDraft, type ProductFormErrors, type UssdStepDraft } from '../productForm';

type UssdDraft = Pick<ProductDraft, 'ussdStart' | 'ussdSteps' | 'successTexts' | 'failureTexts'>;

const stepTypeOptions = USSD_STEP_TYPES.map((value) => ({ value, label: ussdStepTypeLabels[value] }));

const HINTS: Record<UssdStepType, string> = {
  select: 'Envia a opção escolhida no menu da operadora.',
  input: 'Escreve um valor conhecido na hora da venda.',
  confirm: 'Confirma a operação (envia "1" se ficar vazio).',
  wait: 'Aguarda antes do passo seguinte.',
};

/**
 * Structured editor for a product's USSD flow: start code + ordered steps
 * (option / input / confirm / wait) + optional success / failure texts.
 * Labels and expected texts already in a flow are kept untouched.
 */
export function UssdFlowEditor({
  draft,
  errors,
  onChange,
}: {
  draft: UssdDraft;
  errors: ProductFormErrors;
  onChange: (patch: Partial<UssdDraft>) => void;
}) {
  const styles = useStyles();
  const steps = draft.ussdSteps;

  const setStep = (index: number, patch: Partial<UssdStepDraft>) =>
    onChange({ ussdSteps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ussdSteps: next });
  };

  return (
    <View style={styles.editor}>
      <Input
        label="Código USSD inicial"
        icon="ussd"
        value={draft.ussdStart}
        onChangeText={(ussdStart) => onChange({ ussdStart })}
        placeholder="*111#"
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoCorrect={false}
        hint="O código que abre o menu da operadora para este pacote."
        error={errors.ussdStart}
      />

      <View style={styles.steps}>
        <Text variant="calloutStrong" color="secondary">
          {`Passos (${steps.length}/${USSD_RULES.maxSteps})`}
        </Text>
        {steps.map((step, index) => (
          <StepCard
            key={step.key}
            index={index}
            step={step}
            error={errors.steps?.[index]}
            first={index === 0}
            last={index === steps.length - 1}
            onChange={(patch) => setStep(index, patch)}
            onMove={(offset) => move(index, offset)}
            onRemove={() => onChange({ ussdSteps: steps.filter((_, i) => i !== index) })}
          />
        ))}
        <Button
          label="Adicionar passo"
          icon="add"
          variant="outline"
          size="sm"
          disabled={steps.length >= USSD_RULES.maxSteps}
          onPress={() => onChange({ ussdSteps: [...steps, newStep('select')] })}
        />
      </View>

      <Input
        label="Texto de sucesso (opcional)"
        icon="checkCircle"
        value={draft.successTexts}
        onChangeText={(successTexts) => onChange({ successTexts })}
        placeholder="sucesso"
        autoCapitalize="none"
        hint="Se a resposta final contiver este texto, a ativação conta como concluída. Separe vários com ;"
      />
      <Input
        label="Texto de falha (opcional)"
        icon="error"
        value={draft.failureTexts}
        onChangeText={(failureTexts) => onChange({ failureTexts })}
        placeholder="saldo insuficiente"
        autoCapitalize="none"
        hint="Textos que indicam que a operação falhou. Separe vários com ;"
      />
      {errors.ussd ? <ErrorLine message={errors.ussd} /> : null}
    </View>
  );
}

function StepCard({
  index,
  step,
  error,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  step: UssdStepDraft;
  error?: string;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<UssdStepDraft>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <Card padding={12} style={[styles.card, error ? { borderColor: colors.tones.danger.solid } : null]}>
      <View style={styles.cardHeader}>
        <View style={styles.badge}>
          <Text variant="captionStrong" color="brand">
            {index + 1}
          </Text>
        </View>
        <Text variant="calloutStrong" style={styles.flex} numberOfLines={1}>
          {step.label || ussdStepTypeLabels[step.type]}
        </Text>
        <IconButton
          icon="chevronDown"
          size={32}
          accessibilityLabel={`Subir passo ${index + 1}`}
          disabled={first}
          onPress={() => onMove(-1)}
          style={styles.up}
        />
        <IconButton
          icon="chevronDown"
          size={32}
          accessibilityLabel={`Descer passo ${index + 1}`}
          disabled={last}
          onPress={() => onMove(1)}
        />
        <IconButton
          icon="delete"
          size={32}
          iconColor={colors.tones.danger.fg}
          accessibilityLabel={`Remover passo ${index + 1}`}
          onPress={onRemove}
        />
      </View>

      <SegmentedControl options={stepTypeOptions} value={step.type} onChange={(type) => onChange({ type })} />

      {step.type === 'select' && (
        <Input
          label="Opção do menu"
          value={step.value}
          onChangeText={(value) => onChange({ value })}
          placeholder="5"
          keyboardType="phone-pad"
        />
      )}
      {step.type === 'input' && (
        <View style={styles.sources}>
          {USSD_INPUT_SOURCES.map((source) => (
            <FilterChip
              key={source}
              label={ussdSourceLabels[source]}
              selected={step.source === source}
              onPress={() => onChange({ source })}
            />
          ))}
        </View>
      )}
      {step.type === 'confirm' && (
        <Input
          label="Valor de confirmação"
          value={step.value}
          onChangeText={(value) => onChange({ value })}
          placeholder="1"
          keyboardType="phone-pad"
        />
      )}
      {step.type === 'wait' && (
        <Input
          label="Segundos"
          value={step.seconds}
          onChangeText={(seconds) => onChange({ seconds })}
          placeholder="2"
          keyboardType="decimal-pad"
        />
      )}

      {error ? <ErrorLine message={error} /> : <Text variant="caption" color="muted">{HINTS[step.type]}</Text>}
    </Card>
  );
}

function ErrorLine({ message }: { message: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Icon name="error" size={14} color={colors.tones.danger.fg} />
      <Text variant="caption" color="danger" style={styles.flex}>
        {message}
      </Text>
    </View>
  );
}

const useStyles = createStyles((t) => ({
  editor: {
    gap: t.spacing.lg,
  },
  steps: {
    gap: t.spacing.md,
  },
  card: {
    gap: t.spacing.md,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tones.brand.bg,
    marginRight: t.spacing.xs,
  },
  up: {
    transform: [{ rotate: '180deg' }],
  },
  sources: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  flex: {
    flex: 1,
  },
}));
