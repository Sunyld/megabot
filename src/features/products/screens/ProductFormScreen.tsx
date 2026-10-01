import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { FilterChip, SegmentedControl } from '@/components/ui/Chips';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { operatorLabels, productCategoryMeta } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useCreateProduct, useProduct, useUpdateProduct } from '@/hooks';
import { errorMessage, isAppError } from '@/services';
import { PRODUCT_CATEGORIES, PRODUCT_OPERATORS } from '@/services/productRules';
import { createStyles } from '@/theme';
import type { DataUnit } from '@/types';
import { describeUssdFlow } from '@/utils/ussd';

import { UssdFlowEditor } from '../components/UssdFlowEditor';
import {
  draftFromProduct,
  draftToFlow,
  emptyDraft,
  hasErrors,
  validateDraft,
  type ProductDraft,
  type ProductFormErrors,
} from '../productForm';

const categoryOptions = PRODUCT_CATEGORIES.map((value) => ({ value, label: productCategoryMeta[value].label }));
const operatorOptions = PRODUCT_OPERATORS.map((value) => ({ value, label: operatorLabels[value] }));
const unitOptions: { value: DataUnit; label: string }[] = [
  { value: 'MB', label: 'MB' },
  { value: 'GB', label: 'GB' },
];
const validityPresets = [
  { hours: '6', label: '6 horas' },
  { hours: '24', label: '24 horas' },
  { hours: '168', label: '7 dias' },
  { hours: '720', label: '30 dias' },
];

const back = () => (router.canGoBack() ? router.back() : router.replace('/products'));

/** Create (route /products/new) or edit (route /products/[id]) a product. */
export function ProductFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user, tenant } = useCurrentSession();
  const editing = typeof id === 'string' && id.length > 0;
  const product = useProduct(id ?? '', { enabled: editing });
  const title = editing ? 'Editar produto' : 'Novo produto';

  // UI only: the database (RLS) is what actually restricts writes to owner/admin.
  if (user.role === 'operator') {
    return (
      <Screen edges={['top', 'bottom']} header={<StackHeader title={title} />}>
        <EmptyState
          icon="lock"
          title="Sem permissão"
          description="Só o dono ou um administrador da empresa pode criar e editar produtos."
        />
      </Screen>
    );
  }

  if (!editing) return <ProductForm title={title} initial={emptyDraft(tenant.currency)} />;

  const data = product.data;
  if (data === undefined || data.archivedAt) {
    return (
      <Screen edges={['top', 'bottom']} header={<StackHeader title={title} />}>
        {data?.archivedAt ? (
          <EmptyState icon="history" title="Produto arquivado" description="Produtos arquivados já não podem ser alterados." />
        ) : (
          // Loading skeleton or error state (not found, offline…).
          <QueryView
            query={product}
            loading={
              <>
                <Skeleton height={52} radius={12} />
                <Skeleton height={52} radius={12} />
                <Skeleton height={160} radius={16} />
              </>
            }>
            {() => null}
          </QueryView>
        )}
      </Screen>
    );
  }

  return <ProductForm key={data.id} title={title} productId={data.id} initial={draftFromProduct(data)} />;
}

function ProductForm({ title, productId, initial }: { title: string; productId?: string; initial: ProductDraft }) {
  const styles = useStyles();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const submitting = useRef(false);
  const saving = create.isPending || update.isPending;

  const set = (patch: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const text = <K extends keyof ProductDraft>(field: K) => (value: ProductDraft[K]) => set({ [field]: value } as Partial<ProductDraft>);

  const flowPreview = (() => {
    const flow = draftToFlow(draft);
    return flow && flow.start && flow.steps.length ? describeUssdFlow(flow) : null;
  })();

  const submit = async () => {
    if (submitting.current) return;
    const { input, errors: found } = validateDraft(draft);
    setErrors(found);
    if (hasErrors(found)) {
      toast.error('Verifique os campos assinalados', 'O produto ainda não foi guardado.');
      return;
    }
    submitting.current = true;
    try {
      if (productId) await update.mutateAsync({ id: productId, input });
      else await create.mutateAsync(input);
      toast.success(productId ? 'Produto atualizado' : 'Produto criado', input.status === 'ACTIVE' ? 'Já está à venda.' : 'Ainda não está à venda.');
      back();
    } catch (e) {
      if (isAppError(e) && e.reason === 'PRODUCT_NAME_TAKEN') setErrors({ name: e.message });
      else toast.error('Não foi possível guardar', errorMessage(e));
    } finally {
      submitting.current = false;
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <Screen
        edges={['top', 'bottom']}
        header={<StackHeader title={title} />}
        footer={
          <View style={styles.footer}>
            <Button
              label={productId ? 'Guardar alterações' : 'Criar produto'}
              icon="check"
              fullWidth
              loading={saving}
              onPress={() => void submit()}
            />
          </View>
        }>
        <Section title="Produto">
          <Input
            label="Nome"
            icon="product"
            value={draft.name}
            onChangeText={text('name')}
            placeholder="Internet 5GB"
            maxLength={80}
            error={errors.name}
          />
          <Input
            label="Descrição (opcional)"
            value={draft.description}
            onChangeText={text('description')}
            placeholder="Ex.: válido para toda a rede"
            maxLength={500}
            error={errors.description}
          />
          <View style={styles.field}>
            <Text variant="calloutStrong" color="secondary">
              Categoria
            </Text>
            <SegmentedControl options={categoryOptions} value={draft.category} onChange={text('category')} />
          </View>
        </Section>

        <Section title="Preço e dados">
          <View style={styles.row}>
            <View style={styles.grow}>
              <Input
                label="Preço"
                icon="wallet"
                value={draft.price}
                onChangeText={text('price')}
                placeholder="500"
                keyboardType="decimal-pad"
                error={errors.price}
              />
            </View>
            <View style={styles.currency}>
              <Input
                label="Moeda"
                value={draft.currency}
                onChangeText={(value) => set({ currency: value.toUpperCase() })}
                autoCapitalize="characters"
                maxLength={3}
                error={errors.currency}
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Input
                label={draft.category === 'unlimited' ? 'Dados (opcional)' : 'Quantidade de dados'}
                icon="data"
                value={draft.dataAmount}
                onChangeText={text('dataAmount')}
                placeholder={draft.category === 'unlimited' ? 'Ilimitado' : '5'}
                keyboardType="decimal-pad"
                error={errors.dataAmount}
              />
            </View>
            <View style={styles.unit}>
              <Text variant="calloutStrong" color="secondary">
                Unidade
              </Text>
              <SegmentedControl options={unitOptions} value={draft.dataUnit} onChange={text('dataUnit')} />
            </View>
          </View>
          <Input
            label="Validade (horas)"
            icon="clock"
            value={draft.validityHours}
            onChangeText={text('validityHours')}
            keyboardType="number-pad"
            error={errors.validityHours}
          />
          <View style={styles.chips}>
            {validityPresets.map((preset) => (
              <FilterChip
                key={preset.hours}
                label={preset.label}
                selected={draft.validityHours === preset.hours}
                onPress={() => set({ validityHours: preset.hours })}
              />
            ))}
          </View>
        </Section>

        <Section title="Operadora" subtitle="Rede do pacote — onde o USSD é executado.">
          <SegmentedControl options={operatorOptions} value={draft.operator} onChange={text('operator')} />
        </Section>

        <Section title="USSD" subtitle="Cada produto tem o seu próprio fluxo.">
          <ListGroup>
            <ListItem
              icon="ussd"
              iconTone={draft.ussdEnabled ? 'brand' : 'neutral'}
              title="Configurar USSD"
              subtitle={draft.ussdEnabled ? 'Fluxo usado para ativar este pacote' : 'Sem fluxo — o produto não pode ser vendido'}
              trailing={
                <Switch
                  value={draft.ussdEnabled}
                  onValueChange={(ussdEnabled) => set({ ussdEnabled, ...(ussdEnabled ? {} : { active: false }) })}
                  accessibilityLabel="Configurar USSD"
                />
              }
            />
          </ListGroup>
          {draft.ussdEnabled ? (
            <>
              <UssdFlowEditor draft={draft} errors={errors} onChange={set} />
              {flowPreview ? (
                <View style={styles.preview}>
                  <Text variant="captionStrong" color="secondary">
                    Pré-visualização
                  </Text>
                  <Text variant="monoSmall" selectable>
                    {flowPreview}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </Section>

        <Section title="Venda">
          <ListGroup>
            <ListItem
              icon={draft.active ? 'checkCircle' : 'pause'}
              iconTone={draft.active ? 'success' : 'neutral'}
              title="Disponível para venda"
              subtitle={draft.active ? 'Estado: ACTIVE' : 'Estado: INACTIVE — não pode ser vendido'}
              trailing={
                <Switch value={draft.active} onValueChange={text('active')} accessibilityLabel="Disponível para venda" />
              }
            />
          </ListGroup>
          {errors.ussd && !draft.ussdEnabled ? (
            <Text variant="caption" color="danger">
              {errors.ussd}
            </Text>
          ) : null}
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  field: {
    gap: t.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: t.spacing.md,
    alignItems: 'flex-start',
  },
  grow: {
    flex: 1,
  },
  currency: {
    width: 96,
  },
  unit: {
    width: 120,
    gap: t.spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  preview: {
    gap: t.spacing.xs,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
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
