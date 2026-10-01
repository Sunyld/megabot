export type ID = string;

/** ISO-8601 timestamp, as returned by the backend (`timestamptz`). */
export type ISODateString = string;

/**
 * Every tenant-owned record carries its tenant. The mock layer already filters
 * by it; the Supabase layer will enforce it with Row Level Security.
 */
export type TenantScoped = {
  tenantId: ID;
};

/** A JSON value as stored in jsonb columns (no `undefined`, no functions). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Operator = 'vodacom' | 'movitel' | 'tmcel';

export type PaymentMethod = 'mpesa' | 'emola' | 'mkesh';

export type Severity = 'success' | 'info' | 'warning' | 'danger';
