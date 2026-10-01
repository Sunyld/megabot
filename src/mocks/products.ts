import type { DataUnit, Operator, Product, ProductCategory, UssdFlow } from '@/types';

import { ago, TENANT_ID } from './helpers';

/*
 * Demo catalog for mock mode only — never seeded into a real database.
 * The USSD flows are illustrative: real flows are configured per product by
 * the tenant, from the operator's actual menus.
 */

const MENU_OPTION: Record<ProductCategory, string> = { daily: '1', weekly: '2', monthly: '3', unlimited: '4' };

function demoFlow(operator: Operator, category: ProductCategory): UssdFlow {
  if (operator === 'movitel') {
    return {
      version: 1,
      start: '*123#',
      steps: [
        { type: 'select', value: '3', label: 'Pacotes de internet' },
        { type: 'select', value: MENU_OPTION[category] },
        { type: 'input', source: 'destination_number' },
        { type: 'confirm', value: '1' },
      ],
      success: { contains: ['sucesso'] },
      failure: { contains: ['saldo insuficiente'] },
    };
  }
  return {
    version: 1,
    start: '*111#',
    steps: [
      { type: 'select', value: '5', label: 'Pacotes' },
      { type: 'select', value: '8', label: 'Oferecer pacote' },
      { type: 'select', value: MENU_OPTION[category] },
      { type: 'input', source: 'destination_number' },
      { type: 'input', source: 'amount_mb' },
      { type: 'confirm' },
    ],
    success: { contains: ['sucesso', 'activado'] },
    failure: { contains: ['saldo insuficiente'] },
  };
}

function toData(volumeMb: number | null): { dataAmount: number | null; dataUnit: DataUnit | null } {
  if (volumeMb === null) return { dataAmount: null, dataUnit: null };
  return volumeMb >= 1024 && volumeMb % 1024 === 0
    ? { dataAmount: volumeMb / 1024, dataUnit: 'GB' }
    : { dataAmount: volumeMb, dataUnit: 'MB' };
}

type Seed = [
  id: string,
  name: string,
  category: ProductCategory,
  volumeMb: number | null,
  price: number,
  validityHours: number,
  soldToday: number,
  extra?: Partial<Product>,
];

const seeds: Seed[] = [
  ['prd_400', '400 MB', 'daily', 400, 10, 24, 3],
  ['prd_600', '600 MB', 'daily', 600, 15, 24, 2],
  ['prd_800', '800 MB', 'daily', 800, 20, 24, 4],
  ['prd_1024', '1024 MB', 'daily', 1024, 24, 24, 5, { popular: true }],
  ['prd_1250', '1250 MB', 'daily', 1250, 30, 24, 7, { popular: true }],
  ['prd_2048', '2048 MB', 'daily', 2048, 45, 24, 2],
  ['prd_3072', '3072 MB', 'daily', 3072, 60, 24, 0, { status: 'INACTIVE' }],

  ['prd_w2', '2 GB Semanal', 'weekly', 2048, 70, 168, 1],
  ['prd_w5', '5 GB Semanal', 'weekly', 5120, 150, 168, 2, { popular: true }],
  ['prd_w10', '10 GB Semanal', 'weekly', 10240, 280, 168, 0, { operator: 'movitel' }],

  ['prd_m10', '10 GB Mensal', 'monthly', 10240, 400, 720, 1],
  ['prd_m20', '20 GB Mensal', 'monthly', 20480, 700, 720, 0],
  ['prd_m50', '50 GB Mensal', 'monthly', 51200, 1500, 720, 0, { status: 'INACTIVE' }],

  ['prd_u_night', 'Ilimitado Noite', 'unlimited', null, 25, 6, 1, {
    description: 'Navegação ilimitada das 00h às 06h.',
  }],
  ['prd_u_day', 'Ilimitado Diário', 'unlimited', null, 100, 24, 0],
  ['prd_u_week', 'Ilimitado Semanal', 'unlimited', null, 500, 168, 0, { status: 'INACTIVE', ussdFlow: null }],
];

export const mockProducts: Product[] = seeds.map(
  ([id, name, category, volumeMb, price, validityHours, soldToday, extra]) => {
    const operator = extra?.operator ?? 'vodacom';
    return {
      id,
      tenantId: TENANT_ID,
      name,
      description: null,
      category,
      price,
      currency: 'MZN',
      ...toData(volumeMb),
      validityHours,
      operator,
      status: 'ACTIVE',
      ussdFlow: demoFlow(operator, category),
      archivedAt: null,
      createdAt: ago({ days: 60 }),
      updatedAt: ago({ days: 3 }),
      soldToday,
      ...extra,
    };
  }
);
