import type { PaymentRedirect } from './paymentRedirect';

export const monthlyPlans = { pro: 25, elite: 49 } as const;
export const oneTimeJobPrice = 7;
export type PaidPlan = keyof typeof monthlyPlans | 'job_one_time';
export type BillingCycle = 'monthly' | 'yearly';

export function subscriptionPrice(plan: PaidPlan, cycle: BillingCycle) {
  return plan === 'job_one_time' ? oneTimeJobPrice : monthlyPlans[plan] * (cycle === 'yearly' ? 11 : 1);
}

export type SubscriptionCheckoutState =
  | { status: 'available' | 'expired' }
  | ({ status: 'pending'; plan: PaidPlan; billingCycle: BillingCycle } & PaymentRedirect)
  | { status: 'applied'; plan: PaidPlan; billingCycle: BillingCycle };
