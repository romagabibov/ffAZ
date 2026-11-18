import crypto from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getTimestampMillis, monthsAfterBaku } from "../lib/dateUtils.js";
import { subscriptionPrice, type BillingCycle, type PaidPlan, type SubscriptionCheckoutState } from "../lib/subscriptionPricing.js";
import { fail, hash } from "./security.js";
import type { PaymentGateway } from "./paymentGateway.js";
import type { PaymentForm } from "../lib/paymentRedirect.js";

interface Checkout {
  uid: string;
  attempt: string;
  plan: PaidPlan;
  billingCycle: BillingCycle;
  amountMinor: number;
  expiresAt: number;
  state: "pending" | "applied" | "expired";
  invoiceId?: string;
  paymentUrl?: string;
  paymentForm?: PaymentForm;
  checkoutExpiresAt?: number;
  leaseUntil?: number;
}

export function createSubscriptionCheckout(db: Firestore, gateway: PaymentGateway | null) {
  const orderRef = (key: string) => db.doc(`subscriptionOrders/${key}`);
  const userKey = (uid: string) => hash("subscription|" + uid);

  function view(order?: Checkout): SubscriptionCheckoutState {
    if (!order) return { status: "available" };
    if (order.state === "expired" || (order.state === "pending" && !order.invoiceId && order.expiresAt <= Date.now())) {
      return { status: "expired" };
    }
    return {
      status: order.state, plan: order.plan, billingCycle: order.billingCycle,
      ...(order.state === "pending" && (order.checkoutExpiresAt || order.expiresAt) > Date.now() ? {
        ...(order.paymentUrl ? { paymentUrl: order.paymentUrl } : {}),
        ...(order.paymentForm ? { paymentForm: order.paymentForm } : {}),
      } : {}),
    };
  }

  async function start(uid: string, plan: PaidPlan, billingCycle: BillingCycle, language: "AZ" | "RU" | "EN") {
    if (!gateway) return fail(402, "Онлайн-оплата пока недоступна", "payment_unavailable");
    const key = userKey(uid);
    const ref = orderRef(key);
    const existing = (await ref.get()).data() as Checkout | undefined;
    if (existing?.state === "pending" && existing.invoiceId) {
      await sync(key, existing);
      const checked = (await ref.get()).data() as Checkout | undefined;
      if (checked?.state === "applied" && checked.attempt === existing.attempt) return view(checked);
    }
    const order = await db.runTransaction(async transaction => {
      const current = (await transaction.get(ref)).data() as Checkout | undefined;
      const at = Date.now();
      if (current?.state === "pending" && current.invoiceId) {
        if (current.plan !== plan || current.billingCycle !== billingCycle) fail(409, "Сначала заверши текущую оплату.");
        return { result: view(current) };
      }
      if (current?.state === "pending" && (current.leaseUntil || 0) > at) fail(409, "Платёжная ссылка готовится. Повтори через несколько секунд.");
      const next: Checkout = {
        uid, plan, billingCycle, state: "pending", attempt: crypto.randomBytes(16).toString("hex"),
        amountMinor: subscriptionPrice(plan, billingCycle) * 100,
        expiresAt: at + 60 * 60_000 + 30_000, leaseUntil: at + 20_000,
      };
      transaction.set(ref, next);
      return { order: next };
    });
    if ("result" in order) return order.result!;
    const info = order.order;
    try {
      const invoice = await gateway.create({
        kind: "subscription", eventTitle: plan === "job_one_time" ? "AZ/FSHN — публикация вакансии" : `AZ/FSHN ${plan.toUpperCase()} — ${billingCycle === "yearly" ? "12 месяцев" : "1 месяц"}`,
        reservationId: key, attempt: info.attempt, amountMinor: info.amountMinor, expiresAt: info.expiresAt, language,
      });
      return db.runTransaction(async transaction => {
        const current = (await transaction.get(ref)).data() as Checkout | undefined;
        if (!current || current.attempt !== info.attempt) return view(current);
        const checkout = { invoiceId: invoice.id, checkAt: Date.now(),
          ...(invoice.url ? { paymentUrl: invoice.url } : {}), ...(invoice.form ? { paymentForm: invoice.form } : {}),
          ...(invoice.checkoutExpiresAt ? { checkoutExpiresAt: invoice.checkoutExpiresAt } : {}) };
        transaction.update(ref, checkout);
        return view({ ...current, ...checkout });
      });
    } catch (error) {
      await db.runTransaction(async transaction => {
        if ((await transaction.get(ref)).get("attempt") === info.attempt) transaction.update(ref, { leaseUntil: 0 });
      }).catch(() => {});
      throw error;
    }
  }

  async function sync(key: string, order: Checkout) {
    if (!gateway || !order.invoiceId || order.state !== "pending") return;
    const status = await gateway.status(order.invoiceId, order.amountMinor);
    if (status === "pending") return;
    const ref = orderRef(key);
    await db.runTransaction(async transaction => {
      const current = (await transaction.get(ref)).data() as Checkout | undefined;
      if (!current || current.state !== "pending" || current.attempt !== order.attempt || current.invoiceId !== order.invoiceId) return;
      if (status === "expired") {
        transaction.update(ref, { state: "expired", paymentUrl: FieldValue.delete(), paymentForm: FieldValue.delete(), checkAt: FieldValue.delete() });
        return;
      }
      const privRef = db.doc(`users/${current.uid}/private/account`);
      const priv = (await transaction.get(privRef)).data();
      const at = Date.now();
      if (current.plan === "job_one_time") {
        transaction.set(privRef, { singleJobCredits: FieldValue.increment(1) }, { merge: true });
      } else {
        const expires = Math.max(getTimestampMillis(priv?.subscriptionExpiresAt), getTimestampMillis(priv?.subscriptionValidUntil));
        const start = priv?.subscriptionTier === current.plan ? Math.max(at, expires) : at;
        const until = monthsAfterBaku(start, current.billingCycle === "yearly" ? 12 : 1);
        transaction.set(privRef, { subscriptionTier: current.plan, subscriptionExpiresAt: until, subscriptionValidUntil: until }, { merge: true });
      }
      transaction.create(db.doc(`transactions/${hash("subscription|" + order.invoiceId)}`), {
        userId: current.uid, amount: current.amountMinor / 100, currency: "AZN", provider: gateway.provider || "abb",
        type: current.plan === "job_one_time" ? "job_credit" : "subscription", plan: current.plan, billingCycle: current.billingCycle,
        invoiceId: order.invoiceId, createdAt: at, status: "completed",
      });
      transaction.update(ref, { state: "applied", paymentUrl: FieldValue.delete(), paymentForm: FieldValue.delete(), checkAt: FieldValue.delete() });
    });
  }

  async function status(uid: string) {
    const key = userKey(uid);
    const ref = orderRef(key);
    const order = (await ref.get()).data() as Checkout | undefined;
    if (!order?.invoiceId || order.state !== "pending") return view(order);
    await sync(key, order);
    return view((await ref.get()).data() as Checkout | undefined);
  }

  async function settle(key: string, attempt: string, externalId: string) {
    const order = (await orderRef(key).get()).data() as Checkout | undefined;
    if (order?.attempt === attempt && order.invoiceId === externalId) await sync(key, order);
  }

  async function settleDue() {
    if (!gateway) return { checked: 0, failed: 0 };
    const page = await db.collection("subscriptionOrders").where("checkAt", "<=", Date.now()).limit(12).get();
    const results = await Promise.allSettled(page.docs.map(row => sync(row.id, row.data() as Checkout)));
    return { checked: page.size, failed: results.filter(result => result.status === "rejected").length };
  }

  return { start, status, settle, settleDue };
}
