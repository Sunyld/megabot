import type { ID, ISODateString, Operator, TenantScoped } from './common';
import type { UssdFlow } from './ussd';

export type ProductCategory = 'daily' | 'weekly' | 'monthly' | 'unlimited';

/** Mirrors products.status. Only ACTIVE products can be sold. */
export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export type DataUnit = 'MB' | 'GB';

/** A package sold by the tenant (public.products, migration 003). */
export type Product = TenantScoped & {
  id: ID;
  name: string;
  description: string | null;
  category: ProductCategory;
  /** Exact amount in the currency's major unit (e.g. 24.5 MZN). */
  price: number;
  /** ISO 4217 code stored with the product (tenant currency by default). */
  currency: string;
  /** Data volume; both `null` for unlimited plans. */
  dataAmount: number | null;
  dataUnit: DataUnit | null;
  validityHours: number;
  /** Network of the data package — where its USSD runs. */
  operator: Operator;
  status: ProductStatus;
  /** Product-specific USSD flow; `null` until configured (then it cannot be ACTIVE). */
  ussdFlow: UssdFlow | null;
  /** Soft delete: archived products are hidden and frozen, kept for history. */
  archivedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Sales today — computed from orders (0 until Orders are on the backend). */
  soldToday: number;
  /** Demo-only highlight. */
  popular?: boolean;
};

/** Editable fields, used to create and to update a product. */
export type ProductInput = {
  name: string;
  description: string | null;
  category: ProductCategory;
  price: number;
  currency: string;
  dataAmount: number | null;
  dataUnit: DataUnit | null;
  validityHours: number;
  operator: Operator;
  status: ProductStatus;
  ussdFlow: UssdFlow | null;
};
