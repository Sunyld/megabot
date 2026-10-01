import type { Product, ProductCategory } from '@/types';

import { formatNumber } from './format';

const sections: { category: ProductCategory; title: string }[] = [
  { category: 'daily', title: '🔥 PACOTES DIÁRIOS' },
  { category: 'weekly', title: '📅 PACOTES SEMANAIS' },
  { category: 'monthly', title: '🗓️ PACOTES MENSAIS' },
  { category: 'unlimited', title: '♾️ ILIMITADOS' },
];

export type PriceTableOptions = {
  storeName: string;
  paymentAccounts?: { label: string; account: string }[];
};

/**
 * Builds the WhatsApp price table sent when a customer asks for "tabela".
 * Only active products are listed. Shared by the product preview in the app
 * and (later) by the message processor on the backend.
 */
export function buildPriceTable(products: Product[], { storeName, paymentAccounts = [] }: PriceTableOptions): string {
  const lines: string[] = [
    '╔══════════════════╗',
    `   🌐 ${storeName} 🌐`,
    '╚══════════════════╝',
    '',
    '📋 TABELA ATUALIZADA',
  ];

  for (const { category, title } of sections) {
    const items = products
      .filter((p) => p.status === 'ACTIVE' && p.category === category)
      .sort((a, b) => a.price - b.price);
    if (!items.length) continue;
    lines.push('', title, '');
    for (const p of items) lines.push(`💠 ${p.name} → ${formatNumber(p.price)} MT`);
  }

  if (paymentAccounts.length) {
    lines.push('', '💳 PAGAMENTO', '');
    for (const { label, account } of paymentAccounts) lines.push(`▪️ ${label}: ${account}`);
  }

  lines.push('', '📲 Responda com o pacote desejado (ex: 1250)');
  return lines.join('\n');
}
