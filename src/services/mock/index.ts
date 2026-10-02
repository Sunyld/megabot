import type { Services } from '../types';
import { mockActivationTasksService, mockDeviceRegistryService, mockWorkerService } from './activation';
import { mockAuthService } from './auth';
import { mockDevicesService, mockProductsService, mockSimsService } from './catalog';
import { mockDashboardService } from './dashboard';
import { mockAutomationService, mockNotificationsService, mockWhatsAppService } from './engagement';
import { mockOrdersService } from './orders';
import { mockPaymentsService } from './payments';
import { mockPlatformAdminService } from './platformAdmin';
import {
  mockPaymentAccountsService,
  mockPaymentEventsService,
  mockPaymentMatchesService,
  mockPaymentProofsService,
} from './reconciliation';

export const mockServices: Services = {
  auth: mockAuthService,
  dashboard: mockDashboardService,
  orders: mockOrdersService,
  payments: mockPaymentsService,
  paymentAccounts: mockPaymentAccountsService,
  paymentEvents: mockPaymentEventsService,
  paymentProofs: mockPaymentProofsService,
  paymentMatches: mockPaymentMatchesService,
  products: mockProductsService,
  devices: mockDevicesService,
  sims: mockSimsService,
  deviceRegistry: mockDeviceRegistryService,
  activationTasks: mockActivationTasksService,
  worker: mockWorkerService,
  notifications: mockNotificationsService,
  whatsapp: mockWhatsAppService,
  automation: mockAutomationService,
  platformAdmin: mockPlatformAdminService,
};

export { setSimulation, simulationStore, useSimulation, type SimulationSettings } from './simulation';
