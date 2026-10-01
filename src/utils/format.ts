/**
 * Formatting helpers (pt-MZ conventions). Implemented by hand instead of Intl
 * so output is identical on every JS engine / Android version.
 */

const pad = (n: number) => String(n).padStart(2, '0');

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 1840 → "1.840" · 1840.5 → "1.840,50" */
export function formatNumber(value: number, decimals?: number): string {
  const fixed = decimals ?? (Number.isInteger(value) ? 0 : 2);
  const [int, frac] = Math.abs(value).toFixed(fixed).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** 30 → "30 MT" */
export function formatMoney(value: number): string {
  return `${formatNumber(value)} MT`;
}

/** Compact figures for tight tiles: 12900 → "12,9 mil". */
export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(Math.round(value / 100_000) / 10)} M`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(Math.round(value / 100) / 10)} mil`;
  return formatNumber(value);
}

/** 0.962 → "96%" */
export function formatPercent(fraction: number, decimals = 0): string {
  return `${formatNumber(Number((fraction * 100).toFixed(decimals)), decimals)}%`;
}

/** 0.12 → "+12%" */
export function formatDelta(fraction: number): string {
  const sign = fraction > 0 ? '+' : fraction < 0 ? '−' : '';
  return `${sign}${formatPercent(Math.abs(fraction))}`;
}

/** Megabytes → "1250 MB" / "8,2 GB" */
export function formatData(mb: number): string {
  if (mb >= 1024) {
    const gb = Math.round((mb / 1024) * 10) / 10;
    return `${formatNumber(gb, Number.isInteger(gb) ? 0 : 1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

/** Validity in hours → "24 horas" / "7 dias" / "30 dias" */
export function formatValidity(hours: number): string {
  if (hours < 24) return `${hours} horas`;
  if (hours === 24) return '24 horas';
  const days = Math.round(hours / 24);
  return `${days} dias`;
}

/** Mozambican numbers: "840745232" → "84 074 5232", "+258840745232" → "+258 84 074 5232" */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('258') && digits.length === 12 ? digits.slice(3) : digits;
  const prefix = local === digits ? '' : '+258 ';
  if (local.length !== 9) return raw;
  return `${prefix}${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
}

/** Masks all but the last 4 digits: "845550218" → "•••• 0218" */
export function maskPhone(raw: string): string {
  return `•••• ${raw.replace(/\D/g, '').slice(-4)}`;
}

export function formatTime(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(iso: string, withSeconds = false): string {
  return `${formatDate(iso)} ${formatTime(iso, withSeconds)}`;
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Hoje" · "Ontem" · "28 set" */
export function formatDayLabel(iso: string, now = Date.now()): string {
  const day = startOfDay(new Date(iso).getTime());
  const today = startOfDay(now);
  if (day === today) return 'Hoje';
  if (day === today - 86_400_000) return 'Ontem';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function isSameDay(a: string | number, b: string | number): boolean {
  return startOfDay(new Date(a).getTime()) === startOfDay(new Date(b).getTime());
}

/** "agora" · "há 12 min" · "há 3 h" · "ontem" · "28 set" */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && isSameDay(iso, now)) return `há ${hours} h`;
  const label = formatDayLabel(iso, now);
  return label === 'Ontem' ? 'ontem' : label;
}

/** Long form used in sentences: "há 12 minutos". */
export function formatRelativeLong(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes === 1) return 'há 1 minuto';
  if (minutes < 60) return `há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'há 1 hora';
  if (hours < 24) return `há ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

/** 38 → "38 s" · 72 → "1 min 12 s" */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 19) return 'Boa tarde';
  return 'Boa noite';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
