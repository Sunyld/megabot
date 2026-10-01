import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { StackHeader } from '@/components/layout/Headers';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Chips';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { KeyValue } from '@/components/ui/KeyValue';
import { ListItem } from '@/components/ui/ListItem';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { QueryView } from '@/components/ui/QueryView';
import { ListGroup, Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { paymentMethodMeta, roleLabels } from '@/constants/labels';
import { useCurrentSession } from '@/features/auth/session';
import { useDevicesSummary, useOrderCounts, usePaymentAccounts } from '@/hooks';
import { setSimulation, useSimulation, type SimulationSettings } from '@/services/mock';
import { createStyles, type IconName, useTheme, useThemePreference, type ThemePreference } from '@/theme';
import { formatPhone } from '@/utils/format';

import { sectionTitles, type SettingsSectionId } from '../sections';

// ─── Shared bits ─────────────────────────────────────────────────────────────

function ToggleRow({
  icon,
  title,
  subtitle,
  initial = true,
  locked,
  divider = true,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  initial?: boolean;
  locked?: boolean;
  divider?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ListItem
      icon={icon}
      iconTone={value ? 'success' : 'neutral'}
      title={title}
      subtitle={locked ? `${subtitle ?? ''} · obrigatório` : subtitle}
      divider={divider}
      trailing={<Switch value={value} onValueChange={setValue} disabled={locked} accessibilityLabel={title} />}
    />
  );
}

function SaveButton() {
  const [saving, setSaving] = useState(false);
  return (
    <Button
      label="Guardar alterações"
      fullWidth
      loading={saving}
      onPress={() => {
        setSaving(true);
        setTimeout(() => {
          setSaving(false);
          toast.success('Alterações guardadas');
        }, 700);
      }}
    />
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { user } = useCurrentSession();
  const styles = useStyles();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  return (
    <>
      <View style={styles.center}>
        <Avatar name={name || user.name} size={80} />
        <Badge label={roleLabels[user.role]} tone="brand" />
      </View>
      <Input label="Nome" icon="user" value={name} onChangeText={setName} />
      <Input label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Input label="Telefone" icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <SaveButton />
    </>
  );
}

function CompanySection() {
  const { tenant } = useCurrentSession();
  const [store, setStore] = useState(tenant.name);
  const [botName, setBotName] = useState(`${tenant.name} Bot`);
  const [welcome, setWelcome] = useState('Olá! 👋 Escreva *tabela* para ver os pacotes disponíveis.');
  return (
    <>
      <Input label="Nome da loja" icon="business" value={store} onChangeText={setStore} hint="Aparece no topo da tabela de preços." />
      <Input label="Nome no WhatsApp" icon="whatsapp" value={botName} onChangeText={setBotName} />
      <Input label="Mensagem de boas-vindas" icon="chat" value={welcome} onChangeText={setWelcome} multiline />
      <Card>
        <KeyValue label="Moeda" value="Metical (MZN)" />
        <KeyValue label="Fuso horário" value={tenant.timezone} />
        <KeyValue label="Identificador" value={tenant.slug} mono last />
      </Card>
      <SaveButton />
    </>
  );
}

function PaymentsSection() {
  const { colors } = useTheme();
  const styles = useStyles();
  const accounts = usePaymentAccounts();
  return (
    <>
      <Section title="Contas de recebimento">
        <QueryView query={accounts} loading={<Skeleton height={180} radius={16} />}>
          {(list) => (
            <View style={styles.stack}>
              {list.map((account) => (
                <Card key={account.method} style={styles.account}>
                  <View style={styles.spread}>
                    <Badge label={paymentMethodMeta[account.method].label} tone={paymentMethodMeta[account.method].tone} variant="outline" />
                    <Text variant="mono">{formatPhone(account.account)}</Text>
                  </View>
                  <Text variant="caption" color="secondary">
                    {account.holderName}
                  </Text>
                  {account.monitoredBy && (
                    <View style={styles.inline}>
                      <Icon name="sms" size={14} color={colors.tones.success.fg} />
                      <Text variant="caption" color="success">
                        {`SMS lidos por ${account.monitoredBy.deviceName} · SIM ${account.monitoredBy.simSlot}`}
                      </Text>
                    </View>
                  )}
                </Card>
              ))}
            </View>
          )}
        </QueryView>
      </Section>
      <Section title="Regras de reconciliação" subtitle="Aplicadas antes de qualquer ativação">
        <ListGroup>
          <ToggleRow icon="receipt" title="Exigir ID da transação" subtitle="Referência principal" locked />
          <ToggleRow icon="shield" title="Rejeitar IDs duplicados" subtitle="Cada ID só é usado uma vez" locked />
          <ToggleRow icon="payments" title="Valor exato" subtitle="Valores diferentes vão para revisão" />
          <ToggleRow icon="clock" title="Janela de 24 horas" subtitle="Comprovativos antigos vão para revisão" divider={false} />
        </ListGroup>
      </Section>
    </>
  );
}

function NotificationsSection() {
  return (
    <ListGroup>
      <ToggleRow icon="warning" title="Pagamentos em revisão" subtitle="Quando os dados não coincidem" />
      <ToggleRow icon="error" title="Falhas de ativação" subtitle="Quando a operadora recusa" />
      <ToggleRow icon="devices" title="Dispositivo offline" subtitle="Mais de 5 minutos sem sinal" />
      <ToggleRow icon="sim" title="Limite de SIM" subtitle="Quando um SIM atinge o limite diário" />
      <ToggleRow icon="bolt" title="Cada pacote ativado" subtitle="Pode gerar muitas notificações" initial={false} />
      <ToggleRow icon="chart" title="Resumo diário" subtitle="Às 21:00, com vendas e receita" divider={false} />
    </ListGroup>
  );
}

function SecuritySection() {
  return (
    <>
      <ListGroup>
        <ToggleRow icon="lock" title="PIN de acesso" subtitle="Pedido ao abrir a app" />
        <ToggleRow icon="fingerprint" title="Biometria" subtitle="Impressão digital ou rosto" />
        <ToggleRow icon="shield" title="Verificação em dois passos" subtitle="Código por SMS ao entrar" initial={false} divider={false} />
      </ListGroup>
      <Section title="Sessões ativas">
        <ListGroup>
          <ListItem icon="devices" iconTone="success" title="Este telemóvel" subtitle="Android · agora" divider />
          <ListItem icon="language" title="Navegador · Maputo" subtitle="Ativa há 2 dias" />
        </ListGroup>
      </Section>
      <Button
        label="Terminar outras sessões"
        variant="danger"
        fullWidth
        onPress={() => toast.success('Outras sessões terminadas')}
      />
    </>
  );
}

function SubscriptionSection() {
  const styles = useStyles();
  const { colors } = useTheme();
  const devices = useDevicesSummary();
  const orders = useOrderCounts();
  const features = ['Até 5 dispositivos Android', 'Pedidos ilimitados no WhatsApp', 'Failover automático', 'Suporte prioritário'];
  return (
    <>
      <Card variant="brand" style={styles.stack}>
        <View style={styles.spread}>
          <Text variant="title2" color="onBrand">
            Plano Pro
          </Text>
          <Badge label="Ativo" tone="success" variant="solid" size="sm" />
        </View>
        <Text variant="hero" color="onBrand">
          1.500 MT
          <Text variant="body" color="onBrand">
            {' / mês'}
          </Text>
        </Text>
        <Text variant="callout" colorValue="rgba(255,255,255,0.85)">
          Próxima renovação a 30 de outubro
        </Text>
      </Card>
      <Section title="Utilização">
        <Card style={styles.stack}>
          <View style={styles.spread}>
            <Text variant="bodyMedium">Dispositivos</Text>
            <Text variant="bodyStrong" tabular>{`${devices.data?.total ?? '–'} / 5`}</Text>
          </View>
          <ProgressBar value={(devices.data?.total ?? 0) / 5} tone="info" />
          <View style={styles.spread}>
            <Text variant="bodyMedium">Pedidos este mês</Text>
            <Text variant="bodyStrong" tabular>{`${orders.data?.all ?? '–'} · ilimitado`}</Text>
          </View>
          <ProgressBar value={0.08} tone="success" />
        </Card>
      </Section>
      <Card style={styles.stack}>
        {features.map((feature) => (
          <View key={feature} style={styles.inline}>
            <Icon name="checkCircle" size={18} color={colors.tones.success.solid} />
            <Text variant="callout">{feature}</Text>
          </View>
        ))}
      </Card>
      <Button
        label="Gerir assinatura"
        variant="secondary"
        fullWidth
        onPress={() => toast.show({ title: 'Faturação', description: 'A gestão de planos chega numa fase posterior.', icon: 'subscription' })}
      />
    </>
  );
}

const faqs = [
  {
    q: 'Como é confirmado um pagamento?',
    a: 'O MegaBot compara o ID da transação do comprovativo com a mensagem real da carteira recebida num dos seus dispositivos. Valor, conta e data também têm de coincidir.',
  },
  {
    q: 'A IA pode confirmar pagamentos sozinha?',
    a: 'Não. A IA apenas interpreta mensagens e extrai dados. A confirmação é sempre feita por regras determinísticas.',
  },
  {
    q: 'O que acontece se um telemóvel desligar?',
    a: 'As tarefas passam automaticamente para outro dispositivo e SIM disponíveis (failover). É notificado quando isso acontece.',
  },
  {
    q: 'O que significa “Sem confirmação” (UNKNOWN)?',
    a: 'O USSD foi enviado mas a operadora não respondeu. O MegaBot verifica o resultado antes de tentar de novo, para nunca ativar o pacote duas vezes.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.faq}>
      <View style={styles.spread}>
        <Text variant="bodyMedium" style={styles.flex}>
          {q}
        </Text>
        <Icon name="chevronDown" size={20} color={colors.textMuted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </View>
      {open && (
        <Animated.View entering={FadeIn.duration(180)}>
          <Text variant="callout" color="secondary">
            {a}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

function HelpSection() {
  const styles = useStyles();
  return (
    <>
      <Card padding={0}>
        {faqs.map((item, index) => (
          <View key={item.q} style={index < faqs.length - 1 ? styles.divider : undefined}>
            <FaqItem {...item} />
          </View>
        ))}
      </Card>
      <ListGroup>
        <ListItem icon="whatsapp" iconTone="success" title="Falar com o suporte" subtitle="WhatsApp · resposta em minutos" chevron divider onPress={() => toast.show({ title: 'Suporte', description: 'Canal de suporte disponível em breve.', icon: 'whatsapp' })} />
        <ListItem icon="mail" iconTone="info" title="Enviar email" subtitle="suporte@megabot.app" chevron onPress={() => toast.show({ title: 'Email', description: 'suporte@megabot.app', icon: 'mail' })} />
      </ListGroup>
    </>
  );
}

function AppearanceSection() {
  const { preference, setPreference } = useThemePreference();
  const { colors } = useTheme();
  const options: { value: ThemePreference; title: string; subtitle: string; icon: IconName }[] = [
    { value: 'system', title: 'Sistema', subtitle: 'Segue o tema do telemóvel', icon: 'contrast' },
    { value: 'light', title: 'Claro', subtitle: 'Ideal durante o dia', icon: 'lightMode' },
    { value: 'dark', title: 'Escuro', subtitle: 'Poupa bateria em ecrãs OLED', icon: 'darkMode' },
  ];
  return (
    <ListGroup>
      {options.map((option, index) => (
        <ListItem
          key={option.value}
          icon={option.icon}
          iconTone={preference === option.value ? 'brand' : 'neutral'}
          title={option.title}
          subtitle={option.subtitle}
          divider={index < options.length - 1}
          onPress={() => setPreference(option.value)}
          trailing={preference === option.value ? <Icon name="checkCircle" size={22} color={colors.brand} /> : undefined}
        />
      ))}
    </ListGroup>
  );
}

function SimulationSection() {
  const simulation = useSimulation();
  const { colors } = useTheme();
  const styles = useStyles();
  const toggle = (key: Exclude<keyof SimulationSettings, 'latency'>, title: string, subtitle: string, icon: IconName, divider = true) => (
    <ListItem
      icon={icon}
      iconTone={simulation[key] ? 'warning' : 'neutral'}
      title={title}
      subtitle={subtitle}
      divider={divider}
      trailing={<Switch value={simulation[key]} onValueChange={(value) => setSimulation({ [key]: value })} accessibilityLabel={title} />}
    />
  );

  return (
    <>
      <View style={styles.note}>
        <Icon name="science" size={18} color={colors.tones.ai.fg} />
        <Text variant="callout" color="secondary" style={styles.flex}>
          Ferramentas de protótipo para ver cada estado da interface. Não existem na versão de produção.
        </Text>
      </View>
      <Section title="Latência da rede">
        <SegmentedControl
          options={[
            { value: 'instant', label: 'Instantânea' },
            { value: 'realistic', label: 'Realista' },
            { value: 'slow', label: 'Lenta' },
          ]}
          value={simulation.latency}
          onChange={(latency) => setSimulation({ latency })}
        />
        <Text variant="caption" color="muted">
          Use “Lenta” para ver os estados de carregamento (skeletons).
        </Text>
      </Section>
      <Section title="Estados">
        <ListGroup>
          {toggle('offline', 'Simular offline', 'Mostra banners e estados sem ligação', 'wifiOff')}
          {toggle('failRequests', 'Simular erro do servidor', 'Pedidos falham com estado de erro', 'error')}
          {toggle('emptyData', 'Simular conta vazia', 'Listas sem dados (estados vazios)', 'history', false)}
        </ListGroup>
      </Section>
      <Button
        label="Repor simulação"
        icon="refresh"
        variant="secondary"
        fullWidth
        onPress={() => {
          setSimulation({ latency: 'realistic', offline: false, failRequests: false, emptyData: false });
          toast.success('Simulação reposta');
        }}
      />
    </>
  );
}

const sections: Record<SettingsSectionId, () => ReactNode> = {
  profile: ProfileSection,
  company: CompanySection,
  payments: PaymentsSection,
  notifications: NotificationsSection,
  security: SecuritySection,
  subscription: SubscriptionSection,
  help: HelpSection,
  appearance: AppearanceSection,
  simulation: SimulationSection,
};

export function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const id = (section in sections ? section : null) as SettingsSectionId | null;
  const Content = id ? sections[id] : null;

  return (
    <Screen edges={['top', 'bottom']} header={<StackHeader title={id ? sectionTitles[id] : 'Definições'} />}>
      {Content ? (
        <Content />
      ) : (
        <EmptyState icon="settings" title="Secção não encontrada" description="Volte às definições e escolha outra opção." />
      )}
    </Screen>
  );
}

const useStyles = createStyles((t) => ({
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    gap: t.spacing.md,
  },
  stack: {
    gap: t.spacing.md,
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  account: {
    gap: t.spacing.sm,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  faq: {
    gap: t.spacing.sm,
    padding: t.spacing.lg,
  },
  note: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.tones.ai.bg,
  },
}));
