import crypto from "node:crypto";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { defaultTierName, externalTicketLink, maxTicketsPerReservation, ticketAmountMinor, ticketHoldMs, type TicketCheckoutState, type TicketInventory } from "../lib/ticketCheckout.js";
import type { PaymentForm } from "../lib/paymentRedirect.js";
import { fail, hash, now } from "./security.js";
import { eventEndMillis, getTimestampMillis, ticketRetention } from "../lib/dateUtils.js";
import type { PaymentGateway } from "./paymentGateway.js";

const paymentStockLock = 253402300799000;
const invoiceLeaseMs = 20_000;

interface Reservation {
  eventId: string;
  eventTitle?: string;
  userId: string;
  attempt: string;
  state: "held" | "issued" | "expired";
  tierName: string;
  priceMinor: number;
  quantity?: number;
  expiresAt: number;
  invoiceId?: string;
  paymentUrl?: string;
  paymentForm?: PaymentForm;
  checkoutExpiresAt?: number;
  lease?: string;
  leaseUntil?: number;
}
const nonNegative = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const seats = (order: Reservation) => order.quantity ?? 1;
const holdCollection = (db: Firestore, eventId: string) => db.collection(`events/${eventId}/ticketHolds`);

function seatRefs(db: Firestore, order: Reservation, key: string) {
  return Array.from({ length: seats(order) }, (_, index) =>
    holdCollection(db, order.eventId).doc(index === 0 ? key : `${key}_${index + 1}`));
}

export function ticketStock(event: any) {
  const capacity = nonNegative(event.totalTickets) ?? nonNegative(event.ticketCapacity) ?? nonNegative(event.capacity) ?? 0;
  const storedAvailability = nonNegative(event.availableTickets);
  const sold = Math.max(nonNegative(event.ticketsSold) ?? 0, capacity - (storedAvailability ?? capacity));
  const available = capacity > 0 ? Math.max(0, capacity - sold) : storedAvailability ?? Infinity;
  return { available, sold };
}

export async function heldTicketCount(db: Firestore, transaction: Transaction, eventId: string, at: number) {
  const result = await transaction.get(holdCollection(db, eventId).where("until", ">", at).count());
  return result.data().count;
}

export function createTicketCheckout(db: Firestore, gateway: PaymentGateway | null) {
  const orderRef = (key: string) => db.doc(`ticketReservations/${key}`);
  const ticketRef = (key: string) => db.doc(`tickets/${key}`);
  const keyFor = (eventId: string, userId: string) => hash(`${eventId}|${userId}|free`);

  function issued(key: string, ticket: any): TicketCheckoutState {
    const expires = getTimestampMillis(ticket?.expiresAt);
    if (!ticket || !["active", "used"].includes(ticket.status) || (expires && expires <= now())) fail(409, "Этот билет больше недоступен");
    const ticketIds = Array.isArray(ticket.ticketIds) ? ticket.ticketIds : [key];
    return { status: "issued", success: true, ticketId: key, ticketIds, qrCodeData: ticket.qrCodeData,
      tierName: ticket.tierName || defaultTierName, price: (ticket.totalPrice || 0) * ticketIds.length, quantity: ticketIds.length };
  }

  function view(order?: Reservation): TicketCheckoutState {
    const paymentsEnabled = Boolean(gateway);
    if (!order) return { status: "available", paymentsEnabled };
    if (order.state === "expired" || (order.expiresAt <= now() && !order.invoiceId)) return { status: "expired", paymentsEnabled };
    const live = order.expiresAt > now();
    const open = live && (!order.checkoutExpiresAt || order.checkoutExpiresAt > now());
    return {
      status: live ? "reserved" : "confirming", expiresAt: order.expiresAt,
      tierName: order.tierName, quantity: seats(order), price: order.priceMinor * seats(order) / 100,
      ...(open && order.paymentUrl ? { paymentUrl: order.paymentUrl } : {}),
      ...(open && order.paymentForm ? { paymentForm: order.paymentForm } : {}),
      paymentsEnabled, checkoutStarted: Boolean(order.invoiceId),
    };
  }

  function purchase(transaction: Transaction, order: Reservation, key: string, event: any) {
    if (!event) return fail(409, "Мероприятие больше недоступно");
    const { available, sold } = ticketStock(event);
    const quantity = seats(order);
    if (available < quantity) return fail(409, "Билеты закончились");
    const at = now();
    const keys = Array.from({ length: quantity }, (_, index) => index === 0 ? key : hash(`${key}|seat|${index + 1}`));
    const tickets = keys.map((ticketId, index) => {
      const token = crypto.randomBytes(32).toString("base64url");
      return {
        id: ticketId, eventId: order.eventId, userId: order.userId, eventTitle: event.title || "",
        eventDate: event.date || "", eventLocation: event.location || "", ticketType: "standard",
        tierName: order.tierName, quantity: 1, totalPrice: order.priceMinor / 100, currency: "AZN",
        ...ticketRetention(eventEndMillis(event)),
        status: "active", purchaseDate: at, createdAt: Timestamp.fromMillis(at),
        qrCode: token, qrCodeData: token, qrTokenHash: hash(token),
        ...(index === 0 ? { ticketIds: keys } : {}),
      };
    });
    tickets.forEach(ticket => transaction.create(ticketRef(ticket.id), ticket));
    transaction.update(db.doc(`events/${order.eventId}`), {
      ticketsSold: sold + quantity,
      ...(Number.isFinite(available) ? { availableTickets: available - quantity } : {}),
      ticketInventoryRevision: FieldValue.increment(1),
    });
    if (order.invoiceId) {
      transaction.create(db.doc(`transactions/${key}`), {
        userId: order.userId, eventId: order.eventId, ticketId: key, ticketIds: keys, quantity,
        invoiceId: order.invoiceId, amount: order.priceMinor * quantity / 100, currency: "AZN",
        status: "completed", type: "ticket", provider: gateway?.provider || "abb", createdAt: at,
      });
    }
    transaction.set(orderRef(key), { ...order, state: "issued", paymentUrl: null, paymentForm: null, checkAt: null });
    for (const hold of seatRefs(db, order, key)) transaction.delete(hold);
    return issued(key, tickets[0]);
  }

  async function syncInvoice(key: string, order: Reservation) {
    if (!gateway || !order.invoiceId || order.state !== "held") return;
    const status = await gateway.status(order.invoiceId, order.priceMinor * seats(order));
    if (status === "pending" && order.expiresAt > now()) return;
    await db.runTransaction(async transaction => {
      const current = (await transaction.get(orderRef(key))).data() as Reservation | undefined;
      if (!current || current.state !== "held" || current.invoiceId !== order.invoiceId || current.attempt !== order.attempt) return;
      if (status === "paid") {
        const event = (await transaction.get(db.doc(`events/${current.eventId}`))).data();
        purchase(transaction, current, key, event);
      } else if (status === "expired") {
        const live = current.expiresAt > now();
        transaction.update(orderRef(key), { state: live ? "held" : "expired", invoiceId: FieldValue.delete(),
          paymentUrl: FieldValue.delete(), paymentForm: FieldValue.delete(), checkoutExpiresAt: FieldValue.delete(),
          leaseUntil: FieldValue.delete(), checkAt: FieldValue.delete() });
        for (const hold of seatRefs(db, current, key)) {
          if (live) transaction.set(hold, { orderKey: key, until: current.expiresAt });
          else transaction.delete(hold);
        }
        transaction.update(db.doc(`events/${current.eventId}`), { ticketInventoryRevision: FieldValue.increment(1) });
      } else {
        const checkAt = now() + 5 * 60_000;
        transaction.update(orderRef(key), { checkAt });
        transaction.update(holdCollection(db, current.eventId).doc(key), { checkAt });
      }
    });
  }

  async function reconcile(entries: { key: string; order: Reservation }[]) {
    const results = await Promise.allSettled(entries.map(({ key, order }) => syncInvoice(key, order)));
    return { checked: entries.length, failed: results.filter(result => result.status === "rejected").length };
  }

  async function inventory(eventId: string): Promise<TicketInventory> {
    const at = now();
    return db.runTransaction(async transaction => {
      const event = (await transaction.get(db.doc(`events/${eventId}`))).data();
      if (!event) return fail(404, "Мероприятие не найдено");
      const end = eventEndMillis(event);
      if (event.status === "cancelled" || (end && end <= at)) return { availableTickets: 0, nextReleaseAt: null };
      const { available } = ticketStock(event);
      if (!Number.isFinite(available)) return { availableTickets: null, nextReleaseAt: null };
      const [held, first] = await Promise.all([
        heldTicketCount(db, transaction, eventId, at),
        transaction.get(holdCollection(db, eventId).where("until", ">", at).where("until", "<", paymentStockLock).orderBy("until").limit(1)),
      ]);
      return { availableTickets: Math.max(0, available - held), nextReleaseAt: first.docs[0]?.get("until") ?? null };
    }, { readOnly: true });
  }

  async function state(eventId: string, userId: string, verify = false): Promise<TicketCheckoutState> {
    const key = keyFor(eventId, userId);
    const [ticket, reservation] = await db.getAll(ticketRef(key), orderRef(key));
    if (ticket.exists) return issued(key, ticket.data());
    const order = reservation.data() as Reservation | undefined;
    if (!verify || !order?.invoiceId || order.state !== "held") return view(order);
    await syncInvoice(key, order);
    return state(eventId, userId);
  }

  async function reserve(eventId: string, userId: string, option: unknown, quantity = 1, freeClaim = false) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxTicketsPerReservation) fail(400, "Можно забронировать от одного до трёх билетов");
    const key = keyFor(eventId, userId);
    if (gateway) {
      const pending = await holdCollection(db, eventId).where("checkAt", "<=", now()).limit(3).get();
      if (!pending.empty) {
        const rows = await db.getAll(...pending.docs.map(({ id }) => orderRef(id)));
        await reconcile(rows.flatMap(row => row.exists ? [{ key: row.id, order: row.data() as Reservation }] : []));
      }
    }
    return db.runTransaction(async transaction => {
      const at = now();
      const eventRef = db.doc(`events/${eventId}`);
      const [ticket, reservation, snapshot] = await transaction.getAll(ticketRef(key), orderRef(key), eventRef);
      if (ticket.exists) return issued(key, ticket.data());
      const event = snapshot.data();
      if (!event) return fail(404, "Мероприятие не найдено");
      const end = eventEndMillis(event);
      if (end && end <= at) fail(409, "Мероприятие завершено");
      if (event.status === "cancelled") fail(409, "Мероприятие отменено");
      if (freeClaim && externalTicketLink(event)) fail(409, "Используй ссылку организатора");
      const previous = reservation.data() as Reservation | undefined;
      const active = previous?.state === "held" && (previous.expiresAt > at || previous.invoiceId) ? previous : undefined;
      if (active && !freeClaim) return view(active);
      const tiers = Array.isArray(event.ticketTiers) ? event.ticketTiers : [];
      const tier = tiers.find(value => value?.name === option);
      if (!active && tiers.length && !tier) fail(400, "Выбери категорию билета");
      const priceMinor = active?.priceMinor ?? ticketAmountMinor(tier?.price ?? event.ticketPrice ?? event.price);
      if (priceMinor === null) return fail(409, "У билета нет корректной цены");
      if (freeClaim && priceMinor > 0) fail(402, "Этот билет требует оплаты", "payment_unavailable");
      const desired = active ? seats(active) : quantity;
      const stock = ticketStock(event);
      const held = Number.isFinite(stock.available) ? await heldTicketCount(db, transaction, eventId, at) : 0;
      if (stock.available - held + (active ? seats(active) : 0) < desired) fail(409, "Запрошенного количества свободных билетов сейчас нет", "ticket_sold_out");

      const order: Reservation = active || {
        eventId, eventTitle: event.title || "", userId, tierName: tier?.name || defaultTierName, priceMinor, quantity,
        attempt: crypto.randomBytes(16).toString("hex"), state: "held", expiresAt: Math.min(at + ticketHoldMs, end || Infinity),
      };
      if (freeClaim) return purchase(transaction, order, key, event);
      // The event document serializes transactions that hold seats for different users.
      transaction.set(orderRef(key), order);
      for (const ref of seatRefs(db, order, key)) transaction.set(ref, { orderKey: key, until: order.expiresAt });
      transaction.update(eventRef, { ticketInventoryRevision: FieldValue.increment(1) });
      return view(order);
    });
  }

  async function pay(eventId: string, userId: string, language: "AZ" | "EN" | "RU") {
    if (!gateway) return fail(402, "Онлайн-оплата пока недоступна", "payment_unavailable");
    const key = keyFor(eventId, userId);
    const lease = crypto.randomUUID();
    const work = await db.runTransaction(async transaction => {
      const [ticket, reservation, event] = await transaction.getAll(ticketRef(key), orderRef(key), db.doc(`events/${eventId}`));
      if (ticket.exists) return { result: issued(key, ticket.data()) };
      const order = reservation.data() as Reservation | undefined;
      if (!order || order.state !== "held" || order.expiresAt <= now()) return { result: view(order) };
      const data = event.data();
      const end = eventEndMillis(data || {});
      if (!data || data.status === "cancelled" || externalTicketLink(data) || (end && end <= now())) fail(409, "Оплата этого события недоступна");
      if (order.priceMinor === 0) fail(400, "Этот билет бесплатный");
      if (order.invoiceId) return { result: view(order) };
      if ((order.leaseUntil || 0) > now()) fail(409, "Платёжная ссылка готовится. Повтори через несколько секунд.", "payment_preparing");
      transaction.update(orderRef(key), { lease, leaseUntil: now() + invoiceLeaseMs });
      return { order, eventTitle: String(data?.title || "") };
    });
    if ("result" in work) return work.result!;
    let invoice;
    try {
      invoice = await gateway.create({ ...work.order, reservationId: key, eventTitle: work.eventTitle, language, amountMinor: work.order.priceMinor * seats(work.order) });
    } catch (error) {
      await db.runTransaction(async transaction => {
        if ((await transaction.get(orderRef(key))).get("lease") === lease) transaction.update(orderRef(key), { leaseUntil: 0 });
      }).catch(() => {});
      throw error;
    }
    return db.runTransaction(async transaction => {
      const order = (await transaction.get(orderRef(key))).data() as Reservation | undefined;
      if (!order || order.state !== "held" || order.lease !== lease || order.expiresAt <= now()) return view(order);
      const updated = {
        invoiceId: invoice.id,
        ...(invoice.url ? { paymentUrl: invoice.url } : {}),
        ...(invoice.form ? { paymentForm: invoice.form } : {}),
        ...(invoice.checkoutExpiresAt ? { checkoutExpiresAt: invoice.checkoutExpiresAt } : {}),
        checkAt: now(),
      };
      transaction.update(orderRef(key), updated);
      seatRefs(db, order, key).forEach((hold, index) => transaction.update(hold,
        { until: paymentStockLock, ...(index === 0 ? { checkAt: order.expiresAt } : {}) }));
      transaction.update(db.doc(`events/${order.eventId}`), { ticketInventoryRevision: FieldValue.increment(1) });
      return view({ ...order, ...updated });
    });
  }

  async function settle(key: string, attempt: string, providerOrder: string) {
    const order = (await orderRef(key).get()).data() as Reservation | undefined;
    if (order?.attempt === attempt && order.invoiceId === providerOrder) await syncInvoice(key, order);
  }

  async function settleDue() {
    if (!gateway) return { checked: 0, failed: 0 };
    const pending = await db.collection("ticketReservations").where("checkAt", "<=", now()).where("checkAt", ">=", 0).limit(12).get();
    return reconcile(pending.docs.map(row => ({ key: row.id, order: row.data() as Reservation })));
  }

  async function reservations(userId: string, cursor?: string) {
    const base = db.collection("ticketReservations").where("userId", "==", userId).orderBy("__name__").limit(30);
    const page = await (cursor ? base.startAfter(cursor) : base).get();
    return {
      reservations: page.docs.flatMap(row => {
        const order = row.data() as Reservation;
        if (order.state !== "held") return [];
        const status = view(order);
        if (status.status !== "reserved" && status.status !== "confirming") return [];
        const { paymentForm, paymentUrl, ...summary } = status;
        return [{ ...summary, eventId: order.eventId, eventTitle: order.eventTitle || order.tierName }];
      }),
      nextCursor: page.size === 30 ? page.docs.at(-1)!.id : null,
    };
  }
  return { reserve, pay, state, settle, settleDue, reservations, inventory };
}
