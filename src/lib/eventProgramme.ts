import type { EventScheduleItem } from '../types.js';

export const eventProgrammeLimits = {
  rows: 24,
  title: 120,
  description: 400,
  dressCode: 180,
  admissionRules: 3000,
};

export function isEventScheduleItem(value: unknown): value is EventScheduleItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<EventScheduleItem>;
  return typeof row.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)
    && typeof row.title === 'string' && row.title.trim().length > 0 && row.title.length <= eventProgrammeLimits.title
    && (row.description === undefined || (typeof row.description === 'string' && row.description.length <= eventProgrammeLimits.description));
}

export function eventScheduleRows(value: unknown): EventScheduleItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEventScheduleItem).slice(0, eventProgrammeLimits.rows).map(row => ({
    time: row.time,
    title: row.title.trim(),
    description: row.description?.trim() || '',
  }));
}
