import type { PaymentForm } from "../lib/paymentRedirect.js";

export interface InvoiceRequest {
  reservationId: string;
  attempt: string;
  eventId?: string;
  kind?: "subscription";
  eventTitle: string;
  amountMinor: number;
  expiresAt: number;
  language: "AZ" | "EN" | "RU";
}

export interface PaymentGateway {
  provider?: string;
  create(request: InvoiceRequest): Promise<{ id: string; url?: string; form?: PaymentForm; checkoutExpiresAt?: number }>;
  status(invoiceId: string, amountMinor: number): Promise<"paid" | "expired" | "pending">;
}
