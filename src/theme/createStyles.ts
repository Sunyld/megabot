import { StyleSheet } from 'react-native';

import type { Theme } from './theme';
import { useTheme } from './ThemeProvider';

/**
 * Declares theme-aware styles once, outside the component:
 *
 *   const useStyles = createStyles((t) => ({ card: { backgroundColor: t.colors.surface } }));
 *
 * Styles are built at most once per theme and cached by theme identity.
 */
export function createStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T) {
  const cache = new WeakMap<Theme, T>();

  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme));
      cache.set(theme, styles);
    }
    return styles;
  };
}
