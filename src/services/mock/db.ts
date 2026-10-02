import {
  mockAutomationSettings,
  mockConversations,
  mockDevices,
  mockGroups,
  mockNotifications,
  mockOrders,
  mockPaymentAccounts,
  mockPayments,
  mockProducts,
  mockSims,
  mockTasks,
  mockWhatsAppConnection,
  TENANT_ID,
} from '@/mocks';

import type { PaymentEventRecord, PaymentMatchRecord, PaymentProofRecord } from '@/types';

import { serviceContext } from '../context';
import { AppError } from '../errors';
import { simulationStore } from './simulation';

/**
 * In-memory database for the mock backend. Seeded from `src/mocks` and mutated
 * by service calls, so actions (approve a payment, toggle a product…) persist
 * for the whole session.
 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const db = {
  orders: clone(mockOrders),
  payments: clone(mockPayments),
  // Financial core (005): receiving accounts, real events, customer proofs, decisions.
  paymentAccounts: clone(mockPaymentAccounts),
  paymentEvents: [] as PaymentEventRecord[],
  paymentProofs: [] as PaymentProofRecord[],
  paymentMatches: [] as PaymentMatchRecord[],
  tasks: clone(mockTasks),
  products: clone(mockProducts),
  devices: clone(mockDevices),
  sims: clone(mockSims),
  notifications: clone(mockNotifications),
  whatsapp: clone(mockWhatsAppConnection),
  groups: clone(mockGroups),
  conversations: clone(mockConversations),
  automation: clone(mockAutomationSettings),
};

const LATENCY = { instant: [0, 0], realistic: [280, 650], slow: [1600, 2600] } as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock mode serves the demo dataset (it belongs to the demo tenant). In
 * Supabase mode the domains that are not on the backend yet reuse these
 * services scoped to the REAL signed-in tenant, which owns no fixture rows —
 * so they show empty states and demo data never mixes with real data.
 */
let serveDemoData = true;

export function stopServingDemoData() {
  serveDemoData = false;
}

/**
 * Every mock call goes through here: resolves the tenant (like RLS would),
 * waits a realistic amount of time and applies the simulation switches.
 * `requireTenant: false` is for platform (cross-tenant) calls.
 */
export async function request<T>(
  handler: (tenantId: string) => T,
  { list = false, empty, requireTenant = true }: { list?: boolean; empty?: () => T; requireTenant?: boolean } = {}
): Promise<T> {
  const { latency, failRequests, offline, emptyData } = simulationStore.get();
  const [min, max] = LATENCY[latency];
  await sleep(min + Math.random() * (max - min));

  if (offline) throw new AppError('NETWORK_ERROR', 'Sem ligação à internet. Verifique a sua rede.');
  if (failRequests) throw new AppError('DATABASE_ERROR', 'Não foi possível carregar os dados. Tente novamente.');

  const tenantId = serviceContext.getTenant();
  if (requireTenant && !tenantId) throw new AppError('AUTH_ERROR', 'Sessão expirada. Entre novamente.');

  if (emptyData && empty) return empty();
  const result = handler(serveDemoData ? TENANT_ID : (tenantId ?? ''));
  if (list && emptyData && Array.isArray(result)) return [] as T;
  // Void handlers (markRead, archive…): JSON.parse(undefined) would throw.
  return result === undefined ? result : clone(result);
}

export function notFound(entity: string): never {
  throw new AppError('NOT_FOUND', `${entity} não encontrado.`);
}

/** Tenant filter — the mock equivalent of an RLS policy. */
export const ownedBy =
  (tenantId: string) =>
  <T extends { tenantId: string }>(row: T) =>
    row.tenantId === tenantId;
