/**
 * Products on Supabase (migration 003). Maps rows ↔ domain and database
 * errors → AppErrors. Authorization lives in the database: reads by any
 * member, writes by owner/admin of an active tenant (RLS). Unexpected values
 * from the backend fail closed — the product is shown as not for sale.
 */
import type { DataUnit, ID, Operator, Product, ProductCategory, ProductInput, ProductStatus } from '@/types';

import { serviceContext } from '../context';
import { AppError } from '../errors';
import { assertValidProductInput, DATA_UNITS, PRODUCT_CATEGORIES, PRODUCT_OPERATORS } from '../productRules';
import type { ProductsService } from '../types';
import { parseUssdFlow } from '../ussdFlow';
import { toAppError } from './errors';
import type { ProductInsertRow, ProductRow, ProductsGateway } from './productsGateway';

const includes = <T extends string>(list: readonly T[], value: string | null): value is T =>
  value !== null && (list as readonly string[]).includes(value);

export function toProduct(row: ProductRow): Product {
  const ussdFlow = row.ussd_flow === null ? null : parseUssdFlow(row.ussd_flow);
  const category: ProductCategory = includes(PRODUCT_CATEGORIES, row.category) ? row.category : 'daily';
  const operator: Operator = includes(PRODUCT_OPERATORS, row.operator) ? row.operator : 'vodacom';
  const dataUnit: DataUnit | null = includes(DATA_UNITS, row.data_unit) ? row.data_unit : null;
  // Fail closed: anything the app cannot interpret is not for sale.
  const understood =
    includes(PRODUCT_CATEGORIES, row.category) &&
    includes(PRODUCT_OPERATORS, row.operator) &&
    (row.ussd_flow === null || ussdFlow !== null);
  const status: ProductStatus = row.status === 'ACTIVE' && understood ? 'ACTIVE' : 'INACTIVE';

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    category,
    price: Number(row.price),
    currency: row.currency,
    dataAmount: row.data_amount === null || dataUnit === null ? null : Number(row.data_amount),
    dataUnit: row.data_amount === null ? null : dataUnit,
    validityHours: row.validity_hours,
    operator,
    status,
    ussdFlow,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    soldToday: 0,
  };
}

/** Domain input → table columns (tenant_id is added by the caller). */
export function toProductRow(input: ProductInput): Omit<ProductInsertRow, 'tenant_id'> {
  return {
    name: input.name,
    description: input.description,
    category: input.category,
    price: input.price,
    currency: input.currency,
    data_amount: input.dataAmount,
    data_unit: input.dataUnit,
    validity_hours: input.validityHours,
    operator: input.operator,
    status: input.status,
    ussd_flow: input.ussdFlow,
  };
}

const productNotFound = (detail?: string) => new AppError('NOT_FOUND', 'Produto não encontrado.', { detail });

/** Database errors → product messages. The SQLSTATE leads `detail` (see toAppError). */
function toProductError(error: unknown, { activating = false } = {}): AppError {
  const appError = toAppError(error);
  const sqlState = appError.detail?.split(' | ')[0];
  switch (appError.code) {
    case 'PERMISSION_DENIED':
      return new AppError(
        'PERMISSION_DENIED',
        'Só o dono ou um administrador de uma empresa ativa pode gerir produtos.',
        { reason: 'PRODUCT_WRITE_DENIED', detail: appError.detail }
      );
    case 'CONFLICT':
      if (sqlState === '23505') {
        return new AppError('CONFLICT', 'Já existe um produto com este nome.', {
          reason: 'PRODUCT_NAME_TAKEN',
          detail: appError.detail,
        });
      }
      if (sqlState === '55000') {
        return new AppError('CONFLICT', 'Este produto foi arquivado e já não pode ser alterado.', {
          reason: 'PRODUCT_ARCHIVED',
          detail: appError.detail,
        });
      }
      return appError;
    case 'VALIDATION_ERROR':
      return new AppError(
        'VALIDATION_ERROR',
        activating ? 'Configure o USSD deste produto antes de o pôr à venda.' : 'Os dados do produto não são válidos.',
        { reason: 'INVALID_PRODUCT', detail: appError.detail }
      );
    default:
      return appError;
  }
}

export function createSupabaseProductsService(
  gateway: ProductsGateway,
  getTenantId: () => ID | null = () => serviceContext.getTenant()
): ProductsService {
  const tenantId = () => {
    const id = getTenantId();
    if (!id) throw new AppError('AUTH_ERROR', 'Sessão expirada. Entre novamente.', { reason: 'SESSION_EXPIRED' });
    return id;
  };

  async function patch(id: ID, values: Parameters<ProductsGateway['update']>[2], options?: { activating?: boolean }) {
    const tenant = tenantId();
    try {
      const row = await gateway.update(tenant, id, values);
      if (!row) throw productNotFound();
      return toProduct(row);
    } catch (error) {
      throw toProductError(error, options);
    }
  }

  return {
    async list() {
      const tenant = tenantId();
      try {
        return (await gateway.list(tenant)).map(toProduct);
      } catch (error) {
        throw toProductError(error);
      }
    },

    async get(id) {
      const tenant = tenantId();
      try {
        const row = await gateway.get(tenant, id);
        if (!row) throw productNotFound();
        return toProduct(row);
      } catch (error) {
        throw toProductError(error);
      }
    },

    async create(input) {
      const valid = assertValidProductInput(input);
      const tenant = tenantId();
      try {
        return toProduct(await gateway.insert({ tenant_id: tenant, ...toProductRow(valid) }));
      } catch (error) {
        throw toProductError(error);
      }
    },

    async update(id, input) {
      const valid = assertValidProductInput(input);
      return patch(id, toProductRow(valid));
    },

    activate: (id) => patch(id, { status: 'ACTIVE' }, { activating: true }),

    deactivate: (id) => patch(id, { status: 'INACTIVE' }),

    async archive(id) {
      // The database replaces this with its own clock (trigger); the value only marks the intent.
      await patch(id, { archived_at: new Date().toISOString() });
    },
  };
}
