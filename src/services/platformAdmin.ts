/**
 * Platform administration rules shared by every backend (mock and Supabase).
 * The limits mirror migration 002: validating here gives immediate feedback,
 * and the database validates everything again.
 */
import type {
  AuditLogQuery,
  ID,
  ISODateString,
  PlatformAdminContext,
  PlatformPermission,
  PlatformTenantListParams,
  TenantStatus,
} from '@/types';

import { AppError } from './errors';

export const PLATFORM_RULES = {
  reasonMax: 500,
  searchMax: 80,
  pageDefault: 50,
  pageMax: 200,
} as const;

const INT32_MAX = 2_147_483_647;

/** Context of anyone who is not a platform admin — the default for every user. */
export function noPlatformAccess(): PlatformAdminContext {
  return { isPlatformAdmin: false, role: null, status: null, permissions: [] };
}

/**
 * The single client-side platform permission check. UI only (show / hide /
 * disable): it trusts the context computed by the backend and never looks at
 * emails, user ids or tenant roles. The database re-checks every operation.
 */
export function hasPlatformPermission(
  context: PlatformAdminContext | null | undefined,
  permission: PlatformPermission
): boolean {
  return !!context && context.isPlatformAdmin && context.status === 'ACTIVE' && context.permissions.includes(permission);
}

export const platformAccessDenied = (detail?: string) =>
  new AppError('PERMISSION_DENIED', 'Acesso reservado à administração da plataforma.', {
    reason: 'PLATFORM_ACCESS_DENIED',
    detail,
  });

export const tenantNotFound = (detail?: string) => new AppError('NOT_FOUND', 'Empresa não encontrada.', { detail });

/** The requested transition is a no-op (already in the target status). */
export function tenantStatusConflict(target: TenantStatus, detail?: string): AppError {
  return target === 'suspended'
    ? new AppError('CONFLICT', 'Esta empresa já está suspensa.', { reason: 'TENANT_ALREADY_SUSPENDED', detail })
    : new AppError('CONFLICT', 'Esta empresa já está ativa.', { reason: 'TENANT_ALREADY_ACTIVE', detail });
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

const optionalText = (value: string | undefined): string | null => value?.trim() || null;

export type NormalizedTenantListParams = {
  status: TenantStatus | null;
  search: string | null;
  limit: number;
  offset: number;
};

export function normalizeTenantListParams(params: PlatformTenantListParams = {}): NormalizedTenantListParams {
  const search = optionalText(params.search);
  if (search && search.length > PLATFORM_RULES.searchMax) {
    throw new AppError('VALIDATION_ERROR', `A pesquisa deve ter no máximo ${PLATFORM_RULES.searchMax} caracteres.`);
  }
  return {
    status: params.status ?? null,
    search,
    limit: clampInt(params.limit, PLATFORM_RULES.pageDefault, 1, PLATFORM_RULES.pageMax),
    offset: clampInt(params.offset, 0, 0, INT32_MAX),
  };
}

/** Trims the optional suspension / reactivation note; `null` when empty. */
export function normalizeReason(reason: string | undefined): string | null {
  const value = optionalText(reason);
  if (value && value.length > PLATFORM_RULES.reasonMax) {
    throw new AppError('VALIDATION_ERROR', `O motivo deve ter no máximo ${PLATFORM_RULES.reasonMax} caracteres.`);
  }
  return value;
}

export type NormalizedAuditLogQuery = {
  tenantId: ID | null;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  before: ISODateString | null;
  limit: number;
};

export function normalizeAuditLogQuery(query: AuditLogQuery = {}): NormalizedAuditLogQuery {
  const before = optionalText(query.before);
  if (before && Number.isNaN(Date.parse(before))) {
    throw new AppError('VALIDATION_ERROR', 'Data de paginação inválida.');
  }
  return {
    tenantId: optionalText(query.tenantId),
    action: optionalText(query.action),
    resourceType: optionalText(query.resourceType),
    resourceId: optionalText(query.resourceId),
    before,
    limit: clampInt(query.limit, PLATFORM_RULES.pageDefault, 1, PLATFORM_RULES.pageMax),
  };
}
