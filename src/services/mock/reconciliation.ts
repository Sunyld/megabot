import { mockUser } from '@/mocks';
import type {
  ID,
  Order,
  PaymentAccountRecord,
  PaymentEventRecord,
  PaymentMatchRecord,
  PaymentProofRecord,
  ReconciliationStatus,
} from '@/types';

import { AppError, type AppErrorReason } from '../errors';
import { normalizePhone } from '../orderRules';
import {
  assertValidAccountInput,
  assertValidAccountUpdate,
  assertValidEventInput,
  assertValidProofInput,
  blockingFailures,
  evaluatePaymentMatch,
  FINAL_PROOF_STATUSES,
  normalizeAccountIdentifier,
  normalizeReviewNote,
  OPEN_PROOF_STATUSES,
  PAYABLE_ORDER_STATUSES,
  reconciliationReasonText,
  resolveMatchWindow,
  type PaymentEvaluation,
} from '../paymentRules';
import type { PaymentAccountsService, PaymentEventsService, PaymentMatchesService, PaymentProofsService } from '../types';
import { db, notFound, ownedBy, request } from './db';
import { transition } from './orders';

/*
 * In-memory financial core with the same deterministic reconciliation as
 * migration 005 (private.reconcile_proof / reconcile_event /
 * apply_payment_decision), so mock mode behaves like the real backend.
 */

/** The demo seller (owner) performs every mock action. */
const ACTOR: ID = mockUser.id;

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();
const cents = (value: number) => Math.round(value * 100);
const conflict = (message: string, reason?: AppErrorReason) => new AppError('CONFLICT', message, { reason });

const findAccount = (tenantId: string, id: ID) =>
  db.paymentAccounts.filter(ownedBy(tenantId)).find((a) => a.id === id) ?? notFound('Conta de pagamento');
const findEvent = (tenantId: string, id: ID) =>
  db.paymentEvents.filter(ownedBy(tenantId)).find((e) => e.id === id) ?? notFound('Movimento');
const findProof = (tenantId: string, id: ID) =>
  db.paymentProofs.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Comprovativo');
const findOrder = (tenantId: string, id: ID) => db.orders.filter(ownedBy(tenantId)).find((o) => o.id === id) ?? notFound('Pedido');

const confirmedMatch = (predicate: (match: PaymentMatchRecord) => boolean) =>
  db.paymentMatches.some((match) => match.status === 'CONFIRMED' && predicate(match));

function evaluate(order: Order, event: PaymentEventRecord, proof: PaymentProofRecord | null): PaymentEvaluation {
  return evaluatePaymentMatch(
    { id: order.id, tenantId: order.tenantId, status: order.status, price: order.price, currency: order.currency, createdAt: order.createdAt },
    event,
    proof,
    {
      account: db.paymentAccounts.find((a) => a.id === event.paymentAccountId) ?? null,
      eventAlreadyUsed: confirmedMatch((m) => m.paymentEventId === event.id),
      orderAlreadyPaid: confirmedMatch((m) => m.orderId === order.id),
      window: resolveMatchWindow(null, event.provider),
    }
  );
}

function setProofStatus(proof: PaymentProofRecord, status: ReconciliationStatus, reason: string | null) {
  if (FINAL_PROOF_STATUSES.includes(proof.status)) return;
  if (proof.status === status && proof.statusReason === reason) return;
  proof.status = status;
  proof.statusReason = reason;
  proof.updatedAt = nowIso();
}

/** Open proof → VERIFYING; none left → back to AWAITING_PAYMENT. Never PAID. */
function syncOrderVerification(order: Order) {
  const open = db.paymentProofs.some((p) => p.orderId === order.id && OPEN_PROOF_STATUSES.includes(p.status));
  if (open && (order.status === 'PENDING' || order.status === 'AWAITING_PAYMENT')) {
    if (order.status === 'PENDING') transition(order, 'AWAITING_PAYMENT');
    transition(order, 'VERIFYING');
  } else if (!open && order.status === 'VERIFYING') {
    transition(order, 'AWAITING_PAYMENT');
  }
}

/** Records a decision; CONFIRMED moves the order to PAID through the state machine. */
function applyDecision(
  order: Order,
  event: PaymentEventRecord,
  proof: PaymentProofRecord | null,
  evaluation: PaymentEvaluation
): PaymentMatchRecord {
  // Re-running an unchanged review does not pile up identical rows.
  let match =
    evaluation.decision === 'CONFIRMED'
      ? undefined
      : db.paymentMatches.find(
          (m) =>
            m.orderId === order.id &&
            m.paymentEventId === event.id &&
            m.paymentProofId === (proof?.id ?? null) &&
            m.status === evaluation.decision &&
            m.reason === evaluation.reason
        );
  if (!match) {
    const at = nowIso();
    match = {
      id: newId('pmt'),
      tenantId: order.tenantId,
      orderId: order.id,
      paymentProofId: proof?.id ?? null,
      paymentEventId: event.id,
      status: evaluation.decision,
      methods: evaluation.methods,
      reason: evaluation.reason,
      checks: evaluation.checks,
      failures: evaluation.failures,
      orderAmount: evaluation.orderAmount,
      eventAmount: evaluation.eventAmount,
      currency: evaluation.currency,
      matchedAt: at,
      matchedBy: ACTOR,
      createdAt: at,
    };
    db.paymentMatches.unshift(match);
    if (match.status === 'CONFIRMED') {
      if (order.status === 'PENDING') transition(order, 'AWAITING_PAYMENT');
      transition(order, 'PAID');
    }
  }
  if (proof) {
    const status: ReconciliationStatus =
      evaluation.decision === 'CONFIRMED' || evaluation.decision === 'DUPLICATE' || evaluation.decision === 'REJECTED'
        ? evaluation.decision
        : 'PENDING_REVIEW';
    setProofStatus(proof, status, evaluation.reason);
  }
  return match;
}

function reconcileProof(proof: PaymentProofRecord): PaymentProofRecord {
  if (FINAL_PROOF_STATUSES.includes(proof.status)) return proof;
  const order = proof.orderId ? db.orders.find((o) => o.id === proof.orderId) : undefined;
  let outcome: [ReconciliationStatus, string] | null = null;

  if (!proof.provider || !proof.transactionId) {
    outcome = ['UNMATCHED', 'TRANSACTION_ID_REQUIRED'];
  } else {
    const events = db.paymentEvents.filter(
      (e) => e.tenantId === proof.tenantId && e.provider === proof.provider && e.transactionId === proof.transactionId
    );
    if (events.length === 0) outcome = ['UNMATCHED', 'NO_EVENT_YET'];
    else if (events.length > 1) outcome = ['PENDING_REVIEW', 'AMBIGUOUS_EVENT'];
    else if (!order) outcome = ['MATCHED', 'ORDER_REQUIRED'];
    else applyDecision(order, events[0], proof, evaluate(order, events[0], proof));
  }

  if (outcome) setProofStatus(proof, ...outcome);
  if (order) syncOrderVerification(order);
  return proof;
}

function reconcileEvent(event: PaymentEventRecord) {
  if (confirmedMatch((m) => m.paymentEventId === event.id)) return;

  // 1. The customer's claim decides first.
  const claims = db.paymentProofs
    .filter(
      (p) =>
        p.tenantId === event.tenantId &&
        p.provider === event.provider &&
        p.transactionId === event.transactionId &&
        OPEN_PROOF_STATUSES.includes(p.status)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (claims.length) {
    claims.forEach(reconcileProof);
    return;
  }

  // 2. Orders with the exact amount inside the time window are candidates.
  const window = resolveMatchWindow(null, event.provider);
  const occurred = Date.parse(event.occurredAt);
  const candidates = db.orders
    .filter(
      (o) =>
        o.tenantId === event.tenantId &&
        PAYABLE_ORDER_STATUSES.includes(o.status) &&
        o.currency === event.currency &&
        cents(o.price) === cents(event.amount) &&
        occurred >= Date.parse(o.createdAt) - window.beforeMinutes * 60_000 &&
        occurred <= Date.parse(o.createdAt) + window.afterMinutes * 60_000 &&
        !confirmedMatch((m) => m.orderId === o.id)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!candidates.length) return;

  // Automatic only for ONE candidate whose phone is the full sender shown by the provider.
  if (candidates.length === 1) {
    const [order] = candidates;
    const sender = normalizePhone(event.senderIdentifier);
    if (sender && sender === normalizePhone(order.destination)) {
      const evaluation = evaluate(order, event, null);
      if (evaluation.decision === 'CONFIRMED') {
        applyDecision(order, event, null, {
          ...evaluation,
          methods: [...evaluation.methods, 'SENDER'],
          checks: { ...evaluation.checks, sender: 'PASS' },
        });
        return;
      }
    }
  }

  candidates.slice(0, 5).forEach((order) =>
    applyDecision(order, event, null, {
      decision: 'PENDING_REVIEW',
      reason: candidates.length === 1 ? 'SENDER_NOT_VERIFIED' : 'MULTIPLE_CANDIDATES',
      failures: [],
      methods: ['AMOUNT', 'TIME_WINDOW', 'ORDER_CONTEXT'],
      checks: { amount: 'PASS', time_window: 'PASS', sender: 'SKIPPED' },
      orderAmount: order.price,
      eventAmount: event.amount,
      currency: event.currency,
    })
  );
}

export const mockPaymentAccountsService: PaymentAccountsService = {
  list: () => request((tenantId) => db.paymentAccounts.filter(ownedBy(tenantId)), { list: true }),

  async create(input) {
    const valid = assertValidAccountInput(input);
    return request((tenantId) => {
      const accountIdentifier = normalizeAccountIdentifier(valid.accountIdentifier) as string;
      if (
        db.paymentAccounts.some(
          (a) => a.tenantId === tenantId && a.provider === valid.provider && a.accountIdentifier === accountIdentifier
        )
      ) {
        throw conflict('Esta conta já está registada.', 'PAYMENT_ACCOUNT_EXISTS');
      }
      const at = nowIso();
      const account: PaymentAccountRecord = {
        id: newId('pac'),
        tenantId,
        provider: valid.provider,
        accountName: valid.accountName,
        accountIdentifier,
        status: 'ACTIVE',
        createdAt: at,
        updatedAt: at,
      };
      db.paymentAccounts.push(account);
      return account;
    });
  },

  async update(id, input) {
    const valid = assertValidAccountUpdate(input);
    return request((tenantId) => {
      const account = findAccount(tenantId, id);
      Object.assign(account, valid, { updatedAt: nowIso() });
      return account;
    });
  },
};

export const mockPaymentEventsService: PaymentEventsService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.paymentEvents
          .filter(ownedBy(tenantId))
          .filter((e) => !params.paymentAccountId || e.paymentAccountId === params.paymentAccountId),
      { list: true }
    ),

  get: (id) => request((tenantId) => findEvent(tenantId, id)),

  async record(input) {
    const valid = assertValidEventInput(input);
    return request((tenantId) => {
      const account = findAccount(tenantId, valid.paymentAccountId);
      const currency = valid.currency ?? 'MZN';
      const existing = db.paymentEvents.find(
        (e) => e.provider === account.provider && e.paymentAccountId === account.id && e.transactionId === valid.transactionId
      );
      if (existing) {
        // Same movement sent again: the same event. Different data under the same ID: conflict.
        if (cents(existing.amount) !== cents(valid.amount) || existing.currency !== currency) {
          throw conflict('Já existe um movimento com este ID de transação e dados diferentes.', 'PAYMENT_EVENT_CONFLICT');
        }
        return existing;
      }
      const at = nowIso();
      const event: PaymentEventRecord = {
        id: newId('pev'),
        tenantId,
        paymentAccountId: account.id,
        provider: account.provider,
        transactionId: valid.transactionId,
        amount: valid.amount,
        currency,
        senderIdentifier: valid.senderIdentifier,
        recipientIdentifier: valid.recipientIdentifier,
        occurredAt: valid.occurredAt ?? at,
        receivedAt: at,
        rawMessage: valid.rawMessage,
        source: 'MANUAL',
        recordedBy: ACTOR,
        createdAt: at,
      };
      db.paymentEvents.unshift(event);
      reconcileEvent(event);
      return event;
    });
  },
};

export const mockPaymentProofsService: PaymentProofsService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.paymentProofs
          .filter(ownedBy(tenantId))
          .filter((p) => (!params.orderId || p.orderId === params.orderId) && (!params.status || p.status === params.status)),
      { list: true }
    ),

  get: (id) => request((tenantId) => findProof(tenantId, id)),

  async submit(input) {
    const valid = assertValidProofInput(input);
    return request((tenantId) => {
      if (valid.orderId) findOrder(tenantId, valid.orderId);
      const at = nowIso();
      const proof: PaymentProofRecord = {
        id: newId('ppr'),
        tenantId,
        orderId: valid.orderId,
        provider: valid.provider,
        transactionId: valid.transactionId,
        amount: valid.amount,
        currency: valid.currency,
        senderIdentifier: valid.senderIdentifier,
        recipientIdentifier: valid.recipientIdentifier,
        rawMessage: valid.rawMessage,
        source: 'MANUAL',
        extractedData: valid.extractedData ?? {},
        status: 'UNMATCHED',
        statusReason: null,
        reviewNote: null,
        submittedBy: ACTOR,
        createdAt: at,
        updatedAt: at,
      };
      db.paymentProofs.unshift(proof);
      return reconcileProof(proof);
    });
  },

  reconcile: (id) => request((tenantId) => reconcileProof(findProof(tenantId, id))),

  async reject(id, reason) {
    const note = normalizeReviewNote(reason, { required: true });
    return request((tenantId) => {
      const proof = findProof(tenantId, id);
      if (FINAL_PROOF_STATUSES.includes(proof.status)) {
        throw conflict('Este comprovativo já foi decidido.', 'PROOF_ALREADY_DECIDED');
      }
      proof.status = 'REJECTED';
      proof.statusReason = 'REJECTED_MANUALLY';
      proof.reviewNote = note;
      proof.updatedAt = nowIso();
      const order = proof.orderId ? db.orders.find((o) => o.id === proof.orderId) : undefined;
      if (order) syncOrderVerification(order);
      return proof;
    });
  },
};

export const mockPaymentMatchesService: PaymentMatchesService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.paymentMatches
          .filter(ownedBy(tenantId))
          .filter(
            (m) =>
              (!params.orderId || m.orderId === params.orderId) &&
              (!params.paymentEventId || m.paymentEventId === params.paymentEventId) &&
              (!params.paymentProofId || m.paymentProofId === params.paymentProofId)
          ),
      { list: true }
    ),

  async confirmManually(input) {
    normalizeReviewNote(input.note, { required: false });
    return request((tenantId) => {
      const event = findEvent(tenantId, input.paymentEventId);
      const order = findOrder(tenantId, input.orderId);
      const proof = input.paymentProofId ? findProof(tenantId, input.paymentProofId) : null;
      if (proof && proof.orderId !== order.id) notFound('Comprovativo');

      const evaluation = evaluate(order, event, proof);
      const [blocking] = blockingFailures(evaluation);
      if (blocking) {
        throw conflict(`Não é possível confirmar: ${reconciliationReasonText(blocking)}`, 'PAYMENT_NOT_CONFIRMABLE');
      }
      return applyDecision(order, event, proof, {
        ...evaluation,
        decision: 'CONFIRMED',
        reason: 'CONFIRMED_MANUALLY',
        methods: [...evaluation.methods, 'MANUAL'],
      });
    });
  },
};
