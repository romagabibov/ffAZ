import '../locales/events';
import TicketCheckoutDialog, { type TicketDialogMode } from '../components/TicketCheckoutDialog';
import { externalTicketLink, ticketAmountMinor, type TicketCheckoutState, type TicketInventory } from '../lib/ticketCheckout';
import { readTicketInventory } from '../lib/ticketClient';
import { eventEndMillis, parseEventDate } from '../lib/dateUtils';
import { eventScheduleRows } from '../lib/eventProgramme';
import {SecureImage} from '../components/SecureMedia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router';
import { doc, getDoc, collection, query, where, onSnapshot, addDoc, limit } from '../lib/firestoreClient';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { apiFetch, readApiJson } from '../lib/apiClient';
import { dataMode } from '../lib/dataMode';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { Event, TicketTier, GiveawayEntry } from '../types';
import { 
  Calendar, 
  MapPin, 
  Share2, 
  Sparkles, 
  Check, 
  ChevronLeft, 
  Clock, 
  Ticket, 
  Bookmark, 
  ArrowRight,
  ShieldCheck,
  Flame,
  ExternalLink,
  QrCode,
  X,
  User,
  Mail,
  Phone,
  CheckCircle2,
  Award,
  Layers,
  Info,
  Gift,
  Crown,
  Trophy
} from 'lucide-react';
import { toast } from 'sonner';

export default function EventDetails() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || 'az';
  const { currentUser, dbUser } = useAuth();
  const navigate = useNavigate();

  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // VIP Level 3 Subscriber Check
  const isTier3Subscriber =
    dbUser?.subscriptionTier === 'vip' ||
    dbUser?.subscriptionTier === 'elite' ||
    dbUser?.role === 'admin' ||
    dbUser?.role === 'superadmin';

  // Tier 3 Ticket Giveaway Entry State
  const [giveawayEntry, setGiveawayEntry] = useState<GiveawayEntry | null>(null);
  const [isEnteringGiveaway, setIsEnteringGiveaway] = useState(false);

  const [search, setSearch] = useSearchParams();
  const [booking, setBooking] = useState<{ mode: TicketDialogMode; tier?: TicketTier } | null>(null);
  const [inventory, setInventory] = useState<{ eventId: string; value: TicketInventory } | null>(null);
  const inventoryRequest = useRef(0);
  const [checkout, setCheckout] = useState<{ eventId: string; uid: string; state: TicketCheckoutState } | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const returning = search.get('checkout') === '1';
  const openingReservation = search.get('checkout') === 'reserve';
  const externalUrl = event ? externalTicketLink(event) : '';
  const ended = event ? event.status === 'cancelled' || Boolean(eventEndMillis(event) && eventEndMillis(event) <= Date.now()) : false;
  const ticketState = checkout?.eventId === id && checkout?.uid === currentUser?.uid ? checkout?.state : undefined;
  const held = ticketState?.status === 'reserved';
  const heldUntil = held ? ticketState.expiresAt : null;
  const activeInventory = inventory?.eventId === id ? inventory?.value : null;
  const availableTickets = activeInventory?.availableTickets ?? (dataMode === 'demo' ? event?.availableTickets : null);
  const reserveLabel = held ? t('ticket_checkout_reserved_count', { quantity: ticketState.quantity }) :
    t(ticketState?.status === 'issued' ? 'tab_tickets' : ticketState?.status === 'confirming' ? 'ticket_checkout_check' : 'ticket_checkout_reserve');
  const cannotReserve = ended || (availableTickets === 0 && !held && ticketState?.status !== 'confirming' && ticketState?.status !== 'issued');

  const receiveCheckout = useCallback((state: TicketCheckoutState) => {
    if (!id || !currentUser?.uid) return;
    setCheckout({ eventId: id, uid: currentUser.uid, state });
    if (state.inventory) {
      inventoryRequest.current++;
      setInventory({ eventId: id, value: state.inventory });
    }
  }, [id, currentUser?.uid]);

  const loadInventory = useCallback(async (signal?: AbortSignal) => {
    if (!id || dataMode === 'demo') return;
    const request = ++inventoryRequest.current;
    try {
      const value = await readTicketInventory(id, signal);
      if (!signal?.aborted && request === inventoryRequest.current) setInventory({ eventId: id, value });
    } catch { /* A reserve request still checks stock on the server. */ }
  }, [id]);

  useEffect(() => {
    if (!event || event.id !== id) return;
    const controller = new AbortController();
    const refresh = () => { void loadInventory(controller.signal); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); };
  }, [id, event?.id, loadInventory]);

  useEffect(() => {
    const deadline = activeInventory?.nextReleaseAt;
    if (!deadline || deadline <= Date.now()) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadInventory(controller.signal), deadline - Date.now() + 80);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [activeInventory?.nextReleaseAt, loadInventory]);

  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || !id || dataMode === 'demo' || returning || openingReservation) return;
    const controller = new AbortController();
    void readApiJson<TicketCheckoutState>('/api/tickets/reservation?eventId=' + encodeURIComponent(id), { signal: controller.signal }).then(state => {
      if (!controller.signal.aborted) setCheckout(previous => previous?.uid === uid && previous.eventId === id ? previous : { uid, eventId: id, state });
    }).catch(() => {});
    return () => controller.abort();
  }, [id, currentUser?.uid, returning, openingReservation]);

  useEffect(() => {
    if (!heldUntil) return;
    const timeout = window.setTimeout(() => {
      setCheckout(previous => {
        if (previous?.state.status !== 'reserved' || previous.state.expiresAt !== heldUntil) return previous;
        const state: TicketCheckoutState = previous.state.checkoutStarted ? { ...previous.state, status: 'confirming' } :
          { status: 'expired', paymentsEnabled: previous.state.paymentsEnabled };
        return { ...previous, state };
      });
    }, Math.max(0, heldUntil - Date.now()) + 20);
    return () => window.clearTimeout(timeout);
  }, [heldUntil]);

  useEffect(() => {
    setGiveawayEntry(null);
    if (!currentUser?.uid || !id) return;
    const q = query(collection(db, 'giveaway_entries'), where('eventId', '==', id), where('userId', '==', currentUser.uid), limit(1));
    return onSnapshot(q, snapshot => {
      const entry = snapshot.docs[0];
      setGiveawayEntry(entry ? { ...entry.data(), id: entry.id } as GiveawayEntry : null);
    }, () => setGiveawayEntry(null));
  }, [id, currentUser?.uid]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setBooking(null);
    setEvent(null);
    setLoading(true);
    setFetchError(false);
    void getDoc(doc(db, 'events', id)).then(snapshot => {
      if (active && snapshot.exists()) setEvent({ ...snapshot.data(), id: snapshot.id } as Event);
    }).catch(() => { if (active) setFetchError(true); }).finally(() => { if (active) setLoading(false); });
    try {
      const saved = JSON.parse(localStorage.getItem('az_saved_events') || '[]');
      setIsSaved(Array.isArray(saved) && saved.includes(id));
    } catch { setIsSaved(false); }
    return () => { active = false; };
  }, [id]);

  const handleShare = () => {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        toast.success(t('link_copied', 'Event link copied to clipboard!'));
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSave = () => {
    if (!id) return;
    try {
      const saved = JSON.parse(localStorage.getItem('az_saved_events') || '[]');
      let next: string[];
      if (saved.includes(id)) {
        next = saved.filter((item: string) => item !== id);
        setIsSaved(false);
      } else {
        next = [...saved, id];
        setIsSaved(true);
        toast.success(t('event_saved_feed', 'Event saved to your personal schedule!'));
      }
      localStorage.setItem('az_saved_events', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleEnterGiveaway = async () => {
    if (!currentUser) {
      toast.info(t('event_signin_draw'));
      navigate('/login');
      return;
    }

    if (!isTier3Subscriber) {
      toast.error(t('event_elite_draw'));
      return;
    }

    if (giveawayEntry) {
      toast.success(t('event_already_entered'));
      return;
    }

    if (!event) return;

    try {
      setIsEnteringGiveaway(true);
      const newEntry = {
        eventId: id || event.id,
        eventTitle: event.title || 'Fashion Runway Show',
        eventDate: event.date || Date.now(),
        eventLocation: event.location || 'Baku, Azerbaijan',
        eventImageUrl: event.imageUrl || '',
        userId: currentUser.uid,
        userName: dbUser?.name || currentUser.displayName || 'VIP Guest',
        userEmail: currentUser.email || '',
        userHandle: dbUser?.handle || dbUser?.username || '',
        userAvatar: dbUser?.avatarUrl || '',
        subscriptionTier: dbUser?.subscriptionTier || 'vip',
        enteredAt: Date.now(),
        isWinner: false,
        status: 'entered'
      };

      await addDoc(collection(db, 'giveaway_entries'), newEntry);
      toast.success(t('event_draw_entered'));
    } catch (err) {
      console.error('Error entering giveaway:', err);
      toast.error(t('event_draw_failed'));
    } finally {
      setIsEnteringGiveaway(false);
    }
  };

  function handleOpenBooking(mode: TicketDialogMode, tier?: TicketTier) {
    if (ended) return;
    if (mode === 'purchase' && externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (ticketState?.status === 'issued') {
      navigate('/dashboard?tab=tickets&section=purchased');
      return;
    }
    setBooking({ mode, tier });
  }

  const getGoogleCalendarUrl = (): string => {
    const start = parseEventDate(event?.date);
    if (!event || !start) return '';
    const end = parseEventDate(event.endDate) || new Date(start.getTime() + 2.5 * 60 * 60 * 1000);
    const formatTime = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, '');
    const title = encodeURIComponent(event.title || 'Fashion Event');
    const details = encodeURIComponent(event.description || 'Azerbaijan Fashion Week Runway Presentation');
    const location = encodeURIComponent(event.location || 'Heydar Aliyev Center, Baku');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${formatTime(start)}/${formatTime(end)}&details=${details}&location=${location}`;
  };

  const getGoogleMapsUrl = (): string => {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event?.location || 'Heydar Aliyev Center, Baku, Azerbaijan')}`;
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8">
        <div className="w-10 h-10 border-2 border-brand-accent border-r-transparent rounded-full animate-spin mb-4" />
        <span className="font-mono text-xs uppercase tracking-widest text-brand-dark/60">
          [LOADING RUNWAY DOSSIER...]
        </span>
      </div>
    );
  }

  if (fetchError || !event || (ended && !returning)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center space-y-4">
        <h2 className="text-2xl font-serif text-brand-dark">Event Not Found</h2>
        <p className="text-xs text-brand-dark/60">The requested fashion show or runway dossier does not exist.</p>
        <button
          onClick={() => navigate('/events')}
          className="px-5 py-2.5 rounded-full bg-brand-dark text-white text-xs font-semibold uppercase tracking-wider"
        >
          All Shows
        </button>
      </div>
    );
  }

  const prices = (event.ticketTiers?.length ? event.ticketTiers.map(tier => tier.price) : [event.ticketPrice ?? event.price])
    .map(ticketAmountMinor).filter((minor): minor is number => minor !== null);
  const lowestPrice = prices.length ? Math.min(...prices) / 100 : 0;

  const eventDate = parseEventDate(event.date);
  const endDate = parseEventDate(event.endDate);
  const schedule = eventScheduleRows(event.schedule);
  const dressCode = typeof event.dressCode === 'string' ? event.dressCode.trim() : '';
  const admissionRules = typeof event.admissionRules === 'string' ? event.admissionRules.trim() : '';

  return (
    <div className="animate-in fade-in duration-700 min-h-screen bg-brand-light text-brand-dark pt-2 sm:pt-4 pb-32 sm:pb-20 w-full max-w-full overflow-x-hidden">
      
      {/* Top Mobile Floating App Navigation Bar (Raised by 50% upwards) */}
      <div className="sm:hidden sticky top-[34px] z-30 bg-brand-light/95 backdrop-blur-xl border-b border-brand-dark/[0.08] px-4 py-1.5 flex items-center justify-between shadow-2xs transition-all">
        <button 
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/events');
            }
          }}
          className="w-8.5 h-8.5 rounded-full border border-brand-dark/15 bg-brand-card flex items-center justify-center text-brand-dark active:scale-95 shadow-2xs cursor-pointer"
          aria-label={t('ui_back')}
        >
          <ChevronLeft size={18} />
        </button>

        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-accent px-2 py-0.5 rounded-full bg-brand-accent/5 border border-brand-accent/20">
          OFFICIAL RUNWAY
        </span>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleSave}
            className={`w-8.5 h-8.5 rounded-full border flex items-center justify-center transition-all shadow-2xs cursor-pointer ${
              isSaved ? 'bg-brand-accent text-white border-brand-accent' : 'bg-brand-card border-brand-dark/15 text-brand-dark'
            }`}
            aria-label={t('ui_save')}
          >
            <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={handleShare}
            className="w-8.5 h-8.5 rounded-full border border-brand-dark/15 bg-brand-card text-brand-dark flex items-center justify-center shadow-2xs cursor-pointer"
            aria-label="Share"
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-10">
        
        {/* Desktop Back Breadcrumb */}
        <div className="hidden sm:flex items-center justify-between gap-4 mb-6">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate('/events');
              }
            }}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-dark/60 hover:text-brand-accent transition-colors group cursor-pointer"
          >
            <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            <span>{t('back_to_events', 'Back to Runway Schedule')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleSave}
              className={`px-4 py-2 rounded-full border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
                isSaved ? 'bg-brand-accent text-white border-brand-accent' : 'bg-brand-card border-brand-dark/15 text-brand-dark hover:border-brand-accent'
              }`}
            >
              <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
              <span>{isSaved ? 'Saved' : 'Save Show'}</span>
            </button>
            <button
              onClick={handleShare}
              className="px-4 py-2 rounded-full border border-brand-dark/15 bg-brand-card hover:border-brand-accent text-xs font-semibold uppercase tracking-wider text-brand-dark flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              {copied ? <Check size={14} /> : <Share2 size={14} />}
              <span>{copied ? t('copied', 'Copied') : t('share_event', 'Share')}</span>
            </button>
          </div>
        </div>

        {/* Unified Master Runway Dossier Card (Single Cohesive Whole) */}
        <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card shadow-xs overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-brand-dark/[0.08] items-stretch">
            
            {/* LEFT: Poster Image Banner & Quick Actions (Seamlessly Integrated) */}
            <div className="lg:col-span-5 p-4 pt-6 sm:p-6 lg:p-7 bg-brand-muted/10 flex flex-col justify-between gap-6">
              <div className="space-y-4 sm:space-y-4 pt-2 sm:pt-0">
                <div className="relative rounded-2xl overflow-hidden border border-brand-dark/[0.08] bg-brand-card shadow-2xs p-1.5 mt-2 sm:mt-0">
                  <div className="aspect-[4/3] sm:aspect-[3/4] w-full rounded-xl overflow-hidden bg-stone-900 relative flex items-center justify-center">
                    {event.imageUrl ? (
                      <>
                        {/* Ambient luxury backdrop blur so the full image floats gracefully without harsh borders */}
                        <SecureImage
                          src={event.imageUrl}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full object-cover filter blur-2xl opacity-40 scale-110 pointer-events-none select-none"
                          crossOrigin="anonymous"
                        />
                        {/* Full uncropped image fitting completely */}
                        <SecureImage
                          src={event.imageUrl}
                          alt={event.title}
                          className="w-full h-full object-contain relative z-10 select-none"
                          crossOrigin="anonymous"
                        />
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl font-display font-bold text-brand-dark/20">
                        AZ FASHION
                      </div>
                    )}

                    {/* Overlay Badge */}
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-brand-dark/85 backdrop-blur-md text-white font-display text-xs font-bold shadow-md border border-white/10">
                      {lowestPrice ? `Admission: ${lowestPrice} AZN` : 'Open Schedule'}
                    </div>

                    {availableTickets != null && availableTickets <= 10 && availableTickets > 0 && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-amber-500/90 text-white font-mono text-[10px] font-bold shadow-md flex items-center gap-1 backdrop-blur-md">
                        <Flame size={11} /> LIMITED PASSES
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Link Buttons under Poster */}
                <div className="grid grid-cols-2 gap-2.5 mt-3 sm:mt-0">
                  <a
                    href={getGoogleCalendarUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-xl border border-brand-dark/[0.08] bg-brand-card hover:border-brand-accent text-brand-dark text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-2xs"
                  >
                    <Calendar size={14} className="text-brand-accent shrink-0" />
                    <span className="truncate">{t('event_add_calendar')}</span>
                    <ExternalLink size={12} className="opacity-60" />
                  </a>

                  <a
                    href={getGoogleMapsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-xl border border-brand-dark/[0.08] bg-brand-card hover:border-brand-accent text-brand-dark text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-2xs"
                  >
                    <MapPin size={14} className="text-brand-accent shrink-0" />
                    <span className="truncate">{t('event_map')}</span>
                    <ExternalLink size={12} className="opacity-60" />
                  </a>
                </div>
              </div>

              {/* Fast Booking Callout in Left Wing */}
              <div className="pt-4 border-t border-brand-dark/[0.08] space-y-3">
                {/* 1. VIP Level 3 Exclusive Ticket Giveaway (Visible only to Tier 3 subscribers) */}
                {isTier3Subscriber && (
                  <div className="p-4 rounded-2xl bg-linear-to-br from-amber-500/10 via-brand-accent/5 to-white border border-amber-500/30 shadow-2xs space-y-3 relative overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-700 flex items-center justify-center shrink-0">
                          <Crown size={12} />
                        </span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-800 font-bold">
                          {t('event_vip_draw')}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 border border-amber-500/30">
                        ELITE PASS
                      </span>
                    </div>

                    {giveawayEntry ? (
                      <div className="space-y-2">
                        {giveawayEntry.isWinner ? (
                          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-900 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-xs">
                              <Trophy size={14} className="text-emerald-600" />
                              <span>{t('event_you_won')}</span>
                            </div>
                            <p className="text-[11px] text-emerald-800/80 leading-relaxed">
                              {t('event_vip_stored')}
                            </p>
                          </div>
                        ) : (
                          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-950 space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-900">
                              <CheckCircle2 size={14} className="text-amber-600" />
                              <span>{t('event_draw_active')}</span>
                            </div>
                            <p className="text-[11px] text-amber-900/75 leading-relaxed">
                              {t('event_draw_details')}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="text-xs text-brand-dark/75 leading-relaxed">
                          {t('event_draw_access')}
                        </p>

                        <button
                          onClick={handleEnterGiveaway}
                          disabled={isEnteringGiveaway}
                          className="w-full py-3 px-4 rounded-full bg-linear-to-r from-amber-600 to-brand-accent hover:from-amber-700 hover:to-brand-dark text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                          <Gift size={15} />
                          <span>{isEnteringGiveaway ? t('event_draw_loading') : t('event_enter_draw')}</span>
                          <Sparkles size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Standard Pass / Booking Direct Box */}
                <div className="hidden lg:block p-4 rounded-2xl bg-brand-card border border-brand-dark/[0.08] shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 font-bold">
                      ADMISSION PASS
                    </span>
                    <span className="font-display font-bold text-sm text-brand-accent">
                      {lowestPrice ? `${lowestPrice} AZN` : 'Free / Open'}
                    </span>
                  </div>
                  <button type="button" onClick={() => handleOpenBooking('reserve')} disabled={cannotReserve}
                    className="brand-button-outline min-h-11 w-full disabled:opacity-50">
                    <Ticket size={15} aria-hidden /> {reserveLabel}
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT: Editorial Event Dossier (Merged into Unified Whole) */}
            <div className="lg:col-span-7 flex flex-col gap-6 p-5 sm:p-8 md:p-10">
            
            {/* Header Folio */}
            <div className="space-y-2.5 border-b border-brand-dark/[0.08] pb-6">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-brand-dark/60 font-mono">
                  BAKU FASHION WEEK
                </span>
                <span className="text-brand-dark/20">•</span>
                <span className="text-[10px] sm:text-[11px] font-mono text-brand-accent font-semibold uppercase tracking-wider">
                  RUNWAY SHOW
                </span>
                {availableTickets != null && availableTickets <= 10 && availableTickets > 0 && (
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 border border-amber-500/20 flex items-center gap-1">
                    <Flame size={10} /> LIMITED PASSES
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-serif font-normal text-brand-dark leading-tight break-words">
                {event.title}
              </h1>

              <p className="text-xs sm:text-sm text-brand-dark/60 font-normal leading-relaxed break-words">
                {t('event_intro')}
              </p>
            </div>

            {/* Key Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Date & Time */}
              <div className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/30 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0">
                  <Calendar size={18} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 block font-semibold">
                    {t('event_date_time')}
                  </span>
                  <span className="font-display font-semibold text-xs sm:text-sm text-brand-dark block mt-0.5">
                    {eventDate ? eventDate.toLocaleDateString(language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Baku' }) : '--'}
                    {endDate && ` - ${endDate.toLocaleDateString(language, { day: 'numeric', month: 'short', timeZone: 'Asia/Baku' })}`}
                  </span>
                  <span className="text-[11px] text-brand-dark/60 font-mono">
                    {eventDate ? eventDate.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' }) : '—'} {t('event_baku_time')}
                  </span>
                </div>
              </div>

              {/* Location */}
              <div className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/30 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0">
                  <MapPin size={18} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 block font-semibold">
                    {t('event_venue')}
                  </span>
                  <span className="font-display font-semibold text-xs sm:text-sm text-brand-dark block mt-0.5 truncate max-w-full sm:max-w-[280px]" title={event.location}>
                    {event.location || 'Heydar Aliyev Center • Baku'}
                  </span>
                  <a
                    href={getGoogleMapsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-brand-accent font-medium hover:underline inline-flex items-center gap-1 mt-0.5"
                  >
                    <span>{t('event_map')}</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>

              {/* Admission Price */}
              <div className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/30 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0">
                  <Ticket size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 block font-semibold">
                    {t('event_admission')}
                  </span>
                  <span className="font-display font-semibold text-xs sm:text-sm text-brand-dark block mt-0.5">
                    {lowestPrice ? t('event_from_price', { price: lowestPrice }) : t('event_free_entry')}
                  </span>
                  <span className="text-[11px] text-brand-dark/60">
                    {event.ticketTiers?.length ? t('event_tiers_count', { total: event.ticketTiers.length }) : 'Guest Pass'}
                  </span>
                </div>
              </div>

              {/* Status */}
              <div className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/30 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center shrink-0">
                  <Sparkles size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 block font-semibold">
                    {t('event_status')}
                  </span>
                  <span className="font-display font-semibold text-xs sm:text-sm text-brand-dark block mt-0.5">
                    {t('event_status_confirmed')}
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    {t('event_booking_open')}
                  </span>
                </div>
              </div>
            </div>

            {/* Description Section */}
            <div className="space-y-2 border-t border-brand-dark/[0.08] pt-6">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/60 flex items-center gap-1.5">
                <Info size={13} className="text-brand-accent" />
                <span>{t('event_details')}</span>
              </h3>
              <p className="text-sm sm:text-base text-brand-dark/80 font-normal leading-relaxed whitespace-pre-wrap break-words">
                {event.description || t('event_details_empty')}
              </p>
            </div>

            {/* TICKET TIERS SECTION (Pure Informational Overview) */}
            <div className="space-y-3.5 border-t border-brand-dark/[0.08] pt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/70 flex items-center gap-1.5">
                  <Ticket size={13} className="text-brand-accent" />
                  <span>{t('event_ticket_tiers')}</span>
                </h3>
                <span className="text-[11px] font-mono text-brand-dark/50">
                  {availableTickets != null && (availableTickets === 0 ? t('ticket_checkout_sold_out') : t('ticket_checkout_stock', { quantity: availableTickets }))}
                </span>
              </div>

              {event.ticketTiers && event.ticketTiers.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {event.ticketTiers.map((tier, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/20 flex flex-col justify-between gap-2 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-display font-bold text-sm text-brand-dark uppercase tracking-wide">
                          {tier.name}
                        </span>
                        <span className="font-display font-bold text-sm sm:text-base text-brand-accent shrink-0 font-mono">
                          {tier.price > 0 ? `${tier.price} AZN` : 'Free'}
                        </span>
                      </div>
                      <p className="text-xs text-brand-dark/65 leading-relaxed">
                        {tier.name.toLowerCase().includes('vip') 
                          ? t('event_tier_vip')
                          : tier.name.toLowerCase().includes('front')
                          ? t('event_tier_front')
                          : t('event_tier_standard')}
                      </p>
                      <button type="button" className="brand-button-outline min-h-11 disabled:opacity-50" disabled={cannotReserve}
                        onClick={() => handleOpenBooking('reserve', tier)}>
                        {reserveLabel}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-brand-dark/[0.08] bg-brand-muted/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-sm text-brand-dark uppercase">
                        Admission Pass
                      </span>
                      <span className="font-display font-bold text-sm text-brand-accent font-mono">
                        {lowestPrice ? `${lowestPrice} AZN` : t('ticket_checkout_free')}
                      </span>
                    </div>
                    <p className="text-xs text-brand-dark/65 mt-1">
                      {t('event_pass_desc')}
                    </p>
                  </div>
                  <button type="button" className="brand-button-outline min-h-11 disabled:opacity-50" disabled={cannotReserve}
                    onClick={() => handleOpenBooking('reserve')}>
                    {reserveLabel}
                  </button>
                </div>
              )}
            </div>

            {schedule.length > 0 && (
              <section aria-labelledby="event-programme" className="space-y-3.5 border-t border-brand-dark/[0.08] pt-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 id="event-programme" className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/70 flex items-center gap-1.5">
                    <Clock size={13} className="text-brand-accent" aria-hidden />
                    {t('event_timeline')}
                  </h3>
                  <span className="text-[11px] text-brand-dark/65">{t('event_baku_time')}</span>
                </div>
                <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {schedule.map((row, index) => (
                    <li key={index} className="p-3 rounded-2xl bg-brand-muted/25 border border-brand-dark/[0.06] flex items-start gap-3">
                      <time dateTime={row.time} className="font-mono font-bold text-brand-accent shrink-0">{row.time}</time>
                      <div className="min-w-0 break-words">
                        <p className="font-semibold text-brand-dark">{row.title}</p>
                        {row.description && <p className="mt-0.5 text-brand-dark/70">{row.description}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {(dressCode || admissionRules) && (
              <section aria-labelledby="event-admission" className="space-y-3.5 border-t border-brand-dark/[0.08] pt-6">
                <h3 id="event-admission" className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/70 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-brand-accent" aria-hidden />
                  {t('event_admission_policy')}
                </h3>
                <div className="p-4 rounded-2xl bg-brand-muted/20 border border-brand-dark/[0.08] space-y-2 text-xs leading-relaxed">
                  {dressCode && <p className="break-words"><strong className="font-semibold text-brand-accent">{t('event_dress_code')}</strong> · {dressCode}</p>}
                  {admissionRules && <p className="whitespace-pre-line break-words text-brand-dark/80">{admissionRules}</p>}
                </div>
              </section>
            )}

            {/* ACTION BUTTONS (VISIBLE ON BOTH MOBILE AND DESKTOP) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-6 border-t border-brand-dark/[0.08]">
              <button
                onClick={() => handleOpenBooking('purchase')}
                disabled={externalUrl ? ended : cannotReserve}
                className="w-full sm:w-auto px-7 py-4 rounded-full bg-brand-accent text-white hover:bg-brand-dark transition-all font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <Ticket size={16} />
                <span>
                  {t(ticketState?.status === 'issued' ? 'tab_tickets' : externalUrl || lowestPrice > 0 ? 'ticket_checkout_buy' : 'ticket_checkout_get')}
                </span>
                {externalUrl ? <ExternalLink size={14} /> : <ArrowRight size={14} />}
              </button>

              <Link
                to="/events"
                className="w-full sm:w-auto px-6 py-4 rounded-full border border-brand-dark/15 bg-brand-card hover:border-brand-accent text-brand-dark font-semibold text-xs uppercase tracking-wider transition-colors shadow-2xs text-center cursor-pointer"
              >
                {t('view_calendar', 'Все показы расписания')}
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>

      {/* FIXED MOBILE DOCK ABOVE BOTTOM NAVIGATION BAR (Never collides with Layout bottom nav!) */}
      <div className="sm:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] inset-x-3 z-30 bg-brand-dark/95 text-white backdrop-blur-xl border border-white/15 p-3 rounded-2xl shadow-xl flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[9px] font-mono text-white/60 uppercase tracking-widest block font-semibold truncate">
            ADMISSION
          </span>
          <span className="font-display font-bold text-sm text-white">
            {lowestPrice ? `${lowestPrice} AZN` : 'Free / Open'}
          </span>
        </div>

        <button type="button" onClick={() => handleOpenBooking('reserve')} disabled={cannotReserve}
          className="min-h-11 px-4 py-2.5 rounded-full bg-brand-accent text-white active:scale-95 font-semibold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50">
          <Ticket size={14} aria-hidden />
          <span>{reserveLabel}</span>
        </button>
      </div>

      {currentUser && (booking || openingReservation || (returning && !externalUrl)) && (
        <TicketCheckoutDialog event={event} key={event.id} initialTier={booking?.tier}
          mode={booking?.mode ?? (returning ? 'purchase' : 'reserve')} returning={returning} onState={receiveCheckout} close={() => {
          setBooking(null);
          if (returning || openingReservation) {
            const next = new URLSearchParams(search);
            next.delete('checkout');
            setSearch(next, { replace: true });
          }
        }} />
      )}
    </div>
  );
}
