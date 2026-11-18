import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ImageUp, ScanLine, Square, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Event } from '../../types';
import { eventEndMillis } from '../../lib/dateUtils';
import { readApiJson } from '../../lib/apiClient';
import { ticketQrPattern, type CheckInResult } from '../../lib/ticketCheckIn';

type Result = CheckInResult | { status: 'error'; message: string } | { status: 'checking' };

export default function TicketScanner({ events, initialEventId, more, loadMore }: {
  events: Event[]; initialEventId: string; more?: boolean; loadMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const shows = events.filter(event => {
    const end = eventEndMillis(event);
    return event.status !== 'cancelled' && (!end || end > Date.now());
  }).sort((a, b) => a.date - b.date);
  const [selected, setSelected] = useState(initialEventId);
  const eventId = shows.some(show => show.id === selected) ? selected : '';
  const [phase, setPhase] = useState<'idle' | 'opening' | 'scanning'>('idle');
  const [result, setResult] = useState<Result>();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  function stop() {
    generation.current++;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    camera.current?.getTracks().forEach(track => track.stop());
    camera.current = null;
    if (video.current) video.current.srcObject = null;
  }

  useEffect(() => {
    const suspend = () => {
      if (!document.hidden) return;
      if (camera.current || timer.current !== undefined) {
        stop();
        setPhase('idle');
      }
    };
    document.addEventListener('visibilitychange', suspend);
    return () => { document.removeEventListener('visibilitychange', suspend); stop(); };
  }, []);

  async function verify(code: string, session: number) {
    if (!ticketQrPattern.test(code)) {
      setResult({ status: 'error', message: t('ticket_scan_invalid') });
      return;
    }
    setResult({ status: 'checking' });
    try {
      const value = await readApiJson<CheckInResult>('/api/admin/tickets/check-in', {
        method: 'POST', body: JSON.stringify({ eventId, token: code }),
      });
      if (session === generation.current) setResult(value);
    } catch (error) {
      if (session === generation.current) {
        setResult({ status: 'error', message: error instanceof Error ? error.message : t('ticket_scan_request_failed') });
      }
    }
  }

  function prepareDecoder() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error(t('ticket_scan_camera_unavailable'));
    return import('jsqr').then(({ default: jsQR }) => {
      return (source: CanvasImageSource, width: number, height: number) => {
        const scale = Math.min(1, 720 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })?.data;
      };
    });
  }

  async function start() {
    if (!eventId) return;
    stop();
    const session = generation.current;
    setResult(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setResult({ status: 'error', message: t('ticket_scan_camera_unavailable') });
      return;
    }
    setPhase('opening');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      if (session !== generation.current || document.hidden || !video.current) {
        stream.getTracks().forEach(track => track.stop());
        if (session === generation.current) setPhase('idle');
        return;
      }
      camera.current = stream;
      const preview = video.current;
      preview.srcObject = stream;
      await preview.play();
      const decode = await prepareDecoder();
      if (session !== generation.current) return;
      setPhase('scanning');
      let last = '';
      let lastSeenAt = 0;
      const capture = async () => {
        if (session !== generation.current) return;
        try {
          if (preview.readyState >= 2 && preview.videoWidth && preview.videoHeight) {
            const value = decode(preview, preview.videoWidth, preview.videoHeight)?.trim();
            if (value) {
              lastSeenAt = Date.now();
              if (last !== value) {
                last = value;
                await verify(value, session);
              }
            } else if (Date.now() - lastSeenAt > 700) {
              last = '';
            }
          }
        } catch {
          if (session === generation.current) setResult({ status: 'error', message: t('ticket_scan_read_failed') });
        }
        if (session === generation.current) timer.current = window.setTimeout(capture, 240);
      };
      void capture();
    } catch (error) {
      if (session !== generation.current) return;
      stop();
      setPhase('idle');
      const permissionDenied = error instanceof DOMException && error.name === 'NotAllowedError';
      setResult({ status: 'error', message: t(permissionDenied ? 'ticket_scan_camera_denied' : 'ticket_scan_camera_unavailable') });
    }
  }

  async function fromImage(file: File | undefined) {
    if (!file || !eventId) return;
    stop();
    setPhase('idle');
    const session = generation.current;
    setResult({ status: 'checking' });
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Image too large');
      const decode = await prepareDecoder();
      const image = await createImageBitmap(file);
      try {
        if (session !== generation.current) return;
        const code = decode(image, image.width, image.height)?.trim();
        if (code) await verify(code, session);
        else setResult({ status: 'error', message: t('ticket_scan_read_failed') });
      } finally {
        image.close();
      }
    } catch {
      if (session === generation.current) setResult({ status: 'error', message: t('ticket_scan_read_failed') });
    }
  }

  const dateFor = (at: number) => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Baku',
  }).format(at);
  const positive = result?.status === 'checked_in';
  const busy = result?.status === 'checking';

  return (
    <section className="mx-auto max-w-3xl space-y-5" aria-labelledby="ticket-scan-heading">
      <header className="border-b border-brand-border pb-4">
        <h2 id="ticket-scan-heading" className="flex items-center gap-3 font-serif text-2xl sm:text-3xl"><ScanLine aria-hidden size={24} className="text-brand-accent" />{t('admin_nav_ticket_scan')}</h2>
      </header>
      <div className="space-y-5 border-2 border-brand-dark bg-brand-card p-4 sm:p-6">
        <div className="grid gap-2">
          <label htmlFor="scan-event" className="text-sm font-semibold">{t('ticket_scan_event')}</label>
          <select id="scan-event" value={eventId} className="min-h-11 w-full border border-brand-border bg-brand-light px-3"
            onChange={event => { stop(); setPhase('idle'); setResult(undefined); setSelected(event.target.value); }}>
            <option value="">{t('ticket_scan_pick_event')}</option>
            {shows.map(show => <option key={show.id} value={show.id}>{show.title}</option>)}
          </select>
          {more && <button type="button" className="brand-button-outline min-h-11 justify-self-start" onClick={loadMore}>{t('admin_load_more')}</button>}
        </div>

        <div className={phase === 'idle' ? 'hidden' : 'relative aspect-video bg-black'}>
          <video ref={video} muted playsInline className="h-full w-full object-contain" aria-label={t('ticket_scan_preview')} />
          {phase === 'opening' ? (
            <p role="status" className="absolute inset-0 grid place-items-center text-sm text-white">{t('ticket_scan_opening')}</p>
          ) : (
            <div aria-hidden className="pointer-events-none absolute inset-[20%] border-2 border-white/80" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {phase === 'idle' ?
            <button type="button" disabled={!eventId || busy} onClick={start} className="brand-button min-h-11 disabled:opacity-50">
              <Camera size={17} aria-hidden />{t('ticket_scan_start')}
            </button> :
            <button type="button" onClick={() => { stop(); setPhase('idle'); if (busy) setResult(undefined); }} className="brand-button-outline min-h-11">
              <Square size={16} aria-hidden />{t('ticket_scan_stop')}
            </button>}
          <button type="button" disabled={!eventId || busy} onClick={() => input.current?.click()} className="brand-button-outline min-h-11 disabled:opacity-50">
            <ImageUp size={17} aria-hidden />{t('ticket_scan_image')}
          </button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void fromImage(file);
          }} />
        </div>
        {result && (
          <div role="status" aria-live="polite" className={`flex gap-3 border-l-4 bg-brand-muted p-4 ${positive ? 'border-emerald-600' : busy ? 'border-brand-border' : 'border-brand-accent'}`}>
            {positive ? <CheckCircle2 size={20} aria-hidden className="shrink-0 text-emerald-600" /> :
              !busy && <TriangleAlert size={20} aria-hidden className="shrink-0 text-brand-accent" />}
            <div>
              <p className="text-base font-semibold">
                {result.status === 'error' ? result.message : t('ticket_scan_' + result.status)}
              </p>
              {'usedAt' in result && <p className="text-sm text-brand-dark/70">
                {t('ticket_scan_' + result.kind)}{result.usedAt ? ` · ${dateFor(result.usedAt)}` : ''}
              </p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
