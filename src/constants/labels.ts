import type { StatusMeta } from '@/components/ui/Badge';
import type {
  AttemptResult,
  ConversationStatus,
  DeviceStatus,
  MessageIntent,
  NotificationKind,
  Operator,
  OrderFilter,
  OrderStatus,
  PaymentFilter,
  PaymentMethod,
  PaymentStatus,
  ProductCategory,
  ReconciliationCheckKey,
  Severity,
  SimStatus,
  TaskStatus,
  TenantPlan,
  UserRole,
} from '@/types';
import type { IconName, Tone } from '@/theme';

/**
 * Domain vocabulary: how each state is named, colored and iconified.
 * Status is always communicated with icon + label, never color alone.
 */

export const orderStatusMeta: Record<OrderStatus, StatusMeta> = {
  awaiting_destination: { label: 'Aguarda número', tone: 'neutral', icon: 'phone' },
  awaiting_payment: { label: 'Aguarda pagamento', tone: 'warning', icon: 'pending' },
  payment_review: { label: 'Em revisão', tone: 'warning', icon: 'warning' },
  paid: { label: 'Pago', tone: 'info', icon: 'wallet' },
  processing: { label: 'A processar', tone: 'info', icon: 'sync' },
  verifying: { label: 'A verificar', tone: 'ai', icon: 'history' },
  completed: { label: 'Concluído', tone: 'success', icon: 'checkCircle' },
  failed: { label: 'Falhou', tone: 'danger', icon: 'error' },
  cancelled: { label: 'Cancelado', tone: 'neutral', icon: 'cancel' },
};

export const orderFilterOptions: { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'paid', label: 'Pagos' },
  { value: 'processing', label: 'Processando' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'failed', label: 'Falhos' },
];

export const paymentStatusMeta: Record<PaymentStatus, StatusMeta> = {
  confirmed: { label: 'Confirmado', tone: 'success', icon: 'checkCircle' },
  pending: { label: 'Pendente', tone: 'info', icon: 'pending' },
  review: { label: 'Revisão', tone: 'warning', icon: 'warning' },
  rejected: { label: 'Rejeitado', tone: 'danger', icon: 'cancel' },
};

export const paymentFilterOptions: { value: PaymentFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'review', label: 'Revisão' },
  { value: 'rejected', label: 'Rejeitados' },
];

export const paymentMethodMeta: Record<PaymentMethod, { label: string; tone: Tone }> = {
  mpesa: { label: 'M-Pesa', tone: 'brand' },
  emola: { label: 'e-Mola', tone: 'warning' },
  mkesh: { label: 'mKesh', tone: 'info' },
};

export const checkLabels: Record<ReconciliationCheckKey, string> = {
  transaction_id: 'ID da transação',
  amount: 'Valor',
  account: 'Conta de destino',
  datetime: 'Data e hora',
  duplicate: 'ID não reutilizado',
};

export const deviceStatusMeta: Record<DeviceStatus, StatusMeta> = {
  online: { label: 'Online', tone: 'success', icon: 'dot' },
  offline: { label: 'Offline', tone: 'neutral', icon: 'cloudOff' },
  paused: { label: 'Pausado', tone: 'warning', icon: 'pause' },
};

export const simStatusMeta: Record<SimStatus, StatusMeta> = {
  available: { label: 'Disponível', tone: 'success', icon: 'checkCircle' },
  busy: { label: 'Ocupado', tone: 'info', icon: 'sync' },
  limit_reached: { label: 'Limite atingido', tone: 'warning', icon: 'warning' },
  error: { label: 'Erro', tone: 'danger', icon: 'error' },
  paused: { label: 'Pausado', tone: 'neutral', icon: 'pause' },
  offline: { label: 'Offline', tone: 'neutral', icon: 'cloudOff' },
};

export const taskStatusMeta: Record<TaskStatus, StatusMeta & { description: string }> = {
  QUEUED: { label: 'Na fila', tone: 'neutral', icon: 'queue', description: 'Aguarda um dispositivo livre.' },
  ASSIGNED: { label: 'Atribuída', tone: 'info', icon: 'dispatcher', description: 'Dispositivo e SIM escolhidos.' },
  EXECUTING: { label: 'A executar', tone: 'info', icon: 'sync', description: 'USSD em curso no dispositivo.' },
  SUBMITTED: { label: 'Submetida', tone: 'info', icon: 'send', description: 'USSD enviado à operadora.' },
  VERIFYING: { label: 'A verificar', tone: 'ai', icon: 'history', description: 'A confirmar o resultado.' },
  SUCCESS: { label: 'Sucesso', tone: 'success', icon: 'checkCircle', description: 'Pacote ativado e confirmado.' },
  FAILED: { label: 'Falhou', tone: 'danger', icon: 'error', description: 'A operadora recusou a ativação.' },
  UNKNOWN: {
    label: 'Sem confirmação',
    tone: 'warning',
    icon: 'unknown',
    description: 'USSD enviado sem resposta. Verificar antes de repetir.',
  },
};

export const attemptResultMeta: Record<AttemptResult, StatusMeta> = {
  skipped_offline: { label: 'Offline', tone: 'neutral', icon: 'cloudOff' },
  skipped_unavailable: { label: 'Indisponível', tone: 'neutral', icon: 'cancel' },
  skipped_limit: { label: 'Limite atingido', tone: 'warning', icon: 'warning' },
  running: { label: 'A executar', tone: 'info', icon: 'sync' },
  success: { label: 'Sucesso', tone: 'success', icon: 'checkCircle' },
  failed: { label: 'Falhou', tone: 'danger', icon: 'error' },
  timeout: { label: 'Sem resposta', tone: 'warning', icon: 'unknown' },
};

export const intentLabels: Record<MessageIntent, string> = {
  SHOW_PRICES: 'Pediu tabela',
  SHOW_PAYMENT_METHODS: 'Métodos de pagamento',
  CREATE_ORDER: 'Novo pedido',
  PROVIDE_DESTINATION: 'Número de destino',
  PAYMENT_PROOF: 'Comprovativo',
  PAYMENT_STATUS: 'Estado do pagamento',
  SUPPORT: 'Suporte',
  UNKNOWN: 'Sem intenção',
};

export const conversationStatusMeta: Record<ConversationStatus, StatusMeta> = {
  bot: { label: 'Bot a responder', tone: 'info', icon: 'bot' },
  needs_human: { label: 'Precisa de si', tone: 'warning', icon: 'user' },
  resolved: { label: 'Resolvida', tone: 'success', icon: 'check' },
};

export const operatorLabels: Record<Operator, string> = {
  vodacom: 'Vodacom',
  movitel: 'Movitel',
  tmcel: 'Tmcel',
};

export const productCategoryMeta: Record<ProductCategory, { label: string; icon: IconName }> = {
  daily: { label: 'Diários', icon: 'bolt' },
  weekly: { label: 'Semanais', icon: 'calendar' },
  monthly: { label: 'Mensais', icon: 'calendar' },
  unlimited: { label: 'Ilimitados', icon: 'data' },
};

export const severityTone: Record<Severity, Tone> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
};

export const roleLabels: Record<UserRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  operator: 'Operador',
};

export const planLabels: Record<TenantPlan, string> = {
  starter: 'Plano Starter',
  pro: 'Plano Pro',
  business: 'Plano Business',
};

export const notificationKindIcon: Record<NotificationKind, IconName> = {
  activation: 'bolt',
  order: 'orders',
  payment: 'payments',
  device: 'devices',
  sim: 'sim',
  whatsapp: 'whatsapp',
  system: 'bot',
};
