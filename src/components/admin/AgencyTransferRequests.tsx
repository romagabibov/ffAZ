import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readApiJson } from '../../lib/apiClient';
import { useUI } from '../../context/UIContext';

type Transfer = { uid: string; representative: string; fromName: string; toName: string; requestedAt: number };

export default function AgencyTransferRequests() {
  const { t } = useTranslation();
  const ui = useUI();
  const [items, setItems] = useState<Transfer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load(after?: string, signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const result = await readApiJson<{ items: Transfer[]; nextCursor: string | null }>(
        '/api/admin/agency-transfers' + (after ? '?cursor=' + encodeURIComponent(after) : ''), { signal });
      if (signal?.aborted) return;
      setItems(previous => after ? [...previous, ...result.items] : result.items);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, []);

  async function decide(item: Transfer, approved: boolean) {
    if (busy || !await ui.confirm(t(approved ? 'agency_transfer_confirm' : 'agency_transfer_reject_confirm', { name: item.representative, agency: item.toName }))) return;
    setBusy(item.uid);
    setError('');
    try {
      await readApiJson('/api/admin/agency-transfers/' + encodeURIComponent(item.uid), {
        method: 'POST', body: JSON.stringify({ approved, requestedAt: item.requestedAt }),
      });
      setItems(previous => previous.filter(row => row.uid !== item.uid));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="space-y-3 border border-brand-border bg-brand-card p-4 sm:p-5">
      <h2 className="font-serif text-xl">{t('agency_transfer_title')}</h2>
      {loading && <p role="status">{t('ui_loading')}</p>}
      {error && <p role="alert" className="text-sm text-brand-accent">{error}</p>}
      {!items.length && !loading && !error && <p className="text-sm text-brand-dark/70">{t('agency_transfer_empty')}</p>}
      <ul className="divide-y divide-brand-border">
        {items.map(item => (
          <li key={item.uid} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><strong className="text-sm">{item.representative}</strong><p className="text-xs text-brand-dark/70">{item.fromName} → {item.toName}</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} className="brand-button min-h-11" onClick={() => decide(item, true)}>{t('agency_transfer_approve')}</button>
              <button type="button" disabled={!!busy} className="brand-button-outline min-h-11" onClick={() => decide(item, false)}>{t('agency_transfer_reject')}</button>
            </div>
          </li>
        ))}
      </ul>
      {(cursor || error) && <button type="button" className="brand-button-outline min-h-11" disabled={loading} onClick={() => load(cursor ?? undefined)}>{t(error ? 'ui_refresh' : 'admin_load_more')}</button>}
    </section>
  );
}
