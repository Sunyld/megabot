import type { ChatMessage, Conversation, WhatsAppConnection, WhatsAppGroup } from '@/types';
import { formatPhone } from '@/utils/format';
import { buildPriceTable } from '@/utils/priceTable';

import { addSeconds, ago, TENANT_ID } from './helpers';
import { mockProducts } from './products';
import { groupNames, mockOrders, mockPayments, sellerWallets } from './scenario';

export const priceTableText = buildPriceTable(mockProducts, {
  storeName: 'MegaBot Demo',
  paymentAccounts: [
    { label: 'e-Mola', account: sellerWallets.emola.account },
    { label: 'M-Pesa', account: sellerWallets.mpesa.account },
  ],
});

export const mockWhatsAppConnection: WhatsAppConnection = {
  tenantId: TENANT_ID,
  status: 'connected',
  phone: '+258 85 210 4477',
  displayName: 'MegaBot',
  connectedSince: ago({ days: 3, hours: 4 }),
  lastEventAt: ago({ seconds: 12 }),
  groupsMonitored: 4,
  messagesProcessed: 1284,
  ordersCreated: 84,
  automationRate: 0.96,
};

export const mockGroups: WhatsAppGroup[] = [
  { id: 'grp_01', tenantId: TENANT_ID, name: groupNames[0], members: 214, monitored: true, ordersToday: 11, lastMessageAt: ago({ minutes: 1 }) },
  { id: 'grp_02', tenantId: TENANT_ID, name: groupNames[1], members: 58, monitored: true, ordersToday: 6, lastMessageAt: ago({ minutes: 6 }) },
  { id: 'grp_03', tenantId: TENANT_ID, name: groupNames[2], members: 187, monitored: true, ordersToday: 7, lastMessageAt: ago({ minutes: 3 }) },
  { id: 'grp_04', tenantId: TENANT_ID, name: groupNames[3], members: 96, monitored: true, ordersToday: 5, lastMessageAt: ago({ minutes: 5 }) },
  { id: 'grp_05', tenantId: TENANT_ID, name: 'Família & Amigos', members: 23, monitored: false, ordersToday: 0, lastMessageAt: ago({ hours: 2 }) },
];

const orderByCode = (code: string) => {
  const order = mockOrders.find((o) => o.code === code);
  if (!order) throw new Error(`Unknown mock order ${code}`);
  return order;
};

const eventAt = (code: string, type: string) =>
  orderByCode(code).events.find((e) => e.type === type)?.at ?? orderByCode(code).createdAt;

let seq = 0;
const msg = (direction: ChatMessage['direction'], text: string, at: string, intent?: ChatMessage['intent']): ChatMessage => ({
  id: `msg_${++seq}`,
  direction,
  text,
  at,
  intent,
});

function flagshipConversation(): Conversation {
  const order = orderByCode('ORD-92831');
  const payment = mockPayments.find((p) => p.id === order.paymentId);
  const t0 = order.createdAt;
  return {
    id: 'cnv_92831',
    tenantId: TENANT_ID,
    customerName: order.customer.name,
    customerPhone: order.customer.whatsapp,
    groupName: order.channel.name,
    status: 'resolved',
    unread: 0,
    orderId: order.id,
    orderCode: order.code,
    lastMessageAt: eventAt('ORD-92831', 'customer_notified'),
    messages: [
      msg('in', 'tabela', addSeconds(t0, -40), 'SHOW_PRICES'),
      msg('out', priceTableText, addSeconds(t0, -38)),
      msg('in', '1250', addSeconds(t0, -2), 'CREATE_ORDER'),
      msg('out', `🧾 *PEDIDO ${order.code}*\n\n📦 Produto: 1250 MB\n💰 Preço: 30 MT\n📱 Número: pendente\n\nEnvie o número que vai receber o pacote.`, t0),
      msg('in', '840745232', eventAt('ORD-92831', 'destination_provided'), 'PROVIDE_DESTINATION'),
      msg('out', `✅ Número registado: ${formatPhone('840745232')}\n\n💳 Envie *30 MT* para:\n▪️ e-Mola: ${sellerWallets.emola.account}\n▪️ M-Pesa: ${sellerWallets.mpesa.account}\n\nDepois envie o comprovativo aqui.`, addSeconds(eventAt('ORD-92831', 'destination_provided'), 2)),
      msg('in', payment?.proof?.rawText ?? '', eventAt('ORD-92831', 'payment_proof_received'), 'PAYMENT_PROOF'),
      msg('out', '⏳ Comprovativo recebido. A confirmar o pagamento…', addSeconds(eventAt('ORD-92831', 'payment_proof_received'), 2)),
      msg('system', 'Pagamento confirmado por regras · failover para Worker 02', eventAt('ORD-92831', 'payment_confirmed')),
      msg('out', `✅ Pagamento confirmado.\n\n📦 Pacote: 1250 MB\n📱 Número: ${formatPhone('840745232')}\n\n✅ Pacote ativado com sucesso.`, eventAt('ORD-92831', 'customer_notified')),
      msg('in', 'Obrigado 🙏🏾 já recebi', addSeconds(eventAt('ORD-92831', 'customer_notified'), 50), 'UNKNOWN'),
    ],
  };
}

function reviewConversation(): Conversation {
  const order = orderByCode('ORD-92835');
  const payment = mockPayments.find((p) => p.id === order.paymentId);
  const t0 = order.createdAt;
  const proofAt = eventAt('ORD-92835', 'payment_proof_received');
  return {
    id: 'cnv_92835',
    tenantId: TENANT_ID,
    customerName: order.customer.name,
    customerPhone: order.customer.whatsapp,
    groupName: order.channel.name,
    status: 'needs_human',
    unread: 2,
    orderId: order.id,
    orderCode: order.code,
    lastMessageAt: addSeconds(proofAt, 90),
    messages: [
      msg('in', 'Boa tarde, quero 1250MB', t0, 'CREATE_ORDER'),
      msg('out', `🧾 *PEDIDO ${order.code}*\n\n📦 Produto: 1250 MB\n💰 Preço: 30 MT\n📱 Número: pendente\n\nEnvie o número que vai receber o pacote.`, addSeconds(t0, 2)),
      msg('in', 'Para este mesmo número', addSeconds(t0, 30), 'PROVIDE_DESTINATION'),
      msg('out', `✅ Número registado: ${formatPhone('842200154')}\n\n💳 Envie *30 MT* e depois o comprovativo.`, addSeconds(t0, 35)),
      msg('in', payment?.proof?.rawText ?? '', proofAt, 'PAYMENT_PROOF'),
      msg('system', 'Valor recebido (25 MT) diferente do preço (30 MT) · encaminhado para revisão humana', addSeconds(proofAt, 7)),
      msg('out', '⚠️ Recebemos o comprovativo, mas o valor é diferente do preço do pacote. Um atendente vai verificar em breve.', addSeconds(proofAt, 8)),
      msg('in', 'Só tinha 25, pode mandar mesmo assim? 🙏🏾', addSeconds(proofAt, 60), 'SUPPORT'),
      msg('in', 'Estou à espera', addSeconds(proofAt, 90), 'PAYMENT_STATUS'),
    ],
  };
}

function awaitingPaymentConversation(): Conversation {
  const order = orderByCode('ORD-92837');
  const payment = mockPayments.find((p) => p.id === order.paymentId);
  const t0 = order.createdAt;
  const proofAt = eventAt('ORD-92837', 'payment_proof_received');
  return {
    id: 'cnv_92837',
    tenantId: TENANT_ID,
    customerName: order.customer.name,
    customerPhone: order.customer.whatsapp,
    groupName: order.channel.name,
    status: 'bot',
    unread: 0,
    orderId: order.id,
    orderCode: order.code,
    lastMessageAt: addSeconds(proofAt, 2),
    messages: [
      msg('in', 'Tem pacote semanal de 5GB?', addSeconds(t0, -20), 'SHOW_PRICES'),
      msg('out', '✅ Sim! *5 GB Semanal* → 150 MT (válido 7 dias).\nQuer encomendar?', addSeconds(t0, -18)),
      msg('in', 'Sim quero', t0, 'CREATE_ORDER'),
      msg('out', `🧾 *PEDIDO ${order.code}*\n\n📦 Produto: 5 GB Semanal\n💰 Preço: 150 MT\n📱 Número: pendente\n\nEnvie o número que vai receber o pacote.`, addSeconds(t0, 2)),
      msg('in', '846112233', eventAt('ORD-92837', 'destination_provided'), 'PROVIDE_DESTINATION'),
      msg('out', `✅ Número registado: ${formatPhone('846112233')}\n\n💳 Envie *150 MT* e depois o comprovativo.`, addSeconds(eventAt('ORD-92837', 'destination_provided'), 2)),
      msg('in', payment?.proof?.rawText ?? '', proofAt, 'PAYMENT_PROOF'),
      msg('out', '⏳ Comprovativo recebido. A aguardar a confirmação da carteira…', addSeconds(proofAt, 2)),
    ],
  };
}

function unknownConversation(): Conversation {
  const order = orderByCode('ORD-92834');
  const t0 = order.createdAt;
  const verifyAt = eventAt('ORD-92834', 'verification_started');
  return {
    id: 'cnv_92834',
    tenantId: TENANT_ID,
    customerName: order.customer.name,
    customerPhone: order.customer.whatsapp,
    groupName: order.channel.name,
    status: 'bot',
    unread: 1,
    orderId: order.id,
    orderCode: order.code,
    lastMessageAt: addSeconds(verifyAt, 64),
    messages: [
      msg('in', '2048', t0, 'CREATE_ORDER'),
      msg('out', `🧾 *PEDIDO ${order.code}*\n\n📦 Produto: 2048 MB\n💰 Preço: 45 MT\n📱 Número: pendente`, addSeconds(t0, 2)),
      msg('in', '845671230', eventAt('ORD-92834', 'destination_provided'), 'PROVIDE_DESTINATION'),
      msg('out', '✅ Pagamento confirmado. A ativar o seu pacote…', eventAt('ORD-92834', 'payment_confirmed')),
      msg('in', 'Ainda não chegou', addSeconds(verifyAt, 60), 'PAYMENT_STATUS'),
      msg('out', '🔎 Estamos a confirmar a ativação junto da operadora. Receberá uma mensagem assim que estiver concluído.', addSeconds(verifyAt, 64)),
    ],
  };
}

function destinationConversation(): Conversation {
  const order = orderByCode('ORD-92838');
  const t0 = order.createdAt;
  return {
    id: 'cnv_92838',
    tenantId: TENANT_ID,
    customerName: order.customer.name,
    customerPhone: order.customer.whatsapp,
    groupName: order.channel.name,
    status: 'bot',
    unread: 0,
    orderId: order.id,
    orderCode: order.code,
    lastMessageAt: addSeconds(t0, 2),
    messages: [
      msg('in', 'quero 1gb', t0, 'CREATE_ORDER'),
      msg('out', `🧾 *PEDIDO ${order.code}*\n\n📦 Produto: 1024 MB\n💰 Preço: 24 MT\n📱 Número: pendente\n\nEnvie o número que vai receber o pacote.`, addSeconds(t0, 2)),
    ],
  };
}

function pricesOnlyConversation(): Conversation {
  const t0 = ago({ minutes: 31 });
  return {
    id: 'cnv_prices',
    tenantId: TENANT_ID,
    customerName: 'Osvaldo Tivane',
    customerPhone: '+258841870023',
    groupName: groupNames[2],
    status: 'resolved',
    unread: 0,
    orderId: null,
    orderCode: null,
    lastMessageAt: addSeconds(t0, 70),
    messages: [
      msg('in', 'tabela', t0, 'SHOW_PRICES'),
      msg('out', priceTableText, addSeconds(t0, 2)),
      msg('in', 'Aceitam M-Pesa?', addSeconds(t0, 60), 'SHOW_PAYMENT_METHODS'),
      msg('out', `✅ Sim! Aceitamos:\n▪️ e-Mola: ${sellerWallets.emola.account}\n▪️ M-Pesa: ${sellerWallets.mpesa.account}`, addSeconds(t0, 62)),
      msg('in', 'Ok obrigado', addSeconds(t0, 70), 'UNKNOWN'),
    ],
  };
}

export const mockConversations: Conversation[] = [
  destinationConversation(),
  reviewConversation(),
  awaitingPaymentConversation(),
  unknownConversation(),
  flagshipConversation(),
  pricesOnlyConversation(),
].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
