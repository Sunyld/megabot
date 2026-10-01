import type { ActivationTask, Order, OrderEventType, TaskStatus } from '@/types';
import { describeUssdFlow, ussdValuesFor } from '@/utils/ussd';

import { realtime } from '../realtime';
import { db } from './db';

/**
 * Simulates the backend activation pipeline for one order:
 * payment confirmed → task → device/SIM selection → USSD → activated.
 * Used when the seller approves a payment or retries an activation.
 */
const now = () => new Date().toISOString();

let eventSeq = 0;

function pushEvent(order: Order, type: OrderEventType, description?: string) {
  order.events.push({ id: `${order.code}-live${++eventSeq}`, type, at: now(), description });
  order.updatedAt = now();
}

function setTask(task: ActivationTask, status: TaskStatus) {
  task.status = status;
  task.updatedAt = now();
}

function pickSim() {
  const online = new Set(db.devices.filter((d) => d.status === 'online').map((d) => d.id));
  return db.sims.find(
    (s) => online.has(s.deviceId) && s.status === 'available' && s.activationsToday < s.dailyLimit
  );
}

export function runActivationPipeline(orderId: string, { verifyOnly = false } = {}) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return;
  const product = db.products.find((p) => p.id === order.productId);

  let task = order.taskId ? db.tasks.find((t) => t.id === order.taskId) : undefined;
  if (!task) {
    task = {
      id: `tsk_live_${order.code}`,
      tenantId: order.tenantId,
      code: order.code.replace('ORD', 'TASK'),
      orderId: order.id,
      orderCode: order.code,
      productName: order.productName,
      destination: order.destination ?? '',
      status: 'QUEUED',
      ussdCode: product?.ussdFlow ? describeUssdFlow(product.ussdFlow, ussdValuesFor(product, order.destination)) : '',
      attempts: [],
      createdAt: now(),
      updatedAt: now(),
    };
    db.tasks.unshift(task);
    order.taskId = task.id;
    pushEvent(order, 'task_created', task.code);
  }
  const activeTask = task;

  const step = (delay: number, fn: () => void) =>
    setTimeout(() => {
      fn();
      realtime.emit('orders', 'tasks', 'devices', 'sims', 'notifications');
    }, delay);

  if (verifyOnly) {
    setTask(activeTask, 'VERIFYING');
    step(2200, () => {
      setTask(activeTask, 'SUCCESS');
      activeTask.operatorResponse = 'Verificação: pacote ativo no número de destino.';
      order.status = 'completed';
      pushEvent(order, 'activated', 'Confirmado por verificação — sem repetir o USSD');
      pushEvent(order, 'customer_notified');
      notify(order, 'Ativação confirmada', `${order.code} · verificação concluída, pacote ativo.`);
    });
    return;
  }

  order.status = 'paid';
  setTask(activeTask, 'QUEUED');
  const sim = pickSim();

  step(1400, () => {
    order.status = 'processing';
    setTask(activeTask, 'EXECUTING');
    if (sim) {
      activeTask.attempts.push({
        id: `${order.code}-live-a${activeTask.attempts.length}`,
        deviceId: sim.deviceId,
        deviceName: sim.deviceName,
        simId: sim.id,
        simSlot: sim.slot,
        result: 'running',
        at: now(),
      });
      pushEvent(order, 'device_selected', `${sim.deviceName} · SIM ${sim.slot}`);
    }
  });

  step(3000, () => {
    setTask(activeTask, 'SUBMITTED');
    pushEvent(order, 'ussd_executed');
  });

  step(5600, () => {
    const attempt = activeTask.attempts.at(-1);
    if (attempt) {
      attempt.result = 'success';
      attempt.durationMs = 4200;
    }
    if (sim) sim.activationsToday += 1;
    setTask(activeTask, 'SUCCESS');
    activeTask.operatorResponse = 'Pacote ativado com sucesso.';
    order.status = 'completed';
    order.failureReason = undefined;
    pushEvent(order, 'activated');
    pushEvent(order, 'customer_notified');
    notify(order, 'Pacote ativado', `${order.code} · ${order.productName} entregue.`);
  });
}

function notify(order: Order, title: string, body: string) {
  db.notifications.unshift({
    id: `ntf_live_${++eventSeq}`,
    tenantId: order.tenantId,
    kind: 'activation',
    severity: 'success',
    title,
    body,
    createdAt: now(),
    read: false,
    target: { type: 'order', id: order.id },
  });
}
