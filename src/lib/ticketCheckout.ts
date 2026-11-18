import type { PaymentRedirect } from './paymentRedirect';

export const ticketHoldMs = 6 * 60 * 60 * 1000;
export const defaultTierName = 'Admission Pass';
export const maxTicketsPerReservation = 3;

export type TicketInventory = { availableTickets: number | null; nextReleaseAt: number | null };
export type TicketCheckoutState =
  | { status: 'available' | 'expired'; paymentsEnabled: boolean; inventory?: TicketInventory }
  | ({ status: 'reserved' | 'confirming'; expiresAt: number; price: number; quantity: number; tierName: string;
      paymentsEnabled: boolean; checkoutStarted: boolean; inventory?: TicketInventory } & PaymentRedirect)
  | { status: 'issued'; success: true; ticketId: string; ticketIds: string[]; qrCodeData: string; price: number; quantity: number;
      tierName: string; inventory?: TicketInventory };

export function ticketAmountMinor(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim().replace(/\s*(?:AZN|₼)$/i, '').replace(',', '.') : value;
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(raw))) return null;
  const amount = Number(raw);
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && minor >= 0 && Math.abs(amount * 100 - minor) < 0.0001 ? minor : null;
}

export function externalTicketLink(event: { externalTicketUrl?: unknown; ticketUrl?: unknown; bookingUrl?: unknown }): string {
  for (const field of [event.externalTicketUrl, event.ticketUrl, event.bookingUrl]) {
    if (typeof field !== 'string' || !field.trim()) continue;
    const raw = field.trim();
    try {
      const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.hostname.includes('.')) return parsed.href;
    } catch {}
  }
  return '';
}
