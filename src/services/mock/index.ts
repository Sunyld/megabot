import type { Services } from '../types';
import { mockAuthService } from './auth';
import { mockDevicesService, mockProductsService, mockSimsService } from './catalog';
import { mockDashboardService } from './dashboard';
import { mockAutomationService, mockNotificationsService, mockWhatsAppService } from './engagement';
import { mockOrdersService } from './orders';
import { mockPaymentsService } from './payments';
import { mockPlatformAdminService } from './platformAdmin';

export const mockServices: Services = {
  auth: mockAuthService,
  dashboard: mockDashboardService,
  orders: mockOrdersService,
  payments: mockPaymentsService,
  products: mockProductsService,
  devices: mockDevicesService,
  sims: mockSimsService,
  notifications: mockNotificationsService,
  whatsapp: mockWhatsAppService,
  automation: mockAutomationService,
  platformAdmin: mockPlatformAdminService,
};

export { orderFilterStatuses } from './orders';
export { setSimulation, simulationStore, useSimulation, type SimulationSettings } from './simulation';
