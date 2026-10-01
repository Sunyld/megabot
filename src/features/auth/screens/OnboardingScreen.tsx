import { router } from 'expo-router';
import { useState, type ComponentType } from 'react';
import { Pressable, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { createStyles, hitSlop, useTheme } from '@/theme';

import {
  ActivateIllustration,
  ConfirmIllustration,
  DevicesIllustration,
  SellIllustration,
} from '../components/OnboardingIllustrations';
import { useSession } from '../session';

const slides: { key: string; title: string; description: string; Illustration: ComponentType }[] = [
  {
    key: 'sell',
    title: 'Venda automaticamente',
    description: 'O MegaBot responde no WhatsApp, envia a tabela e cria pedidos por si — 24 horas por dia.',
    Illustration: SellIllustration,
  },
  {
    key: 'confirm',
    title: 'Confirme pagamentos',
    description: 'Cada comprovativo é validado pelo ID da transação contra a mensagem real da carteira.',
    Illustration: ConfirmIllustration,
  },
  {
    key: 'activate',
    title: 'Ative pacotes sozinho',
    description: 'Pagamento confirmado? O MegaBot escolhe um telemóvel, executa o USSD e avisa o cliente.',
    Illustration: ActivateIllustration,
  },
  {
    key: 'devices',
    title: 'Vários dispositivos, zero falhas',
    description: 'Ligue vários Android e SIMs. Se um falhar, a tarefa passa para outro automaticamente.',
    Illustration: DevicesIllustration,
  },
];

function Dot({ index, scrollX, width }: { index: number; scrollX: SharedValue<number>; width: number }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => {
    const position = scrollX.value / width;
    const active = interpolate(Math.abs(position - index), [0, 1], [1, 0], Extrapolation.CLAMP);
    return {
      width: 8 + active * 16,
      opacity: 0.35 + active * 0.65,
    };
  });
  return <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: colors.brand }, style]} />;
}

export function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const { completeOnboarding } = useSession();
  const styles = useStyles();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  const last = page === slides.length - 1;

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const finish = () => {
    router.replace('/login');
    completeOnboarding();
  };

  const next = () => {
    if (last) return finish();
    // Programmatic scrolls don't reliably emit momentum events on Android.
    setPage(page + 1);
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <BrandLockup size={30} />
        {!last && (
          <Pressable onPress={finish} hitSlop={hitSlop} accessibilityRole="button">
            <Text variant="calloutStrong" color="secondary">
              Saltar
            </Text>
          </Pressable>
        )}
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.pager}>
        {slides.map(({ key, title, description, Illustration }, index) => (
          <View key={key} style={[styles.slide, { width }]} accessibilityLabel={`${index + 1} de ${slides.length}. ${title}`}>
            <View style={styles.illustration}>
              <Illustration />
            </View>
            <View style={styles.copy}>
              <Text variant="overline" color="brand">
                {`${index + 1} / ${slides.length}`}
              </Text>
              <Text variant="title1">{title}</Text>
              <Text variant="body" color="secondary">
                {description}
              </Text>
            </View>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {slides.map((slide, index) => (
            <Dot key={slide.key} index={index} scrollX={scrollX} width={width} />
          ))}
        </View>
        <Button
          label={last ? 'Começar' : 'Continuar'}
          iconRight={last ? undefined : 'chevronRight'}
          size="lg"
          fullWidth
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

const useStyles = createStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.background,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.xxl,
    paddingVertical: t.spacing.md,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    paddingHorizontal: t.spacing.xxl,
    justifyContent: 'center',
    gap: t.spacing.xxl,
  },
  illustration: {
    flexShrink: 1,
    justifyContent: 'center',
  },
  copy: {
    gap: t.spacing.sm,
  },
  bottom: {
    paddingHorizontal: t.spacing.xxl,
    paddingBottom: t.spacing.lg,
    paddingTop: t.spacing.md,
    gap: t.spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
}));
