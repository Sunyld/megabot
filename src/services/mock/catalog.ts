import type { OrderStatus } from '@/types';
import { isSameDay } from '@/utils/format';

import type { DevicesService, ProductsService, SimsService } from '../types';
import { db, notFound, ownedBy, request } from './db';

const SOLD: OrderStatus[] = ['paid', 'processing', 'verifying', 'completed', 'failed'];

export const mockProductsService: ProductsService = {
  list: () =>
    request(
      (tenantId) => {
        const todaysSales = db.orders
          .filter(ownedBy(tenantId))
          .filter((o) => SOLD.includes(o.status) && isSameDay(o.createdAt, Date.now()));
        return db.products.filter(ownedBy(tenantId)).map((p) => ({
          ...p,
          soldToday: todaysSales.filter((o) => o.productId === p.id).length,
        }));
      },
      { list: true }
    ),

  get: (id) =>
    request((tenantId) => db.products.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Produto')),

  setActive: (id, active) =>
    request((tenantId) => {
      const product = db.products.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Produto');
      product.active = active;
      return product;
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
