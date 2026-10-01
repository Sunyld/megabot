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

/** Activation sent but the operator did not confirm (task UNKNOWN): verifying before any retry. */
export const isVerifyingActivation = (order: Order) =>
  order.status === 'ACTIVATING' && order.events.some((e) => e.type === 'verification_started');

/** What is happening at the first step that hasn't completed yet. */
function currentStepState(order: Order): { state: TimelineState; description?: string } {
  switch (order.status) {
    case 'PENDING':
      return {
        state: 'current',
        description: order.destination ? 'A aguardar o envio dos dados de pagamento' : 'A aguardar o número de destino do cliente',
      };
    case 'AWAITING_PAYMENT':
      return {
        state: 'current',
        description: order.paymentId ? 'A aguardar a mensagem de confirmação da carteira' : 'A aguardar o pagamento do cliente',
      };
    case 'VERIFYING':
      return {
        state: 'warning',
        description: lastOf(order.events, 'payment_review')?.description ?? 'Pagamento em verificação',
      };
    case 'PAID':
    case 'READY_FOR_ACTIVATION':
      return { state: 'current', description: 'Na fila para um dispositivo livre' };
    case 'ACTIVATING':
      return isVerifyingActivation(order)
        ? { state: 'warning', description: 'Sem confirmação da operadora (UNKNOWN). A verificar antes de repetir.' }
        : { state: 'current', description: 'Em curso no dispositivo' };
    case 'FAILED':
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
      if (step.type === 'created') description = `${order.productName} · ${order.channel?.name ?? 'Registado na app'}`;
      if (step.type === 'activated' && order.events.some((e) => e.type === 'customer_notified')) {
        description = [event.description, 'Cliente notificado no WhatsApp'].filter(Boolean).join(' · ');
      }
      items.push({ key: step.type, title: step.title, description, time: formatTime(event.at, true), state: 'done' });
      continue;
    }

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
      if (!reachedOpenStep) {
        const expired = order.status === 'EXPIRED';
        const closing = lastOf(order.events, expired ? 'expired' : 'cancelled');
        items.push({
          key: expired ? 'expired' : 'cancelled',
          title: expired ? 'Pedido expirado' : 'Pedido cancelado',
          description: closing?.description ?? order.cancelReason ?? undefined,
          time: closing ? formatTime(closing.at, true) : undefined,
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
