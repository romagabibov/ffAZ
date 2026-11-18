import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { X, ArrowRight, Ticket } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Event, TicketTier } from '../types';
import { defaultTierName, externalTicketLink, maxTicketsPerReservation, ticketAmountMinor, type TicketCheckoutState } from '../lib/ticketCheckout';
import { readApiJson } from '../lib/apiClient';
import { updateTicketCheckout } from '../lib/ticketClient';
import { openPayment } from '../lib/paymentRedirect';

export type TicketDialogMode = 'reserve' | 'purchase';

export default function TicketCheckoutDialog({ event, initialTier, mode, returning, close, onState }: {
  event: Event; initialTier?: TicketTier; mode: TicketDialogMode; returning: boolean;
  close: () => void; onState: (state: TicketCheckoutState) => void;
}) {
  const { t, i18n } = useTranslation();
  const tiers = event.ticketTiers?.length ? event.ticketTiers : [{ name: defaultTierName, price: event.ticketPrice ?? event.price }];
  const [selected, setSelected] = useState(initialTier?.name || tiers[0].name);
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<TicketCheckoutState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [purchasing, setPurchasing] = useState(mode === 'purchase');
  const checkedPrice = ticketAmountMinor(tiers.find(tier => tier.name === selected)?.price);
  const price = checkedPrice === null ? null : checkedPrice / 100;
  const language = i18n.language.split('-')[0].toUpperCase();
  const externalUrl = externalTicketLink(event);
  const reserved = state?.status === 'reserved' || state?.status === 'confirming' ? state : null;
  const expiry = reserved?.status === 'reserved' ? reserved.expiresAt : null;
  const paymentNeedsCheck = reserved?.checkoutStarted && !reserved.paymentUrl && !reserved.paymentForm;

  useEffect(() => {
    const controller = new AbortController();
    const request = returning ? updateTicketCheckout('check-payment', { eventId: event.id }) :
      readApiJson<TicketCheckoutState>('/api/tickets/reservation?eventId=' + encodeURIComponent(event.id), { signal: controller.signal });
    void request.then(result => {
      if (controller.signal.aborted) return;
      setState(result);
      onState(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [event.id, returning, onState]);

  useEffect(() => {
    if (expiry === null) return;
    const timeout = window.setTimeout(() => {
      setState(latest => {
        if (latest?.status !== 'reserved' || latest.expiresAt !== expiry) return latest;
        return latest.checkoutStarted ? { ...latest, status: 'confirming' } : { status: 'expired', paymentsEnabled: latest.paymentsEnabled };
      });
    }, Math.max(0, expiry - Date.now()) + 20);
    return () => window.clearTimeout(timeout);
  }, [expiry]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, close]);

  async function run(action: Parameters<typeof updateTicketCheckout>[0]) {
    setBusy(true);
    setError('');
    try {
      const result = await updateTicketCheckout(action, { eventId: event.id, tierName: selected, quantity, language });
      setState(result);
      onState(result);
      if (action === 'pay' && result.status === 'reserved') openPayment(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      setBusy(false);
    }
  }

  const amount = (value: number | null) => value === null ? '—' : value > 0 ?
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'AZN' }).format(value) : t('ticket_checkout_free');
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Baku' });

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="ticket-checkout-title" className="fixed inset-0 z-[95] grid place-items-center overflow-auto bg-black/70 p-3 sm:p-6">
      <section className="relative my-auto w-full max-w-lg space-y-5 border-2 border-brand-dark bg-brand-card p-5 text-brand-dark sm:p-7">
        <button type="button" className="absolute right-2 top-2 grid min-h-11 min-w-11 place-items-center" onClick={close}
          disabled={busy} aria-label={t('ui_cancel')}><X size={20} /></button>
        <header className="pr-10">
          <p className="font-mono text-xs uppercase tracking-wider text-brand-accent">{t(purchasing ? 'ticket_checkout_title' : 'tab_reservations')}</p>
          <h2 id="ticket-checkout-title" className="mt-1 font-serif text-2xl">{event.title}</h2>
        </header>
        {error && <p role="alert" className="border-l-2 border-brand-accent pl-3 text-sm">{error}</p>}
        {busy && <p role="status" className="text-sm text-brand-dark/70">{t('ui_loading')}</p>}
        {state?.status === 'issued' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('ticket_checkout_issued_count', { quantity: state.quantity })}</h3>
            {state.quantity === 1 && state.qrCodeData && <QRCodeSVG value={state.qrCodeData} size={128} className="border-8 border-white bg-white" />}
            <Link onClick={close} to="/dashboard?tab=tickets&section=purchased" className="brand-button min-h-11"><Ticket size={15} /> {t('tab_tickets')}</Link>
          </div>
        )}
        {reserved && (
          <div className="space-y-3">
            <p className="flex items-center justify-between gap-4 border-b border-brand-border pb-2">
              <strong>{reserved.tierName} × {reserved.quantity}</strong><span className="font-mono">{amount(reserved.price)}</span>
            </p>
            <p role="status" className="text-sm text-brand-dark/75">
              {reserved.status === 'reserved' ? t('ticket_checkout_until', { date: dateFormat.format(reserved.expiresAt) }) :
                t('ticket_checkout_confirming')}
            </p>
            {!purchasing && reserved.status === 'reserved' && <p className="text-sm text-brand-dark/75">{t('ticket_checkout_free_hold')}</p>}
            {purchasing && reserved.price > 0 && !reserved.paymentsEnabled && !externalUrl &&
              <p className="text-sm text-brand-dark/75">{t('ticket_checkout_unavailable')}</p>}
            <div className="flex flex-wrap gap-2">
              {reserved.status === 'reserved' && (externalUrl ?
                <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="brand-button min-h-11">{t('ticket_checkout_buy')} <ArrowRight size={15} /></a> :
                purchasing ? (
                  (reserved.price === 0 || (reserved.paymentsEnabled && !paymentNeedsCheck)) &&
                  <button type="button" className="brand-button min-h-11" disabled={busy}
                    onClick={() => run(reserved.price === 0 ? 'purchase' : 'pay')}>
                    {t(reserved.price === 0 ? 'ticket_checkout_get' : 'ticket_checkout_pay')} <ArrowRight size={15} />
                  </button>
                ) : (
                  <button type="button" className="brand-button-outline min-h-11" disabled={busy}
                    onClick={() => setPurchasing(true)}>{t(reserved.price === 0 ? 'ticket_checkout_get' : 'ticket_checkout_purchase_details')} <ArrowRight size={15} /></button>
                ))}
              {(reserved.checkoutStarted || reserved.status === 'confirming') && <button type="button" className="brand-button-outline min-h-11" disabled={busy}
                onClick={() => run('check-payment')}>{t('ticket_checkout_check')}</button>}
            </div>
            <Link className="inline-flex min-h-11 items-center text-sm underline" to="/dashboard?tab=tickets&section=reservations" onClick={close}>{t('tab_reservations')}</Link>
          </div>
        )}
        {(state?.status === 'available' || state?.status === 'expired') && (
          <div className="space-y-3">
            {state.status === 'expired' && <p>{t('ticket_checkout_expired')}</p>}
            <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
              <label className="block space-y-1 text-sm">
                <span>{t('ticket_checkout_category')}</span>
                <select className="block min-h-11 w-full border border-brand-border bg-brand-light px-3" value={selected} disabled={busy}
                  onChange={event => setSelected(event.target.value)}>
                  {tiers.map((tier, index) => {
                    const minor = ticketAmountMinor(tier.price);
                    return <option key={index} value={tier.name}>{tier.name} — {amount(minor === null ? null : minor / 100)}</option>;
                  })}
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>{t('ticket_checkout_quantity')}</span>
                <select className="block min-h-11 w-full border border-brand-border bg-brand-light px-3" value={quantity} disabled={busy}
                  onChange={event => setQuantity(Number(event.target.value))}>
                  {Array.from({ length: maxTicketsPerReservation }, (_, index) => <option key={index + 1}>{index + 1}</option>)}
                </select>
              </label>
            </div>
            {(!purchasing || (price !== null && price > 0)) && <p className="text-sm text-brand-dark/75">
              {t('ticket_checkout_hold')} {t('ticket_checkout_free_hold')}
            </p>}
            {purchasing && price !== null && price > 0 && !state.paymentsEnabled && <p className="text-sm text-brand-dark/75">
              {t('ticket_checkout_unavailable')}
            </p>}
            <button type="button" className="brand-button min-h-11" onClick={() => run(purchasing && price === 0 ? 'purchase' : 'reserve')}
              disabled={busy || price === null}>
              {t(purchasing && price === 0 ? 'ticket_checkout_get' : 'ticket_checkout_reserve')}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
