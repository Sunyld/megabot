/**
 * Product rules shared by every backend and the product form. They mirror the
 * constraints of public.products (migration 003); the database enforces them
 * again and remains the final authority.
 */
import type { DataUnit, Operator, ProductCategory, ProductInput, ProductStatus } from '@/types';

import { AppError } from './errors';
import { validateUssdFlow } from './ussdFlow';

export const PRODUCT_RULES = {
  nameMin: 2,
  nameMax: 80,
  descriptionMax: 500,
  /** numeric(12, 2) */
  priceMax: 9_999_999_999.99,
  /** numeric(10, 2) */
  dataAmountMax: 99_999_999.99,
  validityMinHours: 1,
  validityMaxHours: 8784,
} as const;

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ['daily', 'weekly', 'monthly', 'unlimited'];
export const PRODUCT_STATUSES: readonly ProductStatus[] = ['ACTIVE', 'INACTIVE'];
export const PRODUCT_OPERATORS: readonly Operator[] = ['vodacom', 'movitel', 'tmcel'];
export const DATA_UNITS: readonly DataUnit[] = ['MB', 'GB'];

export type ProductField =
  | 'name'
  | 'description'
  | 'category'
  | 'price'
  | 'currency'
  | 'dataAmount'
  | 'validityHours'
  | 'operator'
  | 'status'
  | 'ussdFlow';

export type ProductFieldErrors = Partial<Record<ProductField, string>>;

const hasAtMostTwoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

const includes = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** Trims text, uppercases the currency and drops the unit of unlimited plans. */
export function normalizeProductInput(input: ProductInput): ProductInput {
  const description = input.description?.trim() ?? '';
  return {
    ...input,
    name: input.name.trim(),
    description: description || null,
    currency: input.currency.trim().toUpperCase(),
    dataUnit: input.dataAmount === null ? null : input.dataUnit,
  };
}

/** Field → message (pt-MZ). Empty when the product can be saved. */
export function validateProductInput(input: ProductInput): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  const name = input.name.trim();

  if (name.length < PRODUCT_RULES.nameMin || name.length > PRODUCT_RULES.nameMax) {
    errors.name = `O nome deve ter entre ${PRODUCT_RULES.nameMin} e ${PRODUCT_RULES.nameMax} caracteres.`;
  }
  if ((input.description?.trim().length ?? 0) > PRODUCT_RULES.descriptionMax) {
    errors.description = `A descrição tem no máximo ${PRODUCT_RULES.descriptionMax} caracteres.`;
  }
  if (!includes(PRODUCT_CATEGORIES, input.category)) errors.category = 'Escolha uma categoria.';

  if (!Number.isFinite(input.price) || input.price <= 0) {
    errors.price = 'Indique um preço maior que zero.';
  } else if (input.price > PRODUCT_RULES.priceMax || !hasAtMostTwoDecimals(input.price)) {
    errors.price = 'Preço inválido (no máximo 2 casas decimais).';
  }
  if (!/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())) errors.currency = 'Moeda inválida (ex.: MZN).';

  if (input.dataAmount === null) {
    if (input.category !== 'unlimited') errors.dataAmount = 'Indique a quantidade de dados.';
  } else if (
    !Number.isFinite(input.dataAmount) ||
    input.dataAmount <= 0 ||
    input.dataAmount > PRODUCT_RULES.dataAmountMax ||
    !hasAtMostTwoDecimals(input.dataAmount)
  ) {
    errors.dataAmount = 'Quantidade de dados inválida.';
  } else if (input.dataUnit === null || !includes(DATA_UNITS, input.dataUnit)) {
    errors.dataAmount = 'Escolha a unidade (MB ou GB).';
  }

  if (
    !Number.isInteger(input.validityHours) ||
    input.validityHours < PRODUCT_RULES.validityMinHours ||
    input.validityHours > PRODUCT_RULES.validityMaxHours
  ) {
    errors.validityHours = 'A validade deve estar entre 1 hora e 366 dias.';
  }
  if (!includes(PRODUCT_OPERATORS, input.operator)) errors.operator = 'Escolha a operadora.';
  if (!includes(PRODUCT_STATUSES, input.status)) errors.status = 'Estado inválido.';

  if (input.ussdFlow !== null) {
    const [issue] = validateUssdFlow(input.ussdFlow);
    if (issue) errors.ussdFlow = issue.message;
  } else if (input.status === 'ACTIVE') {
    errors.ussdFlow = 'Configure o USSD antes de pôr o produto à venda.';
  }
  return errors;
}

/** Normalizes and validates; throws VALIDATION_ERROR (reason INVALID_PRODUCT) with the first problem. */
export function assertValidProductInput(input: ProductInput): ProductInput {
  const normalized = normalizeProductInput(input);
  const [first] = Object.values(validateProductInput(normalized));
  if (first) throw new AppError('VALIDATION_ERROR', first, { reason: 'INVALID_PRODUCT' });
  return normalized;
}
