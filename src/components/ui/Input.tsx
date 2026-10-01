import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { createStyles, hitSlop, type IconName, useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  icon?: IconName;
  error?: string | null;
  hint?: string;
  /** Adds a show/hide toggle for passwords. */
  secureToggle?: boolean;
};

export function Input({ label, icon, error, hint, secureToggle, secureTextEntry, editable = true, ...rest }: InputProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));

  const borderColor = error ? colors.tones.danger.solid : focused ? colors.brand : colors.border;

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="calloutStrong" color="secondary">
          {label}
        </Text>
      ) : null}
      <View style={[styles.field, { borderColor }, !editable && styles.disabled]}>
        {icon && <Icon name={icon} size={20} color={focused ? colors.text : colors.textMuted} />}
        <TextInput
          {...rest}
          editable={editable}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={styles.input}
          accessibilityLabel={label ?? rest.placeholder}
        />
        {secureToggle && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar palavra-passe' : 'Ocultar palavra-passe'}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      {error ? (
        <View style={styles.message}>
          <Icon name="error" size={14} color={colors.tones.danger.fg} />
          <Text variant="caption" color="danger">
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Pesquisar',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.search}>
      <Icon name="search" size={20} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.brand}
        cursorColor={colors.brand}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.input}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Limpar pesquisa">
          <Icon name="cancel" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((t) => ({
  wrapper: {
    gap: t.spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    height: 52,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    backgroundColor: t.colors.surface,
  },
  disabled: {
    backgroundColor: t.colors.surfaceMuted,
  },
  input: {
    flex: 1,
    height: '100%',
    color: t.colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    height: 44,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
}));
