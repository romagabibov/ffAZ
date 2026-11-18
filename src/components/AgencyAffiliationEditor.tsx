import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { query, limit, orderBy, documentId, startAfter, collection, getDocs } from '../lib/firestoreClient';
import { db } from '../lib/firebase';
import { readApiJson } from '../lib/apiClient';
import { agencyNameKey, defaultAgencyTargets } from '../lib/agencyCatalogue';

type Target = { id: string; name: string; available: boolean };
type Transfer = { fromName: string; toName: string; toId: string; status: 'pending' | 'approved' | 'rejected' };
type Affiliation = { agencyId: string; agencyName: string; request: Transfer | null };

export default function AgencyAffiliationEditor({ agencyId, agencyName, uid, onClose }: {
  agencyId: string; agencyName: string; uid: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<Target[]>([]);
  const [selected, setSelected] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [current, setCurrent] = useState<Transfer | null>(null);
  const [source, setSource] = useState<Affiliation | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function load(after?: string, signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const base = query(collection(db, 'agencies'), orderBy(documentId()), limit(60));
      const result = await getDocs(after ? query(base, startAfter(after)) : base);
      if (signal?.aborted) return;
      const fetched = result.docs.flatMap(row => {
        const agency = row.data();
        if (typeof agency.name !== 'string') return [];
        return [{ id: row.id, name: agency.name, available: !agency.linkedUserId || agency.linkedUserId === uid }];
      });
      setOptions(previous => {
        const actual = [...(after ? previous.filter(row => !row.id.startsWith('default:')) : []), ...fetched];
        const names = new Set(actual.map(row => agencyNameKey(row.name)));
        const fallback = defaultAgencyTargets
          .filter(row => !names.has(agencyNameKey(row.name)))
          .map(row => ({ ...row, available: true }));
        return [...new Map([...actual, ...fallback].map(row => [row.id, row])).values()]
          .sort((a, b) => a.name.localeCompare(b.name, 'az'));
      });
      setCursor(result.size === 60 ? result.docs.at(-1)!.id : null);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function loadSource(signal?: AbortSignal) {
    setSourceError('');
    try {
      const result = await readApiJson<Affiliation>('/api/agency/affiliation', { signal });
      if (signal?.aborted) return;
      setSource(result);
      setCurrent(result.request);
    } catch (cause) {
      if (!signal?.aborted) setSourceError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setSelected('');
    void loadSource(controller.signal).then(() => { if (!controller.signal.aborted) void load(undefined, controller.signal); });
    return () => controller.abort();
  }, [agencyId, uid]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focused = document.activeElement;
    const previous = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
    };
  }, []);

  async function submit() {
    if (!source || !selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await readApiJson<Transfer>('/api/agency/affiliation', {
        method: 'POST', body: JSON.stringify({ agencyId: selected }),
      });
      setCurrent(result);
      if (result.status === 'approved') {
        setSource({ agencyId: result.toId, agencyName: result.toName, request: result });
        setSelected('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin_load_failed'));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="agency-switch-title"
      onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg border border-brand-dark/30 bg-brand-card p-0 text-brand-dark backdrop:bg-black/70">
      <section className="space-y-4 p-4 sm:p-6">
        <header className="flex items-center justify-between gap-2 border-b border-brand-border pb-3">
          <h2 id="agency-switch-title" className="font-serif text-2xl">{t('agency_switch_title')}</h2>
          <button type="button" aria-label={t('ui_close')} className="grid min-h-11 min-w-11 place-items-center" disabled={saving} onClick={onClose}><X size={18} /></button>
        </header>
        <p className="text-sm">{t('agency_switch_current', { agency: source?.agencyName || agencyName })}</p>
        {current && <p role="status" className="border-l-2 border-brand-accent pl-3 text-sm">{t(`agency_switch_${current.status}`, { agency: current.toName })}</p>}
        <div className="grid gap-1.5">
          <label htmlFor="agency-target" className="text-sm font-semibold">{t('agency_switch_target')}</label>
          <select id="agency-target" className="block min-h-11 w-full border border-brand-border bg-brand-light px-2" value={selected}
            disabled={!source || loading || saving} onChange={event => setSelected(event.target.value)}>
            <option value="">{t('agency_switch_select')}</option>
            {options.map(agency => {
              const isCurrent = agency.id === (source?.agencyId || agencyId)
                || agencyNameKey(agency.name) === agencyNameKey(source?.agencyName || agencyName);
              const label = isCurrent ? t('agency_switch_current_option') : !agency.available ? t('agency_switch_occupied') : '';
              return <option key={agency.id} value={agency.id} disabled={isCurrent || !agency.available}>
                {agency.name}{label ? ' · ' + label : ''}
              </option>;
            })}
          </select>
        </div>
        <p className="text-xs leading-relaxed text-brand-dark/70">{t('agency_switch_review_hint')}</p>
        {sourceError && <p role="alert" className="text-sm text-brand-accent">{sourceError}</p>}
        {sourceError && <button type="button" className="brand-button-outline min-h-11" onClick={() => { void loadSource(); }}>{t('ui_refresh')}</button>}
        {error && <p role="alert" className="text-sm text-brand-accent">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="brand-button min-h-11" disabled={!source || !selected || saving || loading}
            onClick={submit}>{t(saving ? 'ui_loading' : 'agency_switch_submit')} <ArrowRight size={15} /></button>
          {cursor && <button type="button" className="brand-button-outline min-h-11" disabled={loading || saving}
            onClick={() => load(cursor)}>{t('admin_load_more')}</button>}
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
