import type { DataUnit, UssdFlow, UssdInputSource, UssdStepType } from '@/types';

export const ussdStepTypeLabels: Record<UssdStepType, string> = {
  select: 'Opção',
  input: 'Inserir',
  confirm: 'Confirmar',
  wait: 'Esperar',
};

export const ussdSourceLabels: Record<UssdInputSource, string> = {
  destination_number: 'Número do cliente',
  amount_mb: 'Quantidade (MB)',
  amount_gb: 'Quantidade (GB)',
  price: 'Preço',
};

const formatSeconds = (ms: number) => `${String(ms / 1000).replace('.', ',')} s`;

/**
 * One-line view of a flow: "*111# › 5 › 8 › {Número do cliente} › 1".
 * `values` fills the inputs when they are known (e.g. an order's number).
 */
export function describeUssdFlow(flow: UssdFlow, values: Partial<Record<UssdInputSource, string>> = {}): string {
  const steps = flow.steps.map((step) => {
    switch (step.type) {
      case 'select':
        return step.value;
      case 'input':
        return values[step.source] || `{${ussdSourceLabels[step.source]}}`;
      case 'confirm':
        return step.value ?? '1';
      case 'wait':
        return `⏱ ${formatSeconds(step.ms)}`;
    }
  });
  return [flow.start, ...steps].join(' › ');
}

/** Data volume in MB (1 GB = 1024 MB, as operators count it); `null` for unlimited plans. */
export function dataInMegabytes(amount: number | null, unit: DataUnit | null): number | null {
  if (amount === null || unit === null) return null;
  return unit === 'GB' ? amount * 1024 : amount;
}

/** Values a product's flow can use at execution time (the customer number comes from the order). */
export function ussdValuesFor(
  product: { dataAmount: number | null; dataUnit: DataUnit | null; price: number },
  destination?: string | null
): Partial<Record<UssdInputSource, string>> {
  const mb = dataInMegabytes(product.dataAmount, product.dataUnit);
  return {
    ...(destination ? { destination_number: destination } : {}),
    ...(mb !== null ? { amount_mb: String(Math.round(mb)), amount_gb: String(Math.round((mb / 1024) * 100) / 100) } : {}),
    price: String(product.price),
  };
}
