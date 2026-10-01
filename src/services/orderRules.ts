/**
 * Order rules shared by every backend and the order form. They mirror
 * migration 004 (private.order_status_transition_allowed,
 * private.normalize_phone); the database enforces them again and remains the
 * final authority — the app uses them for feedback and to show valid actions.
 */
import type { CreateOrderInput, OrderFilter, OrderStatus } from '@/types';

import { AppError } from './errors';

/** The order state machine (same table as the database). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED'],
  AWAITING_PAYMENT: ['VERIFYING', 'PAID', 'CANCELLED', 'EXPIRED'],
  VERIFYING: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED'],
  PAID: ['READY_FOR_ACTIVATION'],
  READY_FOR_ACTIVATION: ['ACTIVATING', 'FAILED'],
  ACTIVATING: ['COMPLETED', 'FAILED'],
  FAILED: ['READY_FOR_ACTIVATION', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

export const canTransition = (from: OrderStatus, to: OrderStatus) => ORDER_TRANSITIONS[from].includes(to);

export const isOrderStatus = (value: string): value is OrderStatus => (ORDER_STATUSES as string[]).includes(value);

/** UI filter buckets → statuses. CANCELLED / EXPIRED only appear under "all". */
export const ORDER_FILTER_STATUSES: Record<Exclude<OrderFilter, 'all'>, OrderStatus[]> = {
  pending: ['PENDING', 'AWAITING_PAYMENT', 'VERIFYING'],
  paid: ['PAID', 'READY_FOR_ACTIVATION'],
  processing: ['ACTIVATING'],
  completed: ['COMPLETED'],
  failed: ['FAILED'],
};

/** Statuses that represent money received (used for daily totals). */
export const SOLD_STATUSES: readonly OrderStatus[] = ['PAID', 'READY_FOR_ACTIVATION', 'ACTIVATING', 'COMPLETED', 'FAILED'];

export const ORDER_RULES = {
  customerNameMax: 80,
  reasonMax: 500,
  idempotencyKeyPattern: /^[A-Za-z0-9._:-]{8,100}$/,
} as const;

/**
 * Phone → E.164 ("+258841234567") or `null` when invalid. Accepts spaces,
 * dots, dashes, parentheses, the "00" prefix and Mozambican local numbers
 * (9 digits starting with 8). Any country is accepted in E.164; +258 numbers
 * must be Mozambican mobiles (82–87). Same rules as private.normalize_phone.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  let value = (raw ?? '').replace(/[\s().-]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (/^8\d{8}$/.test(value)) value = `+258${value}`;
  else if (/^258\d{9}$/.test(value)) value = `+${value}`;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  if (value.startsWith('+258') && !/^\+2588[2-7]\d{7}$/.test(value)) return null;
  return value;
}

/** A fresh idempotency key for one order request (reuse it when retrying that request). */
export function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `app-${Date.now().toString(36)}-${random}`;
}

export type CreateOrderField = 'productId' | 'customerPhone' | 'customerName';

export function validateCreateOrderInput(input: CreateOrderInput): Partial<Record<CreateOrderField, string>> {
  const errors: Partial<Record<CreateOrderField, string>> = {};
  if (!input.productId) errors.productId = 'Escolha o produto.';
  if (!normalizePhone(input.customerPhone)) {
    errors.customerPhone = 'Número inválido. Use um número de Moçambique (ex.: 84 123 4567) ou o formato internacional.';
  }
  if ((input.customerName?.trim().length ?? 0) > ORDER_RULES.customerNameMax) {
    errors.customerName = `O nome deve ter no máximo ${ORDER_RULES.customerNameMax} caracteres.`;
  }
  return errors;
}

/** Normalizes and validates; throws VALIDATION_ERROR with the first problem. */
export function assertValidCreateOrderInput(input: CreateOrderInput): CreateOrderInput {
  const [first] = Object.values(validateCreateOrderInput(input));
  if (first) throw new AppError('VALIDATION_ERROR', first, { reason: first.startsWith('Número') ? 'INVALID_PHONE' : undefined });
  if (input.idempotencyKey && !ORDER_RULES.idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new AppError('VALIDATION_ERROR', 'Chave de idempotência inválida.');
  }
  return {
    productId: input.productId,
    customerPhone: normalizePhone(input.customerPhone) ?? input.customerPhone,
    customerName: input.customerName?.trim() || null,
    idempotencyKey: input.idempotencyKey,
  };
}

export function normalizeCancelReason(reason: string | undefined): string | null {
  const value = reason?.trim() || null;
  if (value && value.length > ORDER_RULES.reasonMax) {
    throw new AppError('VALIDATION_ERROR', `O motivo deve ter no máximo ${ORDER_RULES.reasonMax} caracteres.`);
  }
  return value;
}

/** For commands owned by later phases (activation, WhatsApp). */
export const featureNotAvailable = (what: string) =>
  new AppError('CONFLICT', `${what} fica disponível quando a ativação automática estiver ligada.`, {
    reason: 'FEATURE_NOT_AVAILABLE',
  });

export function invalidTransition(from: OrderStatus, to: OrderStatus): AppError {
  return new AppError('CONFLICT', `Não é possível passar este pedido de "${from}" para "${to}".`, {
    reason: 'INVALID_TRANSITION',
  });
}
