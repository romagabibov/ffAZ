import { readApiJson } from './apiClient';
import type { TicketCheckoutState, TicketInventory } from './ticketCheckout';

export function updateTicketCheckout(action: 'reserve' | 'purchase' | 'pay' | 'check-payment', body: Record<string, unknown>) {
  return readApiJson<TicketCheckoutState>('/api/tickets/' + action, { method: 'POST', body: JSON.stringify(body) });
}

export async function readTicketInventory(eventId: string, signal?: AbortSignal): Promise<TicketInventory> {
  const response = await fetch('/api/public/ticket-availability/' + encodeURIComponent(eventId), { credentials: 'omit', signal });
  if (!response.ok) throw new Error('Ticket inventory unavailable');
  return response.json();
}
