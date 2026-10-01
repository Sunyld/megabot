/**
 * Helpers for building believable, time-relative mock data. Timestamps are
 * anchored to app start so relative labels ("há 12 min") always make sense.
 */

export const TENANT_ID = 'tnt_bytestore';

export const MOCK_NOW = Date.now();

const MINUTE = 60_000;

export function ago({ minutes = 0, hours = 0, days = 0, seconds = 0 }): string {
  return new Date(
    MOCK_NOW - seconds * 1000 - minutes * MINUTE - hours * 60 * MINUTE - days * 24 * 60 * MINUTE
  ).toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/** Start of the current local day, in ms. */
export function startOfToday(): number {
  const d = new Date(MOCK_NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Deterministic PRNG (mulberry32) so generated data is stable between reloads. */
export function createRandom(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    weighted: <T>(items: readonly { value: T; weight: number }[]) => {
      const total = items.reduce((sum, item) => sum + item.weight, 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item.value;
      }
      return items[items.length - 1].value;
    },
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** e-Mola style transaction ID: PPyyMMdd.HHmm.xxxxxx */
export function emolaTransactionId(iso: string, suffix: string): string {
  const d = new Date(iso);
  return `PP${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${pad(d.getHours())}${pad(d.getMinutes())}.${suffix}`;
}

/** M-Pesa style transaction ID: 10 uppercase alphanumerics. */
export function mpesaTransactionId(seed: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 0;
  for (const ch of seed) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  let id = '';
  for (let i = 0; i < 10; i++) {
    // 32-bit LCG; Math.imul keeps the multiplication exact.
    hash = (Math.imul(hash, 1103515245) + 12345) >>> 0;
    id += alphabet[(hash >>> 16) % alphabet.length];
  }
  return id;
}

export function formatSmsDate(iso: string) {
  const d = new Date(iso);
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}
