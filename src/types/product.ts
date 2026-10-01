import type { ID, Operator, TenantScoped } from './common';

export type ProductCategory = 'daily' | 'weekly' | 'monthly' | 'unlimited';

export type Product = TenantScoped & {
  id: ID;
  name: string;
  category: ProductCategory;
  /** Data volume in MB. `null` for unlimited plans. */
  volumeMb: number | null;
  /** Price in meticais (MT). */
  price: number;
  validityHours: number;
  operator: Operator;
  active: boolean;
  /**
   * USSD template executed by the activation worker. `{destination}` is
   * replaced by the customer's number. Consumed by the future USSD engine.
   */
  ussdTemplate: string;
  soldToday: number;
  popular?: boolean;
  description?: string;
};
