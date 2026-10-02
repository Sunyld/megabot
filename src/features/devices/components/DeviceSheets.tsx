import { useState } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/Chips';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { operatorLabels } from '@/constants/labels';
import { useCreateDevice, useRegisterSim } from '@/hooks';
import { errorMessage } from '@/services';
import { ACTIVATION_RULES, OPERATORS } from '@/services/activationRules';
import { normalizePhone } from '@/services/orderRules';
import { createStyles, useTheme } from '@/theme';
import type { DevicePairing, ID, Operator } from '@/types';
import { formatTime } from '@/utils/format';

const PAIRING_STEPS = [
  'No telemóvel Android que vai executar as ativações, abra o MegaBot e entre com uma conta desta empresa.',
  'Mais › Modo worker › Emparelhar este telemóvel.',
  'Introduza o código abaixo. Depois, registe aqui os SIMs desse telemóvel.',
];

/** The one-time code. It is shown only now; a new one can be generated on the device page. */
export function PairingCodeSheet({ pairing, deviceName, onClose }: { pairing: DevicePairing | null; deviceName?: string; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <BottomSheet
      visible={pairing !== null}
      onClose={onClose}
      title="Código de emparelhamento"
      subtitle={deviceName}
      footer={<Button label="Concluído" variant="secondary" fullWidth onPress={onClose} />}>
      {pairing && (
        <>
          <View style={styles.code}>
            <Text variant="title1" selectable style={styles.codeText}>
              {pairing.pairingCode}
            </Text>
            <Text variant="caption" color="muted">
              {`Válido até às ${formatTime(pairing.expiresAt)} · uma única utilização`}
            </Text>
          </View>
          {PAIRING_STEPS.map((step, index) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text variant="captionStrong" color="brand">
                  {index + 1}
                </Text>
              </View>
              <Text variant="callout" style={styles.flex}>
                {step}
              </Text>
            </View>
          ))}
          <View style={styles.note}>
            <Icon name="shield" size={16} color={colors.tones.info.fg} />
            <Text variant="caption" color="info" style={styles.flex}>
              O telemóvel recebe uma credencial própria. Gerar um novo código e emparelhar outra vez invalida a anterior.
            </Text>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

export function AddDeviceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const createDevice = useCreateDevice();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<DevicePairing | null>(null);

  const close = () => {
    setName('');
    setError(null);
    setPairing(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < ACTIVATION_RULES.deviceNameMin) {
      setError(`Indique um nome (mínimo ${ACTIVATION_RULES.deviceNameMin} caracteres).`);
      return;
    }
    try {
      setPairing(await createDevice.mutateAsync(trimmed));
    } catch (e) {
      toast.error('Não foi possível criar o dispositivo', errorMessage(e));
    }
  };

  if (pairing) return <PairingCodeSheet pairing={pairing} deviceName={name.trim()} onClose={close} />;

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Adicionar dispositivo"
      subtitle="Um telemóvel Android que executa as ativações USSD."
      footer={<Button label="Criar e gerar código" icon="link" fullWidth loading={createDevice.isPending} onPress={() => void submit()} />}>
      <Input
        label="Nome do dispositivo"
        icon="devices"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        placeholder="Ex.: Worker Loja Central"
        maxLength={ACTIVATION_RULES.deviceNameMax}
        error={error}
      />
    </BottomSheet>
  );
}

const SLOT_OPTIONS = [0, 1, 2, 3].map((index) => ({ value: String(index), label: `Slot ${index + 1}` }));

export function AddSimSheet({ deviceId, usedSlots, visible, onClose }: { deviceId: ID; usedSlots: number[]; visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const registerSim = useRegisterSim();
  const freeSlot = [0, 1, 2, 3].find((slot) => !usedSlots.includes(slot)) ?? 0;
  const [slot, setSlot] = useState(String(freeSlot));
  const [operator, setOperator] = useState<Operator>('vodacom');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const submit = async () => {
    if (phone.trim() && !normalizePhone(phone)) {
      setPhoneError('Número inválido. Use um número de Moçambique (ex.: 84 123 4567).');
      return;
    }
    try {
      await registerSim.mutateAsync({ deviceId, slotIndex: Number(slot), operator, phoneNumber: phone.trim() || null });
      toast.success('SIM registado', `${operatorLabels[operator]} · slot ${Number(slot) + 1}`);
      setPhone('');
      onClose();
    } catch (e) {
      toast.error('Não foi possível registar o SIM', errorMessage(e));
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Registar SIM"
      subtitle="A operadora é indicada por si — nunca deduzida do número."
      footer={<Button label="Registar SIM" icon="sim" fullWidth loading={registerSim.isPending} onPress={() => void submit()} />}>
      <View style={styles.field}>
        <Text variant="captionStrong" color="secondary">
          Slot no telemóvel
        </Text>
        <SegmentedControl options={SLOT_OPTIONS} value={slot} onChange={setSlot} />
        {usedSlots.includes(Number(slot)) && (
          <Text variant="caption" color="warning">
            Já existe um SIM registado neste slot.
          </Text>
        )}
      </View>
      <View style={styles.field}>
        <Text variant="captionStrong" color="secondary">
          Operadora (rede dos pacotes)
        </Text>
        <SegmentedControl options={OPERATORS.map((value) => ({ value, label: operatorLabels[value] }))} value={operator} onChange={setOperator} />
      </View>
      <Input
        label="Número do SIM (opcional)"
        icon="phone"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          setPhoneError(null);
        }}
        placeholder="84 123 4567"
        keyboardType="phone-pad"
        error={phoneError}
      />
    </BottomSheet>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  code: {
    alignItems: 'center',
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xl,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.borderStrong,
  },
  codeText: {
    letterSpacing: 4,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tones.brand.bg,
  },
  note: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.info.bg,
  },
  field: {
    gap: t.spacing.sm,
  },
}));
