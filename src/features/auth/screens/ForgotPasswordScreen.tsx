import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { errorMessage } from '@/services';
import { isValidEmail } from '@/services/authValidation';
import { createStyles, useTheme } from '@/theme';

import { AuthScaffold } from '../components/AuthScaffold';
import { useSession } from '../session';

const back = () => (router.canGoBack() ? router.back() : router.replace('/login'));

export function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset } = useSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const [email, setEmail] = useState(params.email ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current) return;
    setError(null);
    if (!isValidEmail(email)) {
      setFieldError('Introduza um email válido.');
      return;
    }
    setFieldError(null);
    submitting.current = true;
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSentTo(email.trim());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  if (sentTo) {
    return (
      <AuthScaffold
        title="Verifique o seu email"
        description={`Se existir uma conta com ${sentTo}, enviámos um link para definir uma nova palavra-passe. Abra-o neste telemóvel.`}
        footer={<Button label="Voltar ao login" variant="secondary" size="lg" fullWidth onPress={back} />}>
        <View style={styles.note}>
          <Icon name="mail" size={20} color={colors.tones.info.fg} />
          <Text variant="callout" color="secondary" style={styles.flex}>
            O link expira ao fim de algum tempo. Não recebeu? Veja a pasta de spam ou peça outro link.
          </Text>
        </View>
        <Button label="Enviar outro link" variant="ghost" onPress={() => setSentTo(null)} />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Recuperar acesso"
      description="Indique o email da sua conta. Enviamos um link para criar uma nova palavra-passe."
      error={error}
      footer={<Button label="Voltar ao login" variant="ghost" fullWidth onPress={back} disabled={loading} />}>
      <Input
        label="Email"
        icon="mail"
        value={email}
        onChangeText={setEmail}
        placeholder="nome@empresa.co.mz"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        error={fieldError}
      />
      <Button label="Enviar link" size="lg" fullWidth loading={loading} disabled={loading} onPress={() => void submit()} />
    </AuthScaffold>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  note: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.info.bg,
  },
}));
