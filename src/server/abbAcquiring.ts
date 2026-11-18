import crypto from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { ticketAmountMinor } from "../lib/ticketCheckout.js";
import type { InvoiceRequest, PaymentGateway } from "./paymentGateway.js";
import { fail } from "./security.js";

// Azericard e-commerce RSA/SHA256 profile. Configure only with an ABB ePOS terminal using this protocol.
const authorizationFields = ["AMOUNT", "CURRENCY", "TERMINAL", "TRTYPE", "TIMESTAMP", "NONCE", "MERCH_URL"] as const;
const inquiryFields = ["ORDER", "TERMINAL", "TRTYPE", "TIMESTAMP", "NONCE"] as const;
const responseFields = ["AMOUNT", "TERMINAL", "APPROVAL", "RRN", "INT_REF"] as const;
const publicOrder = /^\d{14}$/;
const bankReference = /^[a-zA-Z0-9_-]{1,128}$/;

export function abbSignatureInput(source: Record<string, unknown>, fields: readonly string[]): Buffer {
  return Buffer.from(fields.map(field => {
    const value = source[field];
    if (typeof value !== "string" || !value.length) return "-";
    return Buffer.byteLength(value, "ascii") + value;
  }).join(""), "ascii");
}

interface StoredInvoice {
  id: string;
  terminal: string;
  amountMinor: number;
  reservationId: string;
  attempt: string;
  kind: "ticket" | "subscription";
  eventId?: string;
  createdAt: number;
  lastBankActionAt: number;
  resolution?: "paid" | "expired";
}

interface AbbGateway extends PaymentGateway {
  callback(payload: unknown): Promise<StoredInvoice | null>;
  returnUrl(invoice: StoredInvoice): string;
}

export function configuredAbbGateway(db: Firestore, env = process.env, request: typeof fetch = fetch): AbbGateway | null {
  const sandbox = env.ABB_EPOS_GATEWAY_URL === "https://testmpi.3dsecure.az/cgi-bin/cgi_link";
  const production = env.ABB_EPOS_GATEWAY_URL === "https://mpi.3dsecure.az/cgi-bin/cgi_link";
  const testing = !env.VERCEL_ENV && env.VITE_USE_EMULATORS === "true" && Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (!(production && env.VERCEL_ENV === "production") && !(sandbox && testing)) return null;
  const address = env.ABB_EPOS_GATEWAY_URL!;
  const terminal = env.ABB_EPOS_TERMINAL?.trim() || "";
  const merchant = env.ABB_EPOS_MERCHANT_NAME?.trim() || "";
  const windowSeconds = Number(env.ABB_EPOS_CHECKOUT_TTL_SECONDS || 0);
  if (!/^\d{8}$/.test(terminal) || !merchant || merchant.length > 50 ||
      !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3600 ||
      !env.ABB_EPOS_MERCHANT_PRIVATE_KEY || !env.ABB_EPOS_GATEWAY_PUBLIC_KEY || !env.APP_URL) return null;
  let origin: URL, privateKey: crypto.KeyObject, bankKey: crypto.KeyObject;
  try {
    origin = new URL(env.APP_URL);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return null;
    privateKey = crypto.createPrivateKey(env.ABB_EPOS_MERCHANT_PRIVATE_KEY.replace(/\\n/g, "\n"));
    bankKey = crypto.createPublicKey(env.ABB_EPOS_GATEWAY_PUBLIC_KEY.replace(/\\n/g, "\n"));
    if ([privateKey, bankKey].some(key => key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)) return null;
  } catch {
    return null;
  }

  const collection = (key: string) => db.doc(`abbPaymentOrders/${key}`);
  const clock = (date: number) => new Date(date).toISOString().slice(0, 19).replace(/\D/g, "");
  const nonce = () => crypto.randomBytes(16).toString("hex");
  function sign(fields: Record<string, string>, ordered: readonly string[]) {
    return crypto.sign("RSA-SHA256", abbSignatureInput(fields, ordered), privateKey).toString("hex").toUpperCase();
  }
  function validResponse(data: any) {
    const signature = data?.P_SIGN;
    if (typeof signature !== "string" || !/^[a-f0-9]{512,1024}$/i.test(signature)) return false;
    return responseFields.every(field => data[field] === undefined || (
      typeof data[field] === "string" && data[field].length <= 128 && /^[\x20-\x7E]*$/.test(data[field])
    )) && crypto.verify("RSA-SHA256", abbSignatureInput(data, responseFields), bankKey, Buffer.from(signature, "hex"));
  }
  function matchesInvoice(payload: any, invoice: StoredInvoice) {
    return payload?.ORDER === invoice.id && payload.TERMINAL === invoice.terminal &&
      payload.CURRENCY === "AZN" && ticketAmountMinor(payload.AMOUNT) === invoice.amountMinor;
  }

  async function create(order: InvoiceRequest) {
    const at = Date.now();
    const validUntil = at + windowSeconds * 1000;
    if (validUntil > order.expiresAt) return fail(409, "Оставшегося времени недостаточно для оплаты через банк", "payment_window_too_short");
    const day = clock(at).slice(0, 8);
    const serial = db.doc(`abbPaymentSequences/${day}`);
    const invoice = await db.runTransaction(async transaction => {
      const previous = (await transaction.get(serial)).get("last") ?? 0;
      const next = previous + 1;
      if (!Number.isSafeInteger(next) || next < 1 || next > 999999) return fail(503, "Касса временно недоступна");
      const id = day + String(next).padStart(6, "0");
      const result: StoredInvoice = {
        id, terminal, amountMinor: order.amountMinor, reservationId: order.reservationId, attempt: order.attempt,
        kind: order.kind || "ticket", ...(order.eventId ? { eventId: order.eventId } : {}),
        createdAt: at, lastBankActionAt: validUntil,
      };
      transaction.set(serial, { last: next });
      transaction.create(collection(id), result);
      return result;
    });
    const fields = {
      AMOUNT: (order.amountMinor / 100).toFixed(2),
      CURRENCY: "AZN",
      ORDER: invoice.id,
      DESC: order.eventTitle.slice(0, 50) || "AZ/FSHN",
      MERCH_NAME: merchant,
      MERCH_URL: origin.origin,
      MERCH_GMT: "+4",
      COUNTRY: "AZ",
      TERMINAL: terminal,
      TRTYPE: "1",
      TIMESTAMP: clock(at),
      NONCE: nonce(),
      BACKREF: origin.origin + "/api/payments/abb/callback",
      LANG: order.language,
    };
    return { id: invoice.id, checkoutExpiresAt: validUntil, form: { action: address, fields: { ...fields, P_SIGN: sign(fields, authorizationFields) } } };
  }

  async function status(orderId: string, amountMinor: number) {
    if (!publicOrder.test(orderId)) return fail(409, "Счёт относится к прежнему платёжному провайдеру", "payment_provider_mismatch");
    const ref = collection(orderId);
    const invoice = (await ref.get()).data() as StoredInvoice | undefined;
    if (!invoice || invoice.amountMinor !== amountMinor || invoice.terminal !== terminal) return fail(502, "Банк не подтвердил реквизиты счёта");
    if (invoice.resolution) return invoice.resolution;
    const fields = { TRAN_TRTYPE: "1", ORDER: orderId, TERMINAL: terminal, TRTYPE: "90", TIMESTAMP: clock(Date.now()), NONCE: nonce() };
    let answer: any;
    try {
      const response = await request(address, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ ...fields, P_SIGN: sign(fields, inquiryFields) }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("Bank inquiry failed");
      answer = await response.json();
    } catch {
      return fail(502, "Банк пока не вернул статус платежа", "payment_provider_unavailable");
    }
    // The callback signature alone does not bind ORDER and the outcome fields. Check them in
    // the independent TLS inquiry, and require the response signature for this terminal profile.
    if (!matchesInvoice(answer, invoice) || !validResponse(answer)) return "pending" as const;
    const originalType = answer.TRAN_TRTYPE ?? answer.TRTYPE;
    if (originalType !== "1") return "pending" as const;
    if (answer.ACTION === "0" && answer.RC === "00" && bankReference.test(answer.RRN || "") &&
        bankReference.test(answer.INT_REF || "") && (!answer.APPROVAL || bankReference.test(answer.APPROVAL))) {
      await ref.update({ resolution: "paid" });
      return "paid" as const;
    }
    if (answer.ACTION === "2" && typeof answer.RC === "string" && /^\d{2}$/.test(answer.RC) &&
        answer.RC !== "00" && Date.now() >= invoice.lastBankActionAt) {
      await ref.update({ resolution: "expired" });
      return "expired" as const;
    }
    return "pending" as const;
  }

  async function callback(data: any) {
    if (data?.TRTYPE !== "1" || typeof data.ORDER !== "string" || !publicOrder.test(data.ORDER) || !validResponse(data)) return null;
    const invoice = (await collection(data.ORDER).get()).data() as StoredInvoice | undefined;
    return invoice && matchesInvoice(data, invoice) ? invoice : null;
  }

  return {
    provider: "abb",
    create,
    status,
    callback,
    returnUrl: invoice => new URL(invoice.kind === "subscription" ? "/plans?checkout=1" : "/event/" + encodeURIComponent(invoice.eventId || "") + "?checkout=1", origin).href,
  };
}
