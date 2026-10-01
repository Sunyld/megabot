import type { Product, ProductCategory } from '@/types';

import { TENANT_ID } from './helpers';

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
  ['prd_3072', '3072 MB', 'daily', 3072, 60, 24, 0, { active: false }],

  ['prd_w2', '2 GB Semanal', 'weekly', 2048, 70, 168, 1],
  ['prd_w5', '5 GB Semanal', 'weekly', 5120, 150, 168, 2, { popular: true }],
  ['prd_w10', '10 GB Semanal', 'weekly', 10240, 280, 168, 0],

  ['prd_m10', '10 GB Mensal', 'monthly', 10240, 400, 720, 1],
  ['prd_m20', '20 GB Mensal', 'monthly', 20480, 700, 720, 0],
  ['prd_m50', '50 GB Mensal', 'monthly', 51200, 1500, 720, 0, { active: false }],

  ['prd_u_night', 'Ilimitado Noite', 'unlimited', null, 25, 6, 1, {
    description: 'Navegação ilimitada das 00h às 06h.',
  }],
  ['prd_u_day', 'Ilimitado Diário', 'unlimited', null, 100, 24, 0],
  ['prd_u_week', 'Ilimitado Semanal', 'unlimited', null, 500, 168, 0],
];

export const mockProducts: Product[] = seeds.map(
  ([id, name, category, volumeMb, price, validityHours, soldToday, extra]) => ({
    id,
    tenantId: TENANT_ID,
    name,
    category,
    volumeMb,
    price,
    validityHours,
    operator: 'vodacom',
    active: true,
    ussdTemplate: `*123*${id.replace('prd_', '').toUpperCase()}*{destination}#`,
    soldToday,
    ...extra,
  })
);
