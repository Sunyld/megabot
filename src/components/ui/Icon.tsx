import regular from 'expo-symbols/androidWeights/regular';
import { SymbolView } from 'expo-symbols';
import { Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { icons, type IconName, useTheme } from '@/theme';
import { iconGlyphs } from '@/theme/icon-glyphs.generated';

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/** Font family registered at startup (see `useAppFonts`). */
export const ICON_FONT = regular;

/**
 * Semantic icon. iOS renders SF Symbols natively; Android and web render
 * Material Symbols glyphs from the font preloaded at app start, synchronously.
 */
export function Icon({ name, size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const tint = color ?? colors.text;
  const def = icons[name];

  if (Platform.OS === 'ios') {
    return <SymbolView name={def.ios} size={size} tintColor={tint} style={style} />;
  }

  const code = iconGlyphs[def.android];
  if (code === undefined) {
    return <SymbolView name={{ android: def.android, web: def.android }} size={size} tintColor={tint} style={style} />;
  }

  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: regular.name,
          fontSize: size,
          lineHeight: size,
          color: tint,
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}>
        {String.fromCharCode(code)}
      </Text>
    </View>
  );
}
