import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useUI } from '../../context/UIContext';
import { readApiJson } from '../../lib/apiClient';
import { refreshAnnouncements } from '../../lib/useAnnouncements';

export default function AdminAnnouncements() {
  const { t } = useTranslation();
  const ui = useUI();
  const [form, setForm] = useState({ title: '', message: '', link: '' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  const sendingRef = useRef(false);
  const request = useRef({ id: '', content: '' });

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || !form.title.trim() || !form.message.trim()) return;
    sendingRef.current = true;
    setSending(true);
    setResult('');
    try {
      if (!await ui.confirm(t('announcements_confirm'))) return;
      const content = JSON.stringify(form);
      if (content !== request.current.content) request.current = { id: crypto.randomUUID(), content };
      await readApiJson('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ ...form, requestId: request.current.id }) });
      setResult(t('announcements_sent'));
      setForm({ title: '', message: '', link: '' });
      request.current = { id: '', content: '' };
      refreshAnnouncements();
    } catch (error) {
      setResult(error instanceof Error ? error.message : t('admin_load_failed'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const input = 'mt-1 block min-h-11 w-full border border-brand-border bg-brand-light px-3 py-2 text-brand-dark';
  return (
    <section className="max-w-2xl space-y-4 border border-brand-border bg-brand-card p-4 sm:p-6">
      <h2 className="font-serif text-2xl">{t('admin_nav_announcements')}</h2>
      <form className="space-y-4" onSubmit={send}>
        <label className="block text-sm">{t('announcements_title')}
          <input required maxLength={120} className={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="block text-sm">{t('announcements_message')}
          <textarea required rows={5} maxLength={1200} className={input} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
        </label>
        <label className="block text-sm">{t('announcements_link')}
          <input placeholder="/events" maxLength={500} className={input} value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} />
        </label>
        <button disabled={sending} className="brand-button min-h-11" type="submit">{t(sending ? 'ui_loading' : 'announcements_send')}</button>
        {result && <p role="status" className="text-sm">{result}</p>}
      </form>
    </section>
  );
}
