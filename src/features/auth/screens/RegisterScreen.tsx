import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { errorMessage, isAppError, type AppErrorReason } from '@/services';
import { AUTH_RULES, validateSignUpForm, type SignUpField } from '@/services/authValidation';
import { createStyles, hitSlop, useTheme } from '@/theme';

import { useSession } from '../session';

/** Server-side causes that belong to a specific field rather than the banner. */
const FIELD_FOR_REASON: Partial<Record<AppErrorReason, SignUpField>> = {
  EMAIL_ALREADY_REGISTERED: 'email',
  INVALID_EMAIL: 'email',
  WEAK_PASSWORD: 'password',
  INVALID_BUSINESS_NAME: 'businessName',
};

export function RegisterScreen() {
  const { signUp } = useSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const [values, setValues] = useState<Record<SignUpField, string>>({
    name: '',
    businessName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignUpField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Guards against double taps before the disabled state renders.
  const submitting = useRef(false);

  const set = (field: SignUpField) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    if (submitting.current) return;
    const errors = validateSignUpForm(values);
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length) return;

    submitting.current = true;
    setLoading(true);
    try {
      // The confirmation stays on the device: only the password is sent.
      await signUp({
        name: values.name,
        businessName: values.businessName,
        email: values.email,
        password: values.password,
      });
    } catch (e) {
      const field = isAppError(e) && e.reason ? FIELD_FOR_REASON[e.reason] : undefined;
      if (field) setFieldErrors({ [field]: errorMessage(e) });
      else setError(errorMessage(e));
      setLoading(false);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(400)} style={styles.brand}>
            <BrandMark size={56} />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.heading}>
            <Text variant="title1">Criar conta</Text>
            <Text variant="body" color="secondary">
              Registe a sua loja e comece a vender com o MegaBot. Entra de imediato, sem confirmação por email.
            </Text>
          </Animated.View>

          {error && (
            <Animated.View entering={FadeInDown.duration(220)} style={styles.alert} accessibilityRole="alert">
              <Icon name="error" size={20} color={colors.tones.danger.fg} />
              <Text variant="callout" color="danger" style={styles.flex}>
                {error}
              </Text>
            </Animated.View>
          )}

          <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.form}>
            <Input
              label="O seu nome"
              icon="user"
              value={values.name}
              onChangeText={set('name')}
              placeholder="Carlos Mabunda"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              error={fieldErrors.name}
            />
            <Input
              label="Nome da loja"
              icon="business"
              value={values.businessName}
              onChangeText={set('businessName')}
              placeholder="ByteStore"
              autoComplete="organization"
              textContentType="organizationName"
              returnKeyType="next"
              hint="Aparece na tabela de preços enviada aos clientes."
              error={fieldErrors.businessName}
            />
            <Input
              label="Email"
              icon="mail"
              value={values.email}
              onChangeText={set('email')}
              placeholder="nome@empresa.co.mz"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              error={fieldErrors.email}
            />
            <Input
              label="Palavra-passe"
              icon="lock"
              value={values.password}
              onChangeText={set('password')}
              placeholder="••••••••"
              secureTextEntry
              secureToggle
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              hint={`Pelo menos ${AUTH_RULES.passwordMin} caracteres.`}
              error={fieldErrors.password}
            />
            <Input
              label="Confirmar palavra-passe"
              icon="lock"
              value={values.confirmPassword}
              onChangeText={set('confirmPassword')}
              placeholder="••••••••"
              secureTextEntry
              secureToggle
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              error={fieldErrors.confirmPassword}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(360)} style={styles.actions}>
            <Button label="Criar conta" size="lg" fullWidth loading={loading} disabled={loading} onPress={() => void submit()} />
            <View style={styles.switch}>
              <Text variant="callout" color="secondary">
                Já tem conta?
              </Text>
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
                hitSlop={hitSlop}
                accessibilityRole="button"
                disabled={loading}>
                <Text variant="calloutStrong" color="brand">
                  Entrar
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          <Text variant="caption" color="muted" align="center" style={styles.footer}>
            Ao criar conta, aceita os Termos de Utilização e a Política de Privacidade do MegaBot.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: t.spacing.xxl,
    paddingTop: t.spacing.xxxl,
    paddingBottom: t.spacing.xxl,
    gap: t.spacing.xxl,
  },
  brand: {
    alignSelf: 'flex-start',
  },
  heading: {
    gap: t.spacing.sm,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.danger.bg,
  },
  form: {
    gap: t.spacing.lg,
  },
  actions: {
    gap: t.spacing.lg,
  },
  switch: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  footer: {
    marginTop: 'auto',
  },
}));
