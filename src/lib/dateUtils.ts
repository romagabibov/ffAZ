/** Accepts dates from the client SDK, Admin SDK JSON, and older records. */
export function getTimestampMillis(value: any): number {
  let millis: number;
  try {
    if (typeof value === 'number') millis = value;
    else if (typeof value === 'string') millis = Date.parse(value);
    else if (typeof value?.toMillis === 'function') millis = value.toMillis();
    else if (typeof value?.toDate === 'function') millis = value.toDate().getTime();
    else if (value instanceof Date) millis = value.getTime();
    else {
      const seconds = value?.seconds ?? value?._seconds;
      const nanoseconds = value?.nanoseconds ?? value?._nanoseconds ?? 0;
      millis = typeof seconds === 'number' && typeof nanoseconds === 'number'
        ? seconds * 1000 + Math.floor(nanoseconds / 1_000_000)
        : 0;
    }
  } catch {
    return 0;
  }
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? millis : 0;
}

export function formatSafeDate(value: unknown, locale = 'en-US'): string {
  const millis = getTimestampMillis(value);
  return millis ? new Date(millis).toLocaleDateString(locale) : '';
}

export function parseEventDate(value: unknown): Date | null {
  const millis = getTimestampMillis(value);
  if (!millis) return null;
  return new Date(typeof value === 'number' && Math.abs(millis) < 10_000_000_000 ? millis * 1000 : millis);
}

const dayMs = 86_400_000;
const bakuOffsetMs = 4 * 60 * 60 * 1000;

export function formatBakuEventInput(value: unknown): string {
  const date = parseEventDate(value);
  return date ? new Date(date.getTime() + bakuOffsetMs).toISOString().slice(0, 16) : '';
}

export function parseBakuEventInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const millis = Date.parse(value + ':00+04:00');
  return Number.isFinite(millis) && new Date(millis + bakuOffsetMs).toISOString().slice(0, 16) === value ? millis : null;
}

export function eventEndMillis(event: { date?: unknown; endDate?: unknown }): number {
  const start = parseEventDate(event.date)?.getTime() || 0;
  const end = parseEventDate(event.endDate)?.getTime() || 0;
  if (end && end >= start) return end;
  if (!start) return 0;
  // When the organiser only supplied a start time, keep the event for that day in Baku.
  return (Math.floor((start + bakuOffsetMs) / dayMs) + 1) * dayMs - bakuOffsetMs - 1;
}

export function monthsAfterBaku(value: number, months: number): number {
  if (!value) return 0;
  const date = new Date(value + bakuOffsetMs);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, monthEnd));
  return date.getTime() - bakuOffsetMs;
}

export function ticketRetention(end: number) {
  return end > 0 ? { eventEndedAt: end, expiresAt: monthsAfterBaku(end, 6) } : {};
}
