import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { errorMessage } from '@/services';
import { AUTH_RULES, isValidNewPassword } from '@/services/authValidation';
import { createStyles, useTheme } from '@/theme';

import { AuthScaffold } from '../components/AuthScaffold';
import { useSession } from '../session';

/** Supabase redirect parameters (fragment or query) that this screen can handle. */
const RECOVERY_PARAMS = /[#?&](access_token|code|error|error_code)=/;

type Phase = 'verifying' | 'form' | 'invalid';

/**
 * Opened by the link in the reset email (megabot://reset-password#…):
 * exchanges the link for a temporary recovery session, then sets the new
 * password. The rest of the app stays locked until the password is saved.
 */
export function ResetPasswordScreen() {
  const url = Linking.useLinkingURL();
  const { startPasswordRecovery, completePasswordRecovery, cancelPasswordRecovery } = useSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const hasLink = Boolean(url && RECOVERY_PARAMS.test(url));

  const [phase, setPhase] = useState<Phase>(hasLink ? 'verifying' : 'invalid');
  const [linkError, setLinkError] = useState<string | null>(hasLink ? null : 'Abra este ecrã a partir do link enviado por email.');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!url || !RECOVERY_PARAMS.test(url) || started.current === url) return;
    started.current = url;
    startPasswordRecovery(url)
      .then(() => setPhase('form'))
      .catch((e: unknown) => {
        setLinkError(errorMessage(e));
        setPhase('invalid');
      });
  }, [url, startPasswordRecovery]);

  const save = async () => {
    if (saving) return;
    const errors: typeof fieldErrors = {};
    if (!isValidNewPassword(password)) errors.password = `Mínimo de ${AUTH_RULES.passwordMin} caracteres.`;
    if (confirm !== password) errors.confirm = 'As palavras-passe não coincidem.';
    setFieldErrors(errors);
    setError(null);
    if (errors.password || errors.confirm) return;

    setSaving(true);
    try {
      await completePasswordRecovery(password);
      toast.success('Palavra-passe atualizada', 'Já pode usar a nova palavra-passe.');
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  if (phase === 'verifying') {
    return (
      <AuthScaffold title="A validar o link…" description="Um momento, estamos a confirmar o seu pedido.">
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </AuthScaffold>
    );
  }

  if (phase === 'invalid') {
    return (
      <AuthScaffold
        title="Link inválido"
        description={linkError ?? 'O link de recuperação é inválido ou expirou.'}
        footer={<Button label="Voltar ao login" variant="ghost" fullWidth onPress={() => router.replace('/login')} />}>
        <Button label="Pedir novo link" size="lg" fullWidth onPress={() => router.replace('/forgot-password')} />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Nova palavra-passe"
      description="Escolha uma palavra-passe nova para a sua conta."
      error={error}
      footer={
        <Button label="Cancelar" variant="ghost" fullWidth disabled={saving} onPress={() => void cancelPasswordRecovery()} />
      }>
      <Input
        label="Nova palavra-passe"
        icon="lock"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
        secureToggle
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`Pelo menos ${AUTH_RULES.passwordMin} caracteres.`}
        error={fieldErrors.password}
      />
      <Input
        label="Confirmar palavra-passe"
        icon="lock"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="••••••••"
        secureTextEntry
        secureToggle
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void save()}
        error={fieldErrors.confirm}
      />
      <Button label="Guardar palavra-passe" size="lg" fullWidth loading={saving} disabled={saving} onPress={() => void save()} />
    </AuthScaffold>
  );
}

const useStyles = createStyles((t) => ({
  center: {
    alignItems: 'center',
    paddingVertical: t.spacing.xxxl,
  },
}));
