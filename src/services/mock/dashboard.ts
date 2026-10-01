import type { Activity, AttentionItem, DashboardSummary, Order, OrderStatus } from '@/types';
import { formatMoney, formatRelativeLong, isSameDay } from '@/utils/format';

import type { DashboardService } from '../types';
import { db, ownedBy, request } from './db';

const SOLD: OrderStatus[] = ['paid', 'processing', 'verifying', 'completed', 'failed'];
const PENDING: OrderStatus[] = ['awaiting_destination', 'awaiting_payment', 'payment_review'];

const revenueOf = (orders: Order[]) => orders.reduce((sum, o) => sum + o.price, 0);

function buildAttention(tenantId: string): AttentionItem[] {
  const items: AttentionItem[] = [];

  db.payments
    .filter(ownedBy(tenantId))
    .filter((p) => p.status === 'review')
    .forEach((p) =>
      items.push({
        id: `att_${p.id}`,
        severity: 'warning',
        title: 'Pagamento requer revisão',
        description: `${p.orderCode ?? p.transactionId} · ${p.reviewReason ?? 'Dados não coincidem'}`,
        target: { type: 'payment', id: p.id },
      })
    );

  db.orders
    .filter(ownedBy(tenantId))
    .filter((o) => o.status === 'failed')
    .forEach((o) =>
      items.push({
        id: `att_${o.id}`,
        severity: 'danger',
        title: `Ativação falhou · ${o.code}`,
        description: o.failureReason ?? 'A operadora recusou a ativação.',
        target: { type: 'order', id: o.id },
      })
    );

  db.devices
    .filter(ownedBy(tenantId))
    .filter((d) => d.status === 'offline')
    .forEach((d) =>
      items.push({
        id: `att_${d.id}`,
        severity: 'warning',
        title: `${d.name} offline`,
        description: `Última ligação ${formatRelativeLong(d.lastSeenAt)}. Tarefas redirecionadas.`,
        target: { type: 'device', id: d.id },
      })
    );

  return items;
}

export const mockDashboardService: DashboardService = {
  getSummary: () =>
    request((tenantId): DashboardSummary => {
      const now = Date.now();
      const orders = db.orders.filter(ownedBy(tenantId));
      const today = orders.filter((o) => isSameDay(o.createdAt, now));
      const yesterday = orders.filter((o) => isSameDay(o.createdAt, now - 86_400_000));

      const sold = today.filter((o) => SOLD.includes(o.status));
      const completed = today.filter((o) => o.status === 'completed');
      const revenue = revenueOf(sold);
      const yesterdayRevenue = revenueOf(yesterday.filter((o) => SOLD.includes(o.status)));

      const durations = db.tasks
        .filter(ownedBy(tenantId))
        .filter((t) => t.status === 'SUCCESS' && isSameDay(t.createdAt, now))
        .map((t) => (t.attempts.find((a) => a.result === 'success')?.durationMs ?? 0) / 1000)
        .filter(Boolean);

      const currentHour = new Date(now).getHours();
      const firstHour = Math.max(0, currentHour - 11);
      const hourly = Array.from({ length: currentHour - firstHour + 1 }, (_, i) => {
        const hour = firstHour + i;
        const inHour = sold.filter((o) => new Date(o.createdAt).getHours() === hour);
        return { hour, revenue: revenueOf(inHour), orders: inHour.length };
      });

      const devices = db.devices.filter(ownedBy(tenantId));

      return {
        date: new Date(now).toISOString(),
        sales: sold.length,
        revenue,
        revenueDelta: yesterdayRevenue ? (revenue - yesterdayRevenue) / yesterdayRevenue : 0,
        activated: completed.length,
        pending: today.filter((o) => PENDING.includes(o.status)).length,
        failed: today.filter((o) => o.status === 'failed').length,
        avgActivationSeconds: durations.length
          ? durations.reduce((sum, d) => sum + d, 0) / durations.length
          : 0,
        hourly,
        pipeline: {
          received: today.length,
          paid: sold.length,
          activated: completed.length,
          delivered: completed.filter((o) => o.events.some((e) => e.type === 'customer_notified')).length,
        },
        systems: {
          devicesOnline: devices.filter((d) => d.status === 'online').length,
          devicesTotal: devices.length,
          whatsapp: db.whatsapp.status,
          paymentsMonitoring: db.automation.enabled && db.automation.smsMonitoring,
        },
        attention: buildAttention(tenantId),
      };
    }),

  listActivity: (limit = 12) =>
    request((tenantId) => {
      const items: Activity[] = [];

      for (const order of db.orders.filter(ownedBy(tenantId))) {
        for (const event of order.events) {
          const base = { at: event.at, target: { type: 'order' as const, id: order.id } };
          if (event.type === 'activated') {
            items.push({ ...base, id: `${event.id}`, kind: 'activation', severity: 'success', title: `Pacote ativado · ${order.productName}`, description: `${order.code} · ${formatMoney(order.price)}` });
          } else if (event.type === 'payment_confirmed') {
            items.push({ ...base, id: `${event.id}`, kind: 'payment', severity: 'info', title: `Pagamento confirmado · ${formatMoney(order.price)}`, description: `${order.code} · ${order.transactionId ?? ''}` });
          } else if (event.type === 'created') {
            items.push({ ...base, id: `${event.id}`, kind: 'order', severity: 'info', title: 'Novo pedido', description: `${order.code} · ${order.productName} · ${order.channel.name}` });
          } else if (event.type === 'failed') {
            items.push({ ...base, id: `${event.id}`, kind: 'activation', severity: 'danger', title: 'Ativação falhou', description: `${order.code} · ${event.description ?? ''}` });
          } else if (event.type === 'payment_review') {
            items.push({ ...base, id: `${event.id}`, kind: 'payment', severity: 'warning', title: 'Pagamento em revisão', description: `${order.code} · ${event.description ?? ''}` });
          } else if (event.type === 'failover') {
            items.push({ ...base, id: `${event.id}`, kind: 'activation', severity: 'info', title: 'Failover automático', description: `${order.code} · ${event.description ?? ''}` });
          }
        }
      }

      for (const device of db.devices.filter(ownedBy(tenantId))) {
        if (device.status === 'offline') {
          items.push({
            id: `act_${device.id}_offline`,
            kind: 'device',
            severity: 'warning',
            title: `${device.name} ficou offline`,
            description: 'Tarefas redirecionadas para outros dispositivos',
            at: device.lastSeenAt,
            target: { type: 'device', id: device.id },
          });
        }
      }

      return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    }, { list: true }),
};
