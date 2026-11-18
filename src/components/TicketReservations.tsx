import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { readApiJson } from '../lib/apiClient';

type Reservation = {
  eventId: string; eventTitle: string; tierName: string; price: number; quantity: number; expiresAt: number; checkoutStarted: boolean;
};

export default function TicketReservations() {
  const { t, i18n } = useTranslation();
  const [cursor, setCursor] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [time, setTime] = useState(Date.now);
  async function load(page?: string, signal?: AbortSignal) {
    setBusy(true);
    setError('');
    try {
      const data = await readApiJson<{ reservations: Reservation[]; nextCursor: string | null }>(
        '/api/tickets/reservations' + (page ? '?cursor=' + encodeURIComponent(page) : ''), { signal });
      if (signal?.aborted) return;
      setTime(Date.now());
      setCursor(data.nextCursor);
      setReservations(previous => page ? [...previous, ...data.reservations] : data.reservations);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, []);
  const active = reservations.filter(row => row.checkoutStarted || row.expiresAt > time);
  const nextExpiry = Math.min(...active.filter(row => row.expiresAt > time).map(row => row.expiresAt));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timeout = window.setTimeout(() => setTime(Date.now()), Math.max(0, nextExpiry - Date.now()) + 20);
    return () => window.clearTimeout(timeout);
  }, [nextExpiry]);

  return (
    <section className="space-y-4">
      {error && <p role="alert" className="text-brand-accent">{error}</p>}
      {busy && <p role="status">{t('ui_loading')}</p>}
      {!busy && !error && !active.length && <p>{t('ticket_reservations_empty')}</p>}
      {active.map(row => (
        <article key={row.eventId} className="flex flex-wrap items-center justify-between gap-3 border border-brand-border bg-brand-card p-4">
          <div>
            <h3 className="font-serif text-lg">{row.eventTitle}</h3>
            <p className="text-sm">{row.tierName} × {row.quantity} · {new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'AZN' }).format(row.price)}</p>
            <p className="text-xs text-brand-dark/70">
              {row.expiresAt > time ? t('ticket_checkout_until', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Baku' }).format(row.expiresAt) }) : t('ticket_checkout_confirming')}
            </p>
          </div>
          <Link to={'/event/' + encodeURIComponent(row.eventId) + (row.checkoutStarted ? '?checkout=1' : '?checkout=reserve')} className="brand-button-outline min-h-11">{t('ticket_checkout_open')}</Link>
        </article>
      ))}
      {(cursor || error) && <button type="button" disabled={busy} className="brand-button-outline min-h-11"
        onClick={() => load(cursor ?? undefined)}>{t(error ? 'ui_refresh' : 'admin_load_more')}</button>}
    </section>
  );
}
