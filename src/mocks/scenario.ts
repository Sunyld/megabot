/**
 * Builds one coherent business day for the demo tenant (MegaBot Demo):
 * orders, the payments that paid for them and the activation tasks that
 * delivered them — all cross-referenced, so every screen tells the same story.
 *
 * A handful of hand-written "featured" orders cover every interesting state
 * (failover, UNKNOWN verification, payment under review, failures…). The rest
 * are generated deterministically to fill the day.
 */
import type {
  ActivationTask,
  Order,
  OrderEvent,
  OrderEventType,
  OrderStatus,
  Payment,
  PaymentMethod,
  ReconciliationCheck,
  TaskAttempt,
  TaskStatus,
} from '@/types';
import { describeUssdFlow, ussdValuesFor } from '@/utils/ussd';

import {
  addSeconds,
  ago,
  createRandom,
  emolaTransactionId,
  formatSmsDate,
  MOCK_NOW,
  mpesaTransactionId,
  startOfToday,
  TENANT_ID,
} from './helpers';
import { mockProducts } from './products';

// ─── Seller wallets ──────────────────────────────────────────────────────────

const ACCOUNT_HOLDER = 'ARLINDO DA MARGARIDA ABDUL AMANDIO AUGUSTO';

export const sellerWallets: Record<PaymentMethod, { account: string; deviceId: string; deviceName: string; simSlot: 1 | 2 }> = {
  emola: { account: '868073501', deviceId: 'dev_04', deviceName: 'Worker 04', simSlot: 2 },
  mpesa: { account: '845550218', deviceId: 'dev_01', deviceName: 'Device Principal', simSlot: 2 },
  mkesh: { account: '823456789', deviceId: 'dev_01', deviceName: 'Device Principal', simSlot: 1 },
};

// ─── Message templates ───────────────────────────────────────────────────────

function proofText(method: PaymentMethod, tx: string, amount: number, at: string) {
  const { date, time } = formatSmsDate(at);
  const { account } = sellerWallets[method];
  if (method === 'mpesa') {
    return `Confirmado ${tx}. Transferiste ${amount.toFixed(2)}MT e a taxa foi de 0.00MT para ${account} - ${ACCOUNT_HOLDER} aos ${date} as ${time}.`;
  }
  return `ID da transacao ${tx}. Transferiste ${amount.toFixed(2)}MT para conta ${account}, nome: ${ACCOUNT_HOLDER} as ${time} de ${date}. Taxa: 0.00MT.`;
}

function walletText(method: PaymentMethod, tx: string, amount: number, payer: string, payerName: string, at: string) {
  const { date, time } = formatSmsDate(at);
  if (method === 'mpesa') {
    return `Confirmado ${tx}. Recebeste ${amount.toFixed(2)}MT de ${payer} - ${payerName.toUpperCase()} aos ${date} as ${time}.`;
  }
  return `ID da transacao ${tx}. Recebeste ${amount.toFixed(2)}MT da conta ${payer}, nome: ${payerName.toUpperCase()} as ${time} de ${date}.`;
}

// ─── Building blocks ─────────────────────────────────────────────────────────

const customers = [
  'Aida Cossa', 'Joana Macuácua', 'Gildo Nhantumbo', 'Faizal Amade', 'Rosa Langa',
  'Dércio Manhiça', 'Neusa Bila', 'Stélio Muianga', 'Arsénio Cumbe', 'Lurdes Timana',
  'Yolanda Matsinhe', 'Custódio Nhaca', 'Sheila Mabote', 'Benedito Zandamela',
  'Anabela Chirindza', 'Osvaldo Tivane', 'Marta Novela', 'Zacarias Mabunda',
];

export const groupNames = ['MegaBot Megas 🔥', 'MegaBot VIP', 'Megas Baratos Maputo', 'MegaBot Matola'];

const workers = [
  { deviceId: 'dev_01', deviceName: 'Device Principal', simId: 'sim_01_1', simSlot: 1 as const },
  { deviceId: 'dev_01', deviceName: 'Device Principal', simId: 'sim_01_2', simSlot: 2 as const },
  { deviceId: 'dev_02', deviceName: 'Worker 02', simId: 'sim_02_1', simSlot: 1 as const },
  { deviceId: 'dev_02', deviceName: 'Worker 02', simId: 'sim_02_2', simSlot: 2 as const },
  { deviceId: 'dev_03', deviceName: 'Worker 03', simId: 'sim_03_1', simSlot: 1 as const },
  { deviceId: 'dev_03', deviceName: 'Worker 03', simId: 'sim_03_2', simSlot: 2 as const },
  { deviceId: 'dev_04', deviceName: 'Worker 04', simId: 'sim_04_1', simSlot: 1 as const },
];

type Worker = (typeof workers)[number];

const product = (id: string) => {
  const found = mockProducts.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown mock product ${id}`);
  return found;
};

const matchChecks = (tx: string, amount: number, account: string, at: string): ReconciliationCheck[] => {
  const { date, time } = formatSmsDate(at);
  return [
    { key: 'transaction_id', expected: tx, actual: tx, result: 'match' },
    { key: 'amount', expected: `${amount} MT`, actual: `${amount} MT`, result: 'match' },
    { key: 'account', expected: account, actual: account, result: 'match' },
    { key: 'datetime', expected: `${date} ${time}`, actual: `${date} ${time}`, result: 'match' },
    { key: 'duplicate', result: 'match' },
  ];
};

function events(orderCode: string, steps: [OrderEventType, string, string?][]): OrderEvent[] {
  return steps.map(([type, at, description], i) => ({ id: `${orderCode}-e${i}`, type, at, description }));
}

type Draft = {
  code: string;
  productId: string;
  customer: string;
  phone: string;
  destination: string | null;
  group: string;
  createdAt: string;
  method: PaymentMethod;
  txSuffix: string;
};

const orders: Order[] = [];
const payments: Payment[] = [];
const tasks: ActivationTask[] = [];

function txFor(draft: Draft, paidAt: string) {
  return draft.method === 'emola'
    ? emolaTransactionId(paidAt, draft.txSuffix)
    : mpesaTransactionId(`${draft.code}${draft.txSuffix}`);
}

function addPayment(draft: Draft, orderId: string | null, paidAt: string, amount: number, overrides: Partial<Payment> = {}) {
  const tx = overrides.transactionId ?? txFor(draft, paidAt);
  const wallet = sellerWallets[draft.method];
  const payment: Payment = {
    id: `pay_${draft.code.replace('ORD-', '')}`,
    tenantId: TENANT_ID,
    transactionId: tx,
    amount,
    method: draft.method,
    status: 'confirmed',
    payerName: draft.customer,
    payerNumber: draft.phone.replace('+258', ''),
    account: wallet.account,
    paidAt,
    receivedAt: addSeconds(paidAt, 25),
    orderId,
    orderCode: orderId ? draft.code : null,
    proof: {
      rawText: proofText(draft.method, tx, amount, paidAt),
      receivedAt: addSeconds(paidAt, 25),
      extractedBy: 'ai',
      confidence: 0.97,
      fields: {
        transactionId: tx,
        amount,
        account: wallet.account,
        datetime: paidAt,
        destination: draft.destination,
      },
    },
    walletEvent: {
      rawText: walletText(draft.method, tx, amount, draft.phone.replace('+258', ''), draft.customer, paidAt),
      receivedAt: addSeconds(paidAt, 4),
      deviceId: wallet.deviceId,
      deviceName: wallet.deviceName,
      simSlot: wallet.simSlot,
    },
    checks: matchChecks(tx, amount, wallet.account, paidAt),
    confirmedBy: 'rules',
    ...overrides,
  };
  payments.push(payment);
  return payment;
}

function addTask(
  draft: Draft,
  orderId: string,
  createdAt: string,
  status: TaskStatus,
  attempts: Omit<TaskAttempt, 'id'>[],
  operatorResponse?: string
) {
  const p = product(draft.productId);
  const task: ActivationTask = {
    id: `tsk_${draft.code.replace('ORD-', '')}`,
    tenantId: TENANT_ID,
    code: draft.code.replace('ORD', 'TASK'),
    orderId,
    orderCode: draft.code,
    productName: p.name,
    destination: draft.destination ?? '',
    status,
    ussdCode: p.ussdFlow ? describeUssdFlow(p.ussdFlow, ussdValuesFor(p, draft.destination)) : '',
    attempts: attempts.map((a, i) => ({ ...a, id: `${draft.code}-a${i}` })),
    operatorResponse,
    createdAt,
    updatedAt: attempts.at(-1)?.at ?? createdAt,
  };
  tasks.push(task);
  return task;
}

function attempt(worker: Worker, result: TaskAttempt['result'], at: string, extra: Partial<TaskAttempt> = {}) {
  return { ...worker, result, at, ...extra };
}

function addOrder(draft: Draft, status: OrderStatus, orderEvents: OrderEvent[], extra: Partial<Order> = {}) {
  const p = product(draft.productId);
  const order: Order = {
    id: `ord_${draft.code.replace('ORD-', '')}`,
    tenantId: TENANT_ID,
    code: draft.code,
    productId: p.id,
    productName: p.name,
    price: p.price,
    destination: draft.destination,
    customer: { name: draft.customer, whatsapp: draft.phone },
    channel: { type: 'group', name: draft.group },
    status,
    paymentId: null,
    transactionId: null,
    taskId: null,
    createdAt: draft.createdAt,
    updatedAt: orderEvents.at(-1)?.at ?? draft.createdAt,
    events: orderEvents,
    ...extra,
  };
  orders.push(order);
  return order;
}

/** A normal, fully automated sale: paid, activated on the first SIM tried. */
function completedSale(draft: Draft, worker: Worker, activationSeconds: number) {
  const t0 = draft.createdAt;
  const paidAt = addSeconds(t0, 95);
  const confirmedAt = addSeconds(paidAt, 30);
  const executedAt = addSeconds(confirmedAt, 4);
  const activatedAt = addSeconds(executedAt, activationSeconds);
  const orderId = `ord_${draft.code.replace('ORD-', '')}`;

  const payment = addPayment(draft, orderId, paidAt, product(draft.productId).price);
  const task = addTask(draft, orderId, confirmedAt, 'SUCCESS', [
    attempt(worker, 'success', executedAt, { durationMs: activationSeconds * 1000 }),
  ], 'Pacote ativado com sucesso.');

  return addOrder(
    draft,
    'completed',
    events(draft.code, [
      ['created', t0],
      ['destination_provided', addSeconds(t0, 40)],
      ['payment_proof_received', addSeconds(paidAt, 25), `${payment.transactionId}`],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), task.code],
      ['device_selected', addSeconds(confirmedAt, 2), `${worker.deviceName} · SIM ${worker.simSlot}`],
      ['ussd_executed', executedAt],
      ['activated', activatedAt],
      ['customer_notified', addSeconds(activatedAt, 2)],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId, taskId: task.id }
  );
}

// ─── Featured orders (today) ─────────────────────────────────────────────────

const minutesAgo = (minutes: number) => ago({ minutes });

// Awaiting destination number.
{
  const draft: Draft = {
    code: 'ORD-92838', productId: 'prd_1024', customer: 'Célia Sitoe', phone: '+258845123987',
    destination: null, group: groupNames[0], createdAt: minutesAgo(2), method: 'emola', txSuffix: 'k20411',
  };
  addOrder(draft, 'awaiting_destination', events(draft.code, [['created', draft.createdAt]]));
}

// Awaiting payment — proof received, wallet SMS not arrived yet (payment pending).
{
  const draft: Draft = {
    code: 'ORD-92837', productId: 'prd_w5', customer: 'Hélio Tembe', phone: '+258846112233',
    destination: '846112233', group: groupNames[1], createdAt: minutesAgo(7), method: 'mpesa', txSuffix: 'x1',
  };
  const orderId = 'ord_92837';
  const paidAt = minutesAgo(5);
  const payment = addPayment(draft, orderId, paidAt, 150, {
    status: 'pending',
    walletEvent: null,
    confirmedBy: undefined,
    checks: [
      { key: 'transaction_id', expected: txFor(draft, paidAt), result: 'missing' },
      { key: 'amount', expected: '150 MT', actual: '150 MT', result: 'match' },
      { key: 'account', expected: sellerWallets.mpesa.account, actual: sellerWallets.mpesa.account, result: 'match' },
      { key: 'datetime', result: 'missing' },
      { key: 'duplicate', result: 'match' },
    ],
  });
  addOrder(
    draft,
    'awaiting_payment',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 50)],
      ['payment_proof_received', addSeconds(paidAt, 25), 'A aguardar SMS de confirmação da carteira'],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId }
  );
}

// Paid, activation queued.
{
  const draft: Draft = {
    code: 'ORD-92833', productId: 'prd_400', customer: 'Faizal Amade', phone: '+258847300912',
    destination: '847300912', group: groupNames[2], createdAt: minutesAgo(4), method: 'emola', txSuffix: 'h77120',
  };
  const orderId = 'ord_92833';
  const paidAt = minutesAgo(2);
  const confirmedAt = addSeconds(paidAt, 30);
  const payment = addPayment(draft, orderId, paidAt, 10);
  const task = addTask(draft, orderId, confirmedAt, 'QUEUED', []);
  addOrder(
    draft,
    'paid',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 30)],
      ['payment_proof_received', addSeconds(paidAt, 25), payment.transactionId],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), `${task.code} · na fila`],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId, taskId: task.id }
  );
}

// Processing — USSD executing right now on Worker 04.
{
  const draft: Draft = {
    code: 'ORD-92832', productId: 'prd_1250', customer: 'Aida Cossa', phone: '+258843998120',
    destination: '843998120', group: groupNames[0], createdAt: minutesAgo(5), method: 'mpesa', txSuffix: 'p2',
  };
  const orderId = 'ord_92832';
  const paidAt = minutesAgo(3);
  const confirmedAt = addSeconds(paidAt, 30);
  const payment = addPayment(draft, orderId, paidAt, 30);
  const task = addTask(draft, orderId, confirmedAt, 'EXECUTING', [
    attempt(workers[6], 'running', addSeconds(confirmedAt, 3)),
  ]);
  addOrder(
    draft,
    'processing',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 25)],
      ['payment_proof_received', addSeconds(paidAt, 25), payment.transactionId],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), task.code],
      ['device_selected', addSeconds(confirmedAt, 2), 'Worker 04 · SIM 1'],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId, taskId: task.id }
  );
}

// Completed on the first try.
completedSale(
  {
    code: 'ORD-92836', productId: 'prd_800', customer: 'Rosa Langa', phone: '+258846550781',
    destination: '846550781', group: groupNames[3], createdAt: minutesAgo(6), method: 'emola', txSuffix: 'b10934',
  },
  workers[0],
  31
);

// Payment under review — customer paid less than the package price.
{
  const draft: Draft = {
    code: 'ORD-92835', productId: 'prd_1250', customer: 'Gildo Nhantumbo', phone: '+258842200154',
    destination: '842200154', group: groupNames[0], createdAt: minutesAgo(10), method: 'emola', txSuffix: 'c44018',
  };
  const orderId = 'ord_92835';
  const paidAt = minutesAgo(8);
  const tx = txFor(draft, paidAt);
  const { date, time } = formatSmsDate(paidAt);
  const payment = addPayment(draft, orderId, paidAt, 25, {
    status: 'review',
    confirmedBy: undefined,
    reviewReason: 'O valor recebido (25 MT) é inferior ao preço do pacote (30 MT).',
    checks: [
      { key: 'transaction_id', expected: tx, actual: tx, result: 'match' },
      { key: 'amount', expected: '30 MT', actual: '25 MT', result: 'mismatch' },
      { key: 'account', expected: sellerWallets.emola.account, actual: sellerWallets.emola.account, result: 'match' },
      { key: 'datetime', expected: `${date} ${time}`, actual: `${date} ${time}`, result: 'match' },
      { key: 'duplicate', result: 'match' },
    ],
  });
  addOrder(
    draft,
    'payment_review',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 35)],
      ['payment_proof_received', addSeconds(paidAt, 25), payment.transactionId],
      ['payment_review', addSeconds(paidAt, 32), 'Valor diferente do preço — intervenção humana necessária'],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId }
  );
}

// UNKNOWN — USSD submitted but no confirmation from the operator. Verifying.
{
  const draft: Draft = {
    code: 'ORD-92834', productId: 'prd_2048', customer: 'Joana Macuácua', phone: '+258845671230',
    destination: '845671230', group: groupNames[2], createdAt: minutesAgo(12), method: 'mpesa', txSuffix: 'u9',
  };
  const orderId = 'ord_92834';
  const paidAt = minutesAgo(10);
  const confirmedAt = addSeconds(paidAt, 30);
  const executedAt = addSeconds(confirmedAt, 4);
  const payment = addPayment(draft, orderId, paidAt, 45);
  const task = addTask(draft, orderId, confirmedAt, 'UNKNOWN', [
    attempt(workers[2], 'timeout', executedAt, {
      durationMs: 30_000,
      reason: 'USSD enviado, sem resposta da operadora em 30 s',
    }),
  ]);
  addOrder(
    draft,
    'verifying',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 45)],
      ['payment_proof_received', addSeconds(paidAt, 25), payment.transactionId],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), task.code],
      ['device_selected', addSeconds(confirmedAt, 2), 'Worker 02 · SIM 1'],
      ['ussd_executed', executedAt, 'Sem confirmação da operadora'],
      ['verification_started', addSeconds(executedAt, 31), 'A confirmar ativação antes de repetir'],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId, taskId: task.id }
  );
}

// Flagship: the order from the product brief, delivered through failover.
{
  const draft: Draft = {
    code: 'ORD-92831', productId: 'prd_1250', customer: 'Nelson Mucavele', phone: '+258840745232',
    destination: '840745232', group: groupNames[0], createdAt: minutesAgo(16), method: 'emola', txSuffix: 'i58382',
  };
  const orderId = 'ord_92831';
  const paidAt = minutesAgo(14);
  const confirmedAt = addSeconds(paidAt, 28);
  const payment = addPayment(draft, orderId, paidAt, 30);
  const t1 = addSeconds(confirmedAt, 2);
  const t2 = addSeconds(t1, 1);
  const t3 = addSeconds(t2, 1);
  const activatedAt = addSeconds(t3, 34);
  const task = addTask(draft, orderId, confirmedAt, 'SUCCESS', [
    attempt(workers[0], 'skipped_unavailable', t1, { reason: 'SIM ocupado com outra ativação' }),
    attempt(workers[1], 'skipped_unavailable', t2, { reason: 'SIM ocupado com outra ativação' }),
    attempt(workers[2], 'success', t3, { durationMs: 34_000 }),
  ], 'Pacote ativado com sucesso.');
  addOrder(
    draft,
    'completed',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 38)],
      ['payment_proof_received', addSeconds(paidAt, 22), payment.transactionId],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), task.code],
      ['failover', t2, 'Device Principal: SIM 1 e SIM 2 indisponíveis'],
      ['device_selected', t3, 'Worker 02 · SIM 1'],
      ['ussd_executed', addSeconds(t3, 1)],
      ['activated', activatedAt],
      ['customer_notified', addSeconds(activatedAt, 2)],
    ]),
    { paymentId: payment.id, transactionId: payment.transactionId, taskId: task.id }
  );
}

// Failed — operator rejected the destination number (needs the seller).
{
  const draft: Draft = {
    code: 'ORD-92830', productId: 'prd_600', customer: 'Dércio Manhiça', phone: '+258847123450',
    destination: '84712345', group: groupNames[1], createdAt: minutesAgo(24), method: 'emola', txSuffix: 'f30551',
  };
  const orderId = 'ord_92830';
  const paidAt = minutesAgo(22);
  const confirmedAt = addSeconds(paidAt, 30);
  const executedAt = addSeconds(confirmedAt, 3);
  const payment = addPayment(draft, orderId, paidAt, 15);
  const task = addTask(draft, orderId, confirmedAt, 'FAILED', [
    attempt(workers[1], 'failed', executedAt, {
      durationMs: 6_000,
      reason: 'Operadora: número de destino inválido',
    }),
  ], 'Numero invalido. Verifique e tente novamente.');
  addOrder(
    draft,
    'failed',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 30)],
      ['payment_proof_received', addSeconds(paidAt, 25), payment.transactionId],
      ['payment_confirmed', confirmedAt, 'Regras: ID, valor, conta e data coincidem'],
      ['task_created', addSeconds(confirmedAt, 1), task.code],
      ['device_selected', addSeconds(confirmedAt, 2), 'Device Principal · SIM 2'],
      ['ussd_executed', executedAt],
      ['failed', addSeconds(executedAt, 6), 'Número de destino inválido (8 dígitos)'],
    ]),
    {
      paymentId: payment.id,
      transactionId: payment.transactionId,
      taskId: task.id,
      failureReason: 'A operadora recusou o número de destino (84712345). Confirme o número com o cliente e tente novamente.',
    }
  );
}

// ─── Generated history ───────────────────────────────────────────────────────

const random = createRandom(92831);

const productWeights = mockProducts
  .filter((p) => p.status === 'ACTIVE')
  .map((p) => ({
    value: p.id,
    weight: p.category === 'daily' ? (p.popular ? 9 : 5) : p.category === 'weekly' ? 2 : 0.7,
  }));

const phoneFor = () => `84${random.int(1, 9)}${String(random.int(0, 999999)).padStart(6, '0')}`;

function generate(count: number, firstCode: number, fromMs: number, toMs: number, workerPool: Worker[]) {
  for (let i = 0; i < count; i++) {
    const code = `ORD-${firstCode - i}`;
    const createdMs = toMs - ((toMs - fromMs) * (i + random.next() * 0.6)) / count;
    const destination = phoneFor();
    const draft: Draft = {
      code,
      productId: random.weighted(productWeights),
      customer: random.pick(customers),
      phone: `+258${destination}`,
      destination,
      group: random.pick(groupNames),
      createdAt: new Date(createdMs).toISOString(),
      method: random.next() < 0.6 ? 'emola' : 'mpesa',
      txSuffix: `${String.fromCharCode(97 + random.int(0, 25))}${random.int(10000, 99999)}`,
    };
    completedSale(draft, random.pick(workerPool), random.int(24, 46));
  }
}

const todayStart = startOfToday();
// Keep generated sales inside today, before the featured ones.
const todayWindowEnd = Math.max(todayStart + 20 * 60_000, MOCK_NOW - 26 * 60_000);
const todayWindowStart = Math.max(todayStart + 60_000, todayWindowEnd - 12 * 60 * 60_000);

generate(22, 92829, todayWindowStart, todayWindowEnd, workers);

// Yesterday: a smaller, quieter tail (includes one cancelled order).
const yesterdayEnd = todayStart - 2 * 60 * 60_000;
generate(9, 92807, yesterdayEnd - 11 * 60 * 60_000, yesterdayEnd, workers.filter((w) => w.deviceId !== 'dev_02'));
{
  const draft: Draft = {
    code: 'ORD-92798', productId: 'prd_w2', customer: 'Marta Novela', phone: '+258845009911',
    destination: '845009911', group: groupNames[3], createdAt: new Date(yesterdayEnd - 12 * 60 * 60_000).toISOString(),
    method: 'emola', txSuffix: 'z00000',
  };
  addOrder(
    draft,
    'cancelled',
    events(draft.code, [
      ['created', draft.createdAt],
      ['destination_provided', addSeconds(draft.createdAt, 60)],
      ['cancelled', addSeconds(draft.createdAt, 3 * 60 * 60), 'Sem pagamento após 3 horas'],
    ])
  );
}

// A rejected proof: reuses the flagship transaction ID (duplicate).
{
  const flagship = payments.find((p) => p.orderCode === 'ORD-92831');
  if (flagship) {
    const at = minutesAgo(9);
    payments.push({
      ...flagship,
      id: 'pay_dup_01',
      status: 'rejected',
      payerName: 'Stélio Muianga',
      payerNumber: '849112004',
      receivedAt: at,
      orderId: null,
      orderCode: null,
      walletEvent: null,
      confirmedBy: undefined,
      proof: flagship.proof && { ...flagship.proof, receivedAt: at, confidence: 0.94 },
      checks: [
        { key: 'transaction_id', expected: flagship.transactionId, actual: flagship.transactionId, result: 'match' },
        { key: 'amount', expected: '30 MT', actual: '30 MT', result: 'match' },
        { key: 'account', expected: flagship.account, actual: flagship.account, result: 'match' },
        { key: 'datetime', result: 'match' },
        { key: 'duplicate', expected: 'Não utilizado', actual: 'Já utilizado em ORD-92831', result: 'mismatch' },
      ],
      reviewReason: 'Este ID de transação já foi utilizado no pedido ORD-92831.',
    });
  }
}

const byNewest = <T extends { createdAt?: string; receivedAt?: string }>(a: T, b: T) =>
  (b.createdAt ?? b.receivedAt ?? '').localeCompare(a.createdAt ?? a.receivedAt ?? '');

export const mockOrders: Order[] = orders.sort(byNewest);
export const mockPayments: Payment[] = payments.sort(byNewest);
export const mockTasks: ActivationTask[] = tasks.sort(byNewest);
