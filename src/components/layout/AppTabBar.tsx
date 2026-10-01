import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { createStyles, type IconName, useTheme } from '@/theme';

const tabIcons: Record<string, IconName> = {
  index: 'home',
  orders: 'orders',
  payments: 'payments',
  devices: 'devices',
  more: 'more',
};

function TabItem({
  label,
  icon,
  focused,
  badge,
  onPress,
  onLongPress,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  badge?: string | number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, { duration: 220 });
  }, [focused, progress]);

  const pill = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scaleX: 0.6 + progress.value * 0.4 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? `${label}, ${badge} pendentes` : label}
      style={styles.item}>
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pill, pill]} />
        <Icon name={icon} size={22} color={focused ? colors.tones.brand.fg : colors.textMuted} />
        {badge !== undefined && (
          <View style={styles.badge}>
            <Text variant="captionStrong" color="onBrand" style={styles.badgeText}>
              {badge}
            </Text>
          </View>
        )}
      </View>
      <Text
        variant="caption"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        colorValue={focused ? colors.text : colors.textSecondary}
        weight={focused ? 700 : 500}
        style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Branded bottom navigation (safe-area aware, 5 destinations). */
export function AppTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const styles = useStyles();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

        return (
          <TabItem
            key={route.key}
            label={label}
            icon={tabIcons[route.name] ?? 'more'}
            focused={focused}
            badge={options.tabBarBadge}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  bar: {
    flexDirection: 'row',
    paddingTop: t.spacing.sm,
    paddingHorizontal: t.spacing.xs,
    backgroundColor: t.colors.tabBar,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    minHeight: 52,
  },
  iconWrap: {
    width: 56,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    width: 56,
    height: 30,
    borderRadius: 15,
    backgroundColor: t.colors.tones.brand.bg,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: t.colors.brand,
    borderWidth: 2,
    borderColor: t.colors.tabBar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 2,
  },
}));
