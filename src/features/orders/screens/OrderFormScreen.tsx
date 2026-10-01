import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { operatorLabels } from '@/constants/labels';
import { useCreateOrder, useProducts } from '@/hooks';
import { errorMessage, isAppError } from '@/services';
import {
  newIdempotencyKey,
  normalizePhone,
  ORDER_RULES,
  validateCreateOrderInput,
  type CreateOrderField,
} from '@/services/orderRules';
import { createStyles, useTheme } from '@/theme';
import { formatDataAmount, formatPhone, formatPrice } from '@/utils/format';

/**
 * Registers an order on behalf of a customer (e.g. a sale agreed by phone).
 * Price and product data are fixed by the backend at creation (snapshot).
 * One idempotency key per form: retrying after a network failure never
 * creates a second order.
 */
export function OrderFormScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const products = useProducts();
  const create = useCreateOrder();
  const [productId, setProductId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Partial<Record<CreateOrderField, string>>>({});
  const [idempotencyKey] = useState(newIdempotencyKey);
  const submitting = useRef(false);

  const normalized = normalizePhone(phone);

  /** Editing a field clears its error until the next submit. */
  const change = (field: CreateOrderField, setter: (value: string) => void) => (value: string) => {
    setter(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async () => {
    if (submitting.current) return;
    const input = { productId: productId ?? '', customerPhone: phone, customerName: name, idempotencyKey };
    const found = validateCreateOrderInput(input);
    setErrors(found);
    if (Object.keys(found).length) return;

    submitting.current = true;
    try {
      const order = await create.mutateAsync(input);
      toast.success('Pedido registado', `${order.code} · ${order.productName}`);
      router.replace({ pathname: '/orders/[id]', params: { id: order.id } });
    } catch (e) {
      const reason = isAppError(e) ? e.reason : undefined;
      if (reason === 'PRODUCT_NOT_AVAILABLE') setErrors({ productId: errorMessage(e) });
      else if (reason === 'INVALID_PHONE') setErrors({ customerPhone: errorMessage(e) });
      else toast.error('Não foi possível registar o pedido', errorMessage(e));
    } finally {
      submitting.current = false;
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Screen
        edges={['top', 'bottom']}
        header={<StackHeader title="Novo pedido" subtitle="Registar uma venda manualmente" />}
        footer={
          <View style={styles.footer}>
            <Button label="Registar pedido" icon="check" fullWidth loading={create.isPending} onPress={() => void submit()} />
          </View>
        }>
        <Section title="Produto" subtitle="Só os produtos à venda (ativos).">
          <QueryView
            query={products}
            loading={<SkeletonList count={3} lines={2} />}
            isEmpty={(data) => !data.some((p) => p.status === 'ACTIVE')}
            empty={
              <EmptyState
                icon="product"
                title="Sem produtos à venda"
                description="Ative um produto (com o USSD configurado) para poder registar pedidos."
                action={{ label: 'Ir para Produtos', icon: 'product', onPress: () => router.push('/products') }}
                compact
              />
            }>
            {(data) => {
              const available = data.filter((p) => p.status === 'ACTIVE').sort((a, b) => a.price - b.price);
              return (
                <ListGroup>
                  {available.map((product, index) => {
                    const selected = product.id === productId;
                    return (
                      <ListItem
                        key={product.id}
                        icon="product"
                        iconTone={selected ? 'brand' : 'neutral'}
                        title={product.name}
                        subtitle={`${formatPrice(product.price, product.currency)} · ${formatDataAmount(product.dataAmount, product.dataUnit)} · ${operatorLabels[product.operator]}`}
                        trailing={selected ? <Icon name="checkCircle" size={22} color={colors.brand} /> : undefined}
                        onPress={() => {
                          setProductId(product.id);
                          setErrors((current) => ({ ...current, productId: undefined }));
                        }}
                        divider={index < available.length - 1}
                      />
                    );
                  })}
                </ListGroup>
              );
            }}
          </QueryView>
          {errors.productId ? (
            <Text variant="caption" color="danger">
              {errors.productId}
            </Text>
          ) : null}
        </Section>

        <Section title="Cliente">
          <Input
            label="Número que recebe o pacote"
            icon="phone"
            value={phone}
            onChangeText={change('customerPhone', setPhone)}
            placeholder="84 123 4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            error={errors.customerPhone}
            hint={normalized ? `Será guardado como ${formatPhone(normalized)}` : 'Números de Moçambique (82–87) ou formato internacional (+…).'}
          />
          <Input
            label="Nome do cliente (opcional)"
            icon="user"
            value={name}
            onChangeText={change('customerName', setName)}
            placeholder="Ex.: João Mabunda"
            maxLength={ORDER_RULES.customerNameMax}
            error={errors.customerName}
          />
        </Section>

        <Text variant="caption" color="muted">
          O preço e os dados do produto ficam fixados neste momento. O pedido começa como “Pendente”; o pagamento e a ativação
          chegam nas próximas fases.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: t.spacing.gutter,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.background,
  },
}));
