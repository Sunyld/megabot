import type { AutomationSettings } from '@/types';

export { mockTasks } from './scenario';

export const mockAutomationSettings: AutomationSettings = {
  enabled: true,
  autoOrders: true,
  autoConfirm: true,
  autoUssd: true,
  failover: true,
  smsMonitoring: true,
};
