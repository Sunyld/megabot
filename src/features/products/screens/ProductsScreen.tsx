import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/Chips';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { operatorLabels, paymentMethodMeta, productCategoryMeta } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { ChatBubble } from '@/features/whatsapp/components/ChatBubble';
import { useArchiveProduct, usePaymentAccounts, useProducts, useSetProductActive } from '@/hooks';
import { errorMessage } from '@/services';
import { PRODUCT_CATEGORIES } from '@/services/productRules';
import { createStyles, useTheme } from '@/theme';
import type { Product, ProductCategory } from '@/types';
import { formatDataAmount, formatPrice, formatValidity } from '@/utils/format';
import { buildPriceTable } from '@/utils/priceTable';
import { describeUssdFlow } from '@/utils/ussd';

import { ProductCard } from '../components/ProductCard';

const categories: { value: ProductCategory; label: string }[] = PRODUCT_CATEGORIES.map((value) => ({
  value,
  label: productCategoryMeta[value].label,
}));

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const openNew = () => router.push('/products/new');
const openEdit = (id: string) => router.push({ pathname: '/products/[id]', params: { id } });

export function ProductsScreen() {
  const { tenant, user } = useCurrentSession();
  const { colors } = useTheme();
  const styles = useStyles();
  const products = useProducts();
  const accounts = usePaymentAccounts();
  const setActive = useSetProductActive();
  const archive = useArchiveProduct();
  const [category, setCategory] = useState<ProductCategory>('daily');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // UI only: the database (RLS) is what restricts product writes to owner/admin.
  const canManage = user.role === 'owner' || user.role === 'admin';
  const list = products.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? null;
  const activeCount = list.filter((p) => p.status === 'ACTIVE').length;

  const toggle = async (product: Product, active: boolean) => {
    try {
      await setActive.mutateAsync({ id: product.id, active });
      toast.success(
        active ? 'Produto ativado' : 'Produto desativado',
        active ? 'Volta a aparecer na tabela do WhatsApp.' : 'Deixa de aparecer na tabela.'
      );
    } catch (e) {
      toast.error('Não foi possível atualizar', errorMessage(e));
    }
  };

  const confirmArchive = async () => {
    if (!selected) return;
    try {
      await archive.mutateAsync(selected.id);
      setArchiveOpen(false);
      setSelectedId(null);
      toast.success('Produto arquivado', 'Deixa de aparecer na lista e na tabela.');
    } catch (e) {
      setArchiveOpen(false);
      toast.error('Não foi possível arquivar', errorMessage(e));
    }
  };

  const priceTable = buildPriceTable(list, {
    storeName: tenant.name,
    paymentAccounts: (accounts.data ?? []).map((a) => ({ label: paymentMethodMeta[a.method].label, account: a.account })),
  });

  return (
    <Screen
      edges={['top', 'bottom']}
      refreshing={products.isRefreshing}
      onRefresh={() => void products.refetch()}
      header={
        <StackHeader
          title="Produtos"
          subtitle={products.data ? `${list.length} pacotes · ${activeCount} ativos` : undefined}
          right={
            <View style={styles.headerActions}>
              <IconButton icon="table" accessibilityLabel="Pré-visualizar tabela" onPress={() => setPreviewOpen(true)} />
              {canManage ? <IconButton icon="add" accessibilityLabel="Novo produto" onPress={openNew} /> : null}
            </View>
          }
        />
      }>
      <SegmentedControl options={categories} value={category} onChange={setCategory} />

      <QueryView
        query={products}
        loading={
          <View style={styles.grid}>
            {[0, 1].map((row) => (
              <View key={row} style={styles.row}>
                <Skeleton height={170} radius={16} style={styles.flex} />
                <Skeleton height={170} radius={16} style={styles.flex} />
              </View>
            ))}
          </View>
        }
        isEmpty={(data) => data.filter((p) => p.category === category).length === 0}
        empty={
          <EmptyState
            icon="product"
            title={list.length ? 'Sem pacotes nesta categoria' : 'Ainda não tem produtos'}
            description={
              canManage
                ? 'Crie os pacotes que vende, com o preço e o USSD de cada um.'
                : 'O dono ou um administrador da empresa pode adicionar pacotes.'
            }
            action={canManage ? { label: 'Criar produto', icon: 'add', onPress: openNew } : undefined}
          />
        }>
        {(data) => (
          <Animated.View key={category} entering={FadeIn.duration(200)} style={styles.grid}>
            {chunk(
              data.filter((p) => p.category === category).sort((a, b) => a.price - b.price),
              2
            ).map((row) => (
              <View key={row[0].id} style={styles.row}>
                {row.map((product) => (
                  <View key={product.id} style={styles.cell}>
                    <ProductCard product={product} onPress={() => setSelectedId(product.id)} />
                  </View>
                ))}
                {row.length === 1 && <View style={styles.cell} />}
              </View>
            ))}
          </Animated.View>
        )}
      </QueryView>

      <Button label="Pré-visualizar tabela do WhatsApp" icon="whatsapp" variant="secondary" fullWidth onPress={() => setPreviewOpen(true)} />

      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.name}
        subtitle={selected ? `${productCategoryMeta[selected.category].label} · ${operatorLabels[selected.operator]}` : undefined}>
        {selected && (
          <>
            <View style={styles.priceRow}>
              <Text variant="hero" color="brand">
                {formatPrice(selected.price, selected.currency)}
              </Text>
              <Text variant="callout" color="secondary">
                {`${selected.soldToday} vendidos hoje`}
              </Text>
            </View>
            <ListGroup>
              <ListItem
                icon={selected.status === 'ACTIVE' ? 'checkCircle' : 'pause'}
                iconTone={selected.status === 'ACTIVE' ? 'success' : 'neutral'}
                title="Disponível para venda"
                subtitle={
                  selected.status === 'ACTIVE'
                    ? 'Aparece na tabela do WhatsApp'
                    : selected.ussdFlow
                      ? 'Oculto dos clientes'
                      : 'Configure o USSD para poder vender'
                }
                trailing={
                  <Switch
                    value={selected.status === 'ACTIVE'}
                    onValueChange={(value) => void toggle(selected, value)}
                    disabled={!canManage || setActive.isPending}
                    accessibilityLabel="Disponível para venda"
                  />
                }
              />
            </ListGroup>
            <View>
              <KeyValue label="Dados" value={formatDataAmount(selected.dataAmount, selected.dataUnit)} />
              <KeyValue label="Validade" value={formatValidity(selected.validityHours)} />
              <KeyValue label="Operadora" value={operatorLabels[selected.operator]} />
              <KeyValue
                label="USSD"
                value={selected.ussdFlow ? describeUssdFlow(selected.ussdFlow) : 'Por configurar'}
                mono={selected.ussdFlow !== null}
                last
              />
            </View>
            {selected.description ? (
              <Text variant="callout" color="secondary">
                {selected.description}
              </Text>
            ) : null}
            {canManage ? (
              <View style={styles.sheetActions}>
                <Button
                  label="Editar"
                  icon="edit"
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => {
                    setSelectedId(null);
                    openEdit(selected.id);
                  }}
                />
                <Button label="Arquivar" icon="delete" variant="danger" style={styles.flex} onPress={() => setArchiveOpen(true)} />
              </View>
            ) : null}
          </>
        )}
      </BottomSheet>

      <Dialog
        visible={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        icon="delete"
        tone="danger"
        title="Arquivar produto?"
        message="Deixa de estar à venda e de aparecer na lista. O histórico mantém-se e o produto não pode voltar a ser editado."
        confirmLabel="Arquivar"
        confirmVariant="danger"
        loading={archive.isPending}
        onConfirm={() => void confirmArchive()}
      />

      <BottomSheet
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Tabela no WhatsApp"
        subtitle="Enviada automaticamente quando o cliente escreve “tabela”.">
        <View style={[styles.chat, { backgroundColor: colors.chat.wallpaper }]}>
          <ChatBubble message={{ id: 'p1', direction: 'in', text: 'tabela', at: new Date().toISOString(), intent: 'SHOW_PRICES' }} />
          <ChatBubble message={{ id: 'p2', direction: 'out', text: priceTable, at: new Date().toISOString() }} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grid: {
    gap: t.spacing.md,
  },
  cell: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: t.spacing.md,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: t.spacing.md,
  },
  chat: {
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
  },
}));
