import type { TimelineItem, TimelineState } from '@/components/ui/Timeline';
import type { Order, OrderEvent, OrderEventType } from '@/types';
import { formatTime } from '@/utils/format';

type Step = { type: OrderEventType; title: string };

/** The canonical journey of an order, as the seller should read it. */
const steps: Step[] = [
  { type: 'created', title: 'Pedido criado' },
  { type: 'payment_proof_received', title: 'Pagamento recebido' },
  { type: 'payment_confirmed', title: 'Pagamento confirmado' },
  { type: 'task_created', title: 'Tarefa criada' },
  { type: 'device_selected', title: 'Dispositivo selecionado' },
  { type: 'ussd_executed', title: 'USSD executado' },
  { type: 'activated', title: 'Pacote ativado' },
];

const lastOf = (events: OrderEvent[], type: OrderEventType) => events.filter((e) => e.type === type).at(-1);

/** What is happening at the first step that hasn't completed yet. */
function currentStepState(order: Order): { state: TimelineState; description?: string } {
  switch (order.status) {
    case 'awaiting_destination':
      return { state: 'current', description: 'A aguardar o número de destino do cliente' };
    case 'awaiting_payment':
      return { state: 'current', description: 'A aguardar a mensagem de confirmação da carteira' };
    case 'payment_review':
      return {
        state: 'warning',
        description: lastOf(order.events, 'payment_review')?.description ?? 'Pagamento em revisão',
      };
    case 'paid':
      return { state: 'current', description: 'Na fila para um dispositivo livre' };
    case 'processing':
      return { state: 'current', description: 'Em curso no dispositivo' };
    case 'verifying':
      return {
        state: 'warning',
        description: 'Sem confirmação da operadora (UNKNOWN). A verificar antes de repetir.',
      };
    case 'failed':
      return { state: 'failed', description: lastOf(order.events, 'failed')?.description ?? order.failureReason };
    default:
      return { state: 'pending' };
  }
}

export function buildOrderTimeline(order: Order): TimelineItem[] {
  const items: TimelineItem[] = [];
  const current = currentStepState(order);
  let reachedOpenStep = false;

  for (const step of steps) {
    const event = lastOf(order.events, step.type);

    // Surface automatic failover right before the device that finally ran the task.
    if (step.type === 'device_selected') {
      const failover = lastOf(order.events, 'failover');
      if (failover) {
        items.push({
          key: 'failover',
          title: 'Failover automático',
          description: failover.description,
          time: formatTime(failover.at, true),
          state: 'done',
          icon: 'failover',
        });
      }
    }

    if (event && !reachedOpenStep) {
      let description = event.description;
      if (step.type === 'created') description = `${order.productName} · ${order.channel.name}`;
      if (step.type === 'activated' && order.events.some((e) => e.type === 'customer_notified')) {
        description = [event.description, 'Cliente notificado no WhatsApp'].filter(Boolean).join(' · ');
      }
      items.push({ key: step.type, title: step.title, description, time: formatTime(event.at, true), state: 'done' });
      continue;
    }

    if (order.status === 'cancelled') {
      if (!reachedOpenStep) {
        const cancelled = lastOf(order.events, 'cancelled');
        items.push({
          key: 'cancelled',
          title: 'Pedido cancelado',
          description: cancelled?.description,
          time: cancelled ? formatTime(cancelled.at, true) : undefined,
          state: 'failed',
        });
      }
      reachedOpenStep = true;
      break;
    }

    if (!reachedOpenStep) {
      reachedOpenStep = true;
      items.push({ key: step.type, title: step.title, ...current });
      continue;
    }

    items.push({ key: step.type, title: step.title, state: 'pending' });
  }

  return items;
}
