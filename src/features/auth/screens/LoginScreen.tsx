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
import { api, errorMessage } from '@/services';
import { isValidEmail } from '@/services/authValidation';
import { createStyles, hitSlop, useTheme } from '@/theme';

import { useSession } from '../session';

const demoCredentials = api.auth.getDemoCredentials();

export function LoginScreen() {
  const { signIn } = useSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState<'form' | 'demo' | 'demoPlatform' | null>(null);
  // Guards against double taps before the disabled state renders.
  const submitting = useRef(false);

  const submit = async (credentials = { email, password }, mode: 'form' | 'demo' | 'demoPlatform' = 'form') => {
    if (submitting.current) return;
    const errors: typeof fieldErrors = {};
    if (!isValidEmail(credentials.email)) errors.email = 'Introduza um email válido.';
    if (credentials.password.length < 6) errors.password = 'Mínimo de 6 caracteres.';
    setFieldErrors(errors);
    setError(null);
    if (errors.email || errors.password) return;

    submitting.current = true;
    setLoading(mode);
    try {
      // Resolves once the context (tenant app or platform area) is loaded; the router then opens it.
      await signIn(credentials);
    } catch (e) {
      setError(errorMessage(e));
      setLoading(null);
    } finally {
      submitting.current = false;
    }
  };

  const signInWithDemo = (kind: 'tenant' | 'platform') => {
    if (!demoCredentials) return;
    const credentials = demoCredentials[kind];
    setEmail(credentials.email);
    setPassword(credentials.password);
    void submit(credentials, kind === 'tenant' ? 'demo' : 'demoPlatform');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeIn.duration(400)} style={styles.brand}>
            <BrandMark size={56} />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.heading}>
            <Text variant="title1">Bem-vindo de volta</Text>
            <Text variant="body" color="secondary">
              Entre para acompanhar vendas, pagamentos e ativações em tempo real.
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
              label="Email"
              icon="mail"
              value={email}
              onChangeText={setEmail}
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
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              secureToggle
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              error={fieldErrors.password}
            />
            <Pressable
              onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}
              hitSlop={hitSlop}
              style={styles.forgot}
              accessibilityRole="button">
              <Text variant="calloutStrong" color="brand">
                Esqueceu a palavra-passe?
              </Text>
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(360)} style={styles.actions}>
            <Button label="Entrar" size="lg" fullWidth loading={loading === 'form'} disabled={loading !== null} onPress={() => void submit()} />
            {demoCredentials && (
              <>
                <View style={styles.or}>
                  <View style={styles.line} />
                  <Text variant="caption" color="muted">
                    ou
                  </Text>
                  <View style={styles.line} />
                </View>
                <Button
                  label="Entrar com conta demo"
                  icon="bolt"
                  variant="outline"
                  size="lg"
                  fullWidth
                  loading={loading === 'demo'}
                  disabled={loading !== null}
                  onPress={() => signInWithDemo('tenant')}
                />
                <Button
                  label="Demo: administração da plataforma"
                  icon="shield"
                  variant="ghost"
                  fullWidth
                  loading={loading === 'demoPlatform'}
                  disabled={loading !== null}
                  onPress={() => signInWithDemo('platform')}
                />
              </>
            )}
            <View style={styles.switch}>
              <Text variant="callout" color="secondary">
                Ainda não tem conta?
              </Text>
              <Pressable onPress={() => router.push('/register')} hitSlop={hitSlop} accessibilityRole="button" disabled={loading !== null}>
                <Text variant="calloutStrong" color="brand">
                  Criar conta
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          <Text variant="caption" color="muted" align="center" style={styles.footer}>
            Ao continuar, aceita os Termos de Utilização e a Política de Privacidade do MegaBot.
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
  forgot: {
    alignSelf: 'flex-end',
  },
  actions: {
    gap: t.spacing.lg,
  },
  or: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: t.colors.border,
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
