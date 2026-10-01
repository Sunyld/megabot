import type { ID, OrderStatus, Product, ProductInput } from '@/types';
import { isSameDay } from '@/utils/format';

import { AppError } from '../errors';
import { assertValidProductInput } from '../productRules';
import type { DevicesService, ProductsService, SimsService } from '../types';
import { db, notFound, ownedBy, request } from './db';

const SOLD: OrderStatus[] = ['PAID', 'READY_FOR_ACTIVATION', 'ACTIVATING', 'COMPLETED', 'FAILED'];

/*
 * Mock products follow the database rules of migration 003: validated input,
 * one live product per name, ACTIVE only with a USSD flow, archive instead of
 * delete. (Roles and tenant suspension are enforced by RLS in Supabase mode.)
 */

const liveProduct = (tenantId: string, id: ID): Product => {
  const product = db.products.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Produto');
  if (product.archivedAt) {
    throw new AppError('CONFLICT', 'Este produto foi arquivado e já não pode ser alterado.', { reason: 'PRODUCT_ARCHIVED' });
  }
  return product;
};

function assertUniqueName(tenantId: string, name: string, exceptId?: ID) {
  const taken = db.products.some(
    (p) => p.tenantId === tenantId && !p.archivedAt && p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw new AppError('CONFLICT', 'Já existe um produto com este nome.', { reason: 'PRODUCT_NAME_TAKEN' });
}

const touch = (product: Product) => {
  product.updatedAt = new Date().toISOString();
  return product;
};

export const mockProductsService: ProductsService = {
  list: () =>
    request(
      (tenantId) => {
        const todaysSales = db.orders
          .filter(ownedBy(tenantId))
          .filter((o) => SOLD.includes(o.status) && isSameDay(o.createdAt, Date.now()));
        return db.products
          .filter(ownedBy(tenantId))
          .filter((p) => !p.archivedAt)
          .map((p) => ({ ...p, soldToday: todaysSales.filter((o) => o.productId === p.id).length }));
      },
      { list: true }
    ),

  get: (id) =>
    request((tenantId) => db.products.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Produto')),

  async create(input: ProductInput) {
    const valid = assertValidProductInput(input);
    return request((tenantId) => {
      assertUniqueName(tenantId, valid.name);
      const now = new Date().toISOString();
      const product: Product = {
        ...valid,
        id: `prd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        tenantId,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        soldToday: 0,
      };
      db.products.push(product);
      return product;
    });
  },

  async update(id, input) {
    const valid = assertValidProductInput(input);
    return request((tenantId) => {
      const product = liveProduct(tenantId, id);
      assertUniqueName(tenantId, valid.name, id);
      return touch(Object.assign(product, valid));
    });
  },

  activate: (id) =>
    request((tenantId) => {
      const product = liveProduct(tenantId, id);
      if (!product.ussdFlow) {
        throw new AppError('VALIDATION_ERROR', 'Configure o USSD deste produto antes de o pôr à venda.', {
          reason: 'INVALID_PRODUCT',
        });
      }
      product.status = 'ACTIVE';
      return touch(product);
    }),

  deactivate: (id) =>
    request((tenantId) => {
      const product = liveProduct(tenantId, id);
      product.status = 'INACTIVE';
      return touch(product);
    }),

  archive: (id) =>
    request((tenantId) => {
      const product = liveProduct(tenantId, id);
      product.status = 'INACTIVE';
      product.archivedAt = new Date().toISOString();
      touch(product);
    }),
};

export const mockDevicesService: DevicesService = {
  list: () => request((tenantId) => db.devices.filter(ownedBy(tenantId)), { list: true }),

  summary: () =>
    request((tenantId) => {
      const devices = db.devices.filter(ownedBy(tenantId));
      const sims = db.sims.filter(ownedBy(tenantId)).filter((s) => s.paymentWallet === null || s.status !== 'paused');
      return {
        online: devices.filter((d) => d.status === 'online').length,
        total: devices.length,
        simsAvailable: sims.filter((s) => s.status === 'available').length,
        simsTotal: sims.length,
        capacityUsed: sims.reduce((sum, s) => sum + s.activationsToday, 0),
        capacityTotal: sims.reduce((sum, s) => sum + s.dailyLimit, 0),
      };
    }, { empty: () => ({ online: 0, total: 0, simsAvailable: 0, simsTotal: 0, capacityUsed: 0, capacityTotal: 0 }) }),

  get: (id) =>
    request((tenantId) => db.devices.filter(ownedBy(tenantId)).find((d) => d.id === id) ?? notFound('Dispositivo')),

  setPaused: (id, paused) =>
    request((tenantId) => {
      const device = db.devices.filter(ownedBy(tenantId)).find((d) => d.id === id) ?? notFound('Dispositivo');
      if (device.status !== 'offline') device.status = paused ? 'paused' : 'online';
      return device;
    }),

  testUssd: async (id) => {
    const device = await request((tenantId) =>
      db.devices.filter(ownedBy(tenantId)).find((d) => d.id === id) ?? notFound('Dispositivo')
    );
    await new Promise((resolve) => setTimeout(resolve, 1400));
    if (device.status !== 'online') {
      return { ok: false, response: 'Dispositivo indisponível — não foi possível executar o USSD.', durationMs: 0 };
    }
    return { ok: true, response: 'Saldo: 312,50 MT. Megas: 8,2 GB validos ate 30/10.', durationMs: 2400 };
  },
};

export const mockSimsService: SimsService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.sims.filter(ownedBy(tenantId)).filter((s) => !params.deviceId || s.deviceId === params.deviceId),
      { list: true }
    ),

  get: (id) => request((tenantId) => db.sims.filter(ownedBy(tenantId)).find((s) => s.id === id) ?? notFound('SIM')),

  setPaused: (id, paused) =>
    request((tenantId) => {
      const sim = db.sims.filter(ownedBy(tenantId)).find((s) => s.id === id) ?? notFound('SIM');
      if (sim.status !== 'offline') {
        sim.status = paused ? 'paused' : sim.activationsToday >= sim.dailyLimit ? 'limit_reached' : 'available';
      }
      return sim;
    }),
};
