import '../locales/events';
import {SecureImage} from '../components/SecureMedia';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { eventEndMillis, formatBakuEventInput, parseEventDate } from '../lib/dateUtils';
import { dataMode } from '../lib/dataMode';
import { loadPublicEvents } from '../lib/publicSite';
import { useTranslation } from 'react-i18next';
import type { PublicEvent } from '../types';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar as CalendarIcon, 
  MapPin, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  X, 
  Clock, 
  Sparkles, 
  ArrowRight,
  ChevronDown,
  Search,
  SlidersHorizontal,
  Share2,
  Bookmark,
  Check,
  Ticket,
  Flame,
  Globe
} from 'lucide-react';
import { toast } from 'sonner';

function bakuEventDay(value: unknown): Date | null {
  const date = formatBakuEventInput(value).slice(0, 10);
  return date ? new Date(date + 'T00:00:00') : null;
}

function isEventOnDate(event: PublicEvent, targetDate: Date): boolean {
  const start = bakuEventDay(event.date)?.getTime();
  const end = bakuEventDay(eventEndMillis(event))?.getTime();
  return start !== undefined && end !== undefined && targetDate.getTime() >= start && targetDate.getTime() <= end;
}

function todayInBaku() {
  return bakuEventDay(Date.now())!;
}

export default function EventsList() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || 'az';
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Filter States (Concert Tour Style)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [isCalendarGridExpanded, setIsCalendarGridExpanded] = useState(true);
  const eventsListRef = useRef<HTMLDivElement>(null);

  // Calendar Navigator Month State
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(todayInBaku);
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  // Saved / bookmarked event IDs (Local state for Social Network DNA)
  const [savedEventIds, setSavedEventIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('az_saved_events') || '[]');
      return Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });

  const toggleSaveEvent = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSavedEventIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      try { localStorage.setItem('az_saved_events', JSON.stringify(next)); } catch {}
      if (!prev.includes(id)) {
        toast.success(t('event_saved_feed', 'Event saved to your personal schedule!'));
      }
      return next;
    });
  };

  const handleShare = (e: React.MouseEvent, event: PublicEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/event/${event.id}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast.success(t('event_link_copied', 'Event link copied to clipboard!')),
      () => toast.error(t('admin_load_failed')),
    );
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = dataMode === 'demo' ? [] : await loadPublicEvents();
      if (!active) return;
      if (result) {
        const now = Date.now();
        setEvents(result.filter(event => eventEndMillis(event) > now));
      }
      setFailed(result === null);
      setLoading(false);
    };
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, []);

  useEffect(() => {
    if (!events.length) return;
    const end = Math.min(...events.map(eventEndMillis));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setEvents(previous => previous.filter(event => eventEndMillis(event) > now));
    }, Math.max(0, Math.min(end - Date.now() + 10, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [events]);

  // Compute available locations for filter
  const availableLocations = useMemo(() => {
    const setLoc = new Set<string>();
    events.forEach((e) => {
      if (e.location) {
        const loc = e.location.split(',')[0].trim();
        if (loc) setLoc.add(loc);
      }
    });
    return Array.from(setLoc);
  }, [events]);

  const upcomingDays = useMemo(() => {
    const dates = events.flatMap(event => {
      const date = bakuEventDay(event.date);
      return date ? [date.getTime()] : [];
    });
    return [...new Set(dates)].sort((a, b) => a - b);
  }, [events]);
  const todayStart = todayInBaku().getTime();
  const nextEventDay = upcomingDays.find(day => day >= todayStart && (!selectedDate || day > selectedDate.getTime()));

  // Days in calendar month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDayRaw = new Date(year, month, 1).getDay();
  const startOffset = (startDayRaw + 6) % 7; // Monday = 0

  const calendarDays = useMemo(() => {
    const days: { date: Date; dayNum: number; isCurrentMonth: boolean; events: PublicEvent[] }[] = [];
    const prevMonthTotalDays = new Date(year, month, 0).getDate();

    for (let i = startOffset - 1; i >= 0; i--) {
      const prevDate = new Date(year, month - 1, prevMonthTotalDays - i);
      const dayEvs = events.filter((e) => isEventOnDate(e, prevDate));
      days.push({ date: prevDate, dayNum: prevMonthTotalDays - i, isCurrentMonth: false, events: dayEvs });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const thisDate = new Date(year, month, i);
      const dayEvs = events.filter((e) => isEventOnDate(e, thisDate));
      days.push({ date: thisDate, dayNum: i, isCurrentMonth: true, events: dayEvs });
    }

    const totalCells = Math.ceil(days.length / 7) * 7;
    const remaining = totalCells - days.length;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month + 1, i);
      const dayEvs = events.filter((e) => isEventOnDate(e, nextDate));
      days.push({ date: nextDate, dayNum: i, isCurrentMonth: false, events: dayEvs });
    }

    return days;
  }, [year, month, startOffset, daysInMonth, events]);

  // Filtered Events List (Concert Tour filtering engine)
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const d = parseEventDate(ev.date);
      if (!d) return false;

      // 1. Specific Date Filter (if user clicked a day in calendar)
      if (selectedDate && !isEventOnDate(ev, selectedDate)) {
        return false;
      }

      // 3. Location Filter
      if (selectedLocation !== 'all') {
        if (!ev.location || !ev.location.toLowerCase().includes(selectedLocation.toLowerCase())) {
          return false;
        }
      }

      // 4. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = ev.title?.toLowerCase().includes(q);
        const matchDesc = ev.description?.toLowerCase().includes(q);
        const matchLoc = ev.location?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchLoc) return false;
      }

      return true;
    });
  }, [events, selectedDate, selectedLocation, searchQuery]);

  // Group events by month for magazine tour list layout
  const groupedEventsByMonth = useMemo(() => {
    const groups: { monthTitle: string; events: PublicEvent[] }[] = [];
    filteredEvents.forEach((ev) => {
      const d = parseEventDate(ev.date);
      if (!d) return;
      const monthTitle = d.toLocaleString(i18n.language || 'en', { month: 'long', year: 'numeric', timeZone: 'Asia/Baku' }).toUpperCase();
      let group = groups.find((g) => g.monthTitle === monthTitle);
      if (!group) {
        group = { monthTitle, events: [] };
        groups.push(group);
      }
      group.events.push(ev);
    });
    return groups;
  }, [filteredEvents, i18n.language]);

  const clearAllFilters = () => {
    setSelectedDate(null);
    setSelectedLocation('all');
    setSearchQuery('');
  };

  const isToday = (date: Date) => date.getTime() === todayStart;

  const isSelectedDate = (d: Date) => {
    if (!selectedDate) return false;
    return (
      d.getDate() === selectedDate.getDate() &&
      d.getMonth() === selectedDate.getMonth() &&
      d.getFullYear() === selectedDate.getFullYear()
    );
  };

  // When calendar collapses, immediately reset scroll so month header never dips under sticky bar or calendar
  useEffect(() => {
    if (!isCalendarGridExpanded && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [isCalendarGridExpanded]);

  function goToNextEvent() {
    if (nextEventDay === undefined) return;
    const date = new Date(nextEventDay);
    setCurrentMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
    clearAllFilters();
    setSelectedDate(date);
    setIsCalendarGridExpanded(true);
  }

  const handleCalendarDayClick = (d: Date) => {
    if (selectedDate && isSelectedDate(d)) {
      setSelectedDate(null);
    } else {
      setSelectedDate(d);
      requestAnimationFrame(() => eventsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <div className="animate-in fade-in duration-700 min-h-screen flex flex-col bg-brand-light text-brand-dark overflow-x-hidden">
      {/* CONCERT TOUR-STYLE CALENDAR FILTER STRIP */}
      <section className="sticky top-[60px] sm:top-[68px] z-30 bg-brand-light/95 backdrop-blur-xl border-b border-brand-dark/[0.08] shadow-[0_4px_20px_-8px_rgba(18,18,18,0.04)] py-2.5 sm:py-3 px-3 sm:px-8 md:px-12 -translate-y-[30%]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Search and Secondary Controls */}
          <div className="flex flex-wrap items-center gap-2 w-full">
            {/* Quick Calendar Jump / Toggle Button */}
            <button
              onClick={() => {
                setIsCalendarGridExpanded((prev) => !prev);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 shrink-0 shadow-2xs border cursor-pointer ${
                isCalendarGridExpanded || selectedDate
                  ? 'bg-brand-accent text-white border-brand-accent shadow-xs'
                  : 'bg-brand-card text-brand-dark hover:border-brand-accent border-brand-dark/15'
              }`}
              title={isCalendarGridExpanded ? t('event_collapse_calendar') : t('event_open_calendar')}
            >
              <CalendarIcon size={13} className={isCalendarGridExpanded || selectedDate ? 'text-white' : 'text-brand-accent'} />
              <span className="hidden sm:inline">
                {isCalendarGridExpanded ? t('event_collapse_calendar') : t('event_calendar_dates')}
              </span>
              <span className="sm:hidden">
                {isCalendarGridExpanded ? t('event_collapse') : t('event_dates')}
              </span>
              <ChevronDown 
                size={13} 
                className={`transition-transform duration-200 ${isCalendarGridExpanded ? 'rotate-180 text-white/90' : 'text-brand-dark/50'}`} 
              />
              {selectedDate && <span className="w-1.5 h-1.5 rounded-full bg-brand-card animate-pulse" />}
            </button>

            {!isCalendarGridExpanded && <button type="button" className="brand-button-outline min-h-11" disabled={nextEventDay === undefined}
              onClick={goToNextEvent}>{t('events_next_event')}</button>}

            {/* Search Input */}
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-dark/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_tour_shows', 'Search shows, venue...')}
                className="w-full pl-8 pr-3 py-1.5 rounded-full bg-brand-card border border-brand-dark/15 text-xs text-brand-dark placeholder:text-brand-dark/40 focus:outline-none focus:border-brand-accent shadow-2xs transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-dark/40 hover:text-brand-dark"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* City Selector */}
            {availableLocations.length > 0 && (
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="px-3 py-1.5 rounded-full bg-brand-card border border-brand-dark/15 text-xs text-brand-dark uppercase tracking-wider focus:outline-none focus:border-brand-accent shadow-2xs cursor-pointer transition-colors"
              >
                <option value="all">{t('all_cities', 'All Cities')}</option>
                {availableLocations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            )}

            {/* Clear active filter button */}
            {failed && <p role="alert" className="py-2 text-sm text-brand-accent">{t('admin_load_failed')}</p>}
        {(selectedDate || selectedLocation !== 'all' || searchQuery) && (
              <button
                onClick={clearAllFilters}
                className="p-1.5 rounded-full hover:bg-brand-muted text-brand-accent hover:text-brand-dark transition-colors"
                title={t('reset_filters', 'Reset filters')}
              >
                <RotateCcw size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Active Filter Indicator Bar */}
        {(selectedDate || selectedLocation !== 'all' || searchQuery) && (
          <div className="max-w-7xl mx-auto pt-2.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="text-brand-dark/50 font-mono text-[11px] uppercase tracking-wider">Filtered by:</span>
            {selectedDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-brand-accent text-white text-[11px] font-medium shadow-xs">
                <span>{selectedDate.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <button onClick={() => setSelectedDate(null)}><X size={11} /></button>
              </span>
            )}
            {selectedLocation !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-brand-muted border border-brand-dark/15 text-brand-dark text-[11px] font-medium shadow-xs">
                <span>City: {selectedLocation}</span>
                <button onClick={() => setSelectedLocation('all')}><X size={11} /></button>
              </span>
            )}
            {searchQuery && (
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-brand-muted border border-brand-dark/15 text-brand-dark text-[11px] font-medium shadow-xs">
                <span>"{searchQuery}"</span>
                <button onClick={() => setSearchQuery('')}><X size={11} /></button>
              </span>
            )}
            <button
              onClick={clearAllFilters}
              className="text-[11px] text-brand-accent hover:underline font-medium ml-1"
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      {/* 3. EXPANDABLE MONTHLY CALENDAR GRID (Shows when user clicks "Calendar Grid") */}
      <AnimatePresence>
        {isCalendarGridExpanded && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="border-b border-brand-dark/[0.08] bg-brand-muted/30 overflow-hidden relative z-0"
          >
            <div className="max-w-7xl mx-auto pt-10 sm:pt-14 pb-6 px-4 sm:px-8 md:px-12">
              {/* Calendar Section Header & Month Navigation */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-3 border-b border-brand-dark/[0.08]">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-serif font-normal text-brand-dark">
                    {currentMonthDate.toLocaleString(i18n.language || 'ru', { month: 'long', year: 'numeric' }).toUpperCase()}
                  </h3>
                  <p className="text-xs text-brand-dark/60 mt-0.5 font-normal">
                    {t('event_select_day')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
                  <button type="button" className="brand-button-outline min-h-11" disabled={nextEventDay === undefined}
                    onClick={goToNextEvent}>
                    {t('events_next_event')} <ArrowRight size={14} />
                  </button>

                  <div className="flex items-center gap-1.5 bg-brand-card p-1 rounded-full border border-brand-dark/15 shadow-2xs">
                    <button
                      onClick={() => setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                      className="p-1.5 rounded-full hover:bg-brand-dark hover:text-white transition-all cursor-pointer text-brand-dark"
                      title={t('event_previous_month')}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setCurrentMonthDate(todayInBaku())}
                      className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider hover:bg-brand-dark hover:text-white transition-all cursor-pointer text-brand-dark"
                    >
                      {t('today', 'Сегодня')}
                    </button>
                    <button
                      onClick={() => setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                      className="p-1.5 rounded-full hover:bg-brand-dark hover:text-white transition-all cursor-pointer text-brand-dark"
                      title={t('event_next_month')}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  {/* Quick collapse button in calendar header */}
                  <button
                    onClick={() => setIsCalendarGridExpanded(false)}
                    className="p-2 rounded-full bg-brand-card hover:bg-brand-dark hover:text-white text-brand-dark border border-brand-dark/15 shadow-2xs transition-all cursor-pointer flex items-center gap-1 text-xs"
                    title={t('event_collapse_calendar')}
                  >
                    <X size={15} />
                    <span className="hidden sm:inline text-[11px] font-semibold uppercase pr-1">{t('event_collapse')}</span>
                  </button>
                </div>
              </div>

              {/* Calendar Days Wrapper with mobile horizontal protection */}
              <div className="overflow-x-auto no-scrollbar -mx-2 px-2 sm:mx-0 sm:px-0 pb-1">
                <div className="min-w-[300px]">
                  {/* Day names header */}
                  <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center font-mono text-[9px] sm:text-xs font-bold uppercase tracking-wider text-brand-dark/60 pb-2">
                    {Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, index + 1)))).map((day) => (
                      <div key={day} className="py-1">{day}</div>
                    ))}
                  </div>

                  {/* Days Grid */}
                  <div className="grid grid-cols-7 gap-1 sm:gap-2.5">
                    {calendarDays.map((cell, idx) => {
                      const hasShows = cell.events.length > 0;
                      const isCellSelected = isSelectedDate(cell.date);
                      const isCurrentDay = isToday(cell.date);

                      return (
                        <button
                          key={idx}
                          onClick={() => handleCalendarDayClick(cell.date)}
                          className={`min-h-[50px] sm:min-h-[82px] p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl flex flex-col justify-between text-left transition-all relative border cursor-pointer ${
                            isCellSelected
                              ? 'bg-brand-accent text-white border-brand-accent shadow-lg scale-[1.03] z-10 ring-2 ring-brand-accent/40'
                              : hasShows
                              ? 'bg-brand-accent/10 text-brand-dark border-brand-accent/40 hover:bg-brand-accent hover:text-white shadow-xs hover:scale-[1.02]'
                              : cell.isCurrentMonth
                              ? 'bg-brand-card/80 text-brand-dark/70 border-brand-dark/[0.08] hover:bg-brand-card hover:border-brand-dark/20'
                              : 'bg-transparent text-brand-dark/20 border-transparent hover:text-brand-dark/40'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-xs sm:text-base font-serif font-medium ${isCurrentDay && !isCellSelected ? 'text-brand-accent font-bold underline' : ''}`}>
                              {cell.dayNum}
                            </span>
                            {hasShows && (
                              <span className="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCellSelected ? 'bg-brand-card' : 'bg-brand-accent'}`} />
                                <span className={`relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 ${isCellSelected ? 'bg-brand-card' : 'bg-brand-accent'}`} />
                              </span>
                            )}
                          </div>

                          {hasShows && (
                            <div className={`w-full truncate text-[8px] sm:text-[10px] font-mono tracking-tight font-bold mt-0.5 sm:mt-1 px-1 sm:px-1.5 py-0.5 rounded sm:rounded-md text-center ${
                              isCellSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-brand-accent text-white'
                            }`}>
                              {t('event_show_count', { total: cell.events.length })}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Selected Date Feedback Bar & Collapse Button */}
              <div className="mt-4 pt-3 border-t border-brand-dark/[0.08] flex items-center justify-between gap-3 text-xs flex-wrap">
                <button
                  onClick={() => setIsCalendarGridExpanded(false)}
                  className="px-3 py-1.5 rounded-full bg-brand-card hover:bg-brand-dark hover:text-white text-brand-dark/70 border border-brand-dark/15 font-mono text-[11px] uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <span>{t('event_collapse_calendar')}</span>
                </button>

                <div className="flex items-center gap-2">
                  {selectedDate ? (
                    <div className="flex items-center gap-2 bg-brand-accent text-white px-3.5 py-1.5 rounded-full font-mono text-xs font-semibold shadow-xs">
                      <span>
                        {t('event_day_selected', { date: selectedDate.toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' }) })}
                      </span>
                      <button
                        onClick={() => setSelectedDate(null)}
                        className="ml-1 bg-white/20 hover:bg-white/30 text-white rounded-full p-0.5 cursor-pointer"
                        title={t('event_clear_day')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-mono text-brand-dark/50">
                      {t('event_select_day')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* 4. MAIN SECTION: CONCERT TOUR DATES LIST (По списку) */}
      <main ref={eventsListRef} style={{ scrollMarginTop: 140 }} className="flex-1 max-w-7xl mx-auto w-full pt-12 sm:pt-16 pb-16 px-4 sm:px-8 md:px-12 scroll-mt-36 relative z-10 bg-brand-light">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-10 h-10 border-2 border-brand-accent border-r-transparent rounded-full animate-spin mb-4" />
            <p className="font-mono text-xs uppercase tracking-widest text-brand-dark/70">
              [LOADING RUNWAY TOUR ARCHIVE...]
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          /* Empty State */
          <div className="text-center py-20 px-6 max-w-xl mx-auto rounded-3xl border border-brand-dark/[0.08] bg-brand-muted/30 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-brand-accent/10 text-brand-accent mx-auto flex items-center justify-center mb-4">
              <CalendarIcon size={22} />
            </div>
            <h3 className="text-2xl font-serif font-normal text-brand-dark mb-2">
              {t('no_shows_for_filter', 'No Shows Scheduled')}
            </h3>
            <p className="text-sm text-brand-dark/70 mb-6 font-normal">
              {t('no_shows_desc', 'There are no runway shows matching your current filter criteria. Reset the filter to view all upcoming tour dates.')}
            </p>
            <button
              onClick={clearAllFilters}
              className="brand-button px-6 py-3 text-xs inline-flex items-center gap-2"
            >
              <RotateCcw size={14} />
              <span>{t('show_all_tour_dates', 'Show All Tour Dates')}</span>
            </button>
          </div>
        ) : (
          /* Concert Tour Dates Groups */
          <div className="space-y-12">
            {groupedEventsByMonth.map((group) => (
              <section key={group.monthTitle} className="space-y-4 scroll-mt-36 relative z-20">
                {/* Month Group Header */}
                <div className="flex items-center justify-between border-b border-brand-dark/[0.08] pb-3 pt-2 sm:pt-3 relative z-20 bg-brand-light">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl sm:text-3xl font-serif font-normal text-brand-dark tracking-tight">
                      {group.monthTitle}
                    </h2>
                    <span className="font-mono text-[10px] sm:text-xs text-brand-accent font-semibold px-2.5 py-0.5 rounded-full bg-brand-accent/5 border border-brand-accent/20">
                      {group.events.length} {group.events.length === 1 ? 'SHOW' : 'SHOWS'}
                    </span>
                  </div>
                </div>

                {/* Tour List Rows (Music Concert Website Style) */}
                <div className="space-y-3">
                  {group.events.map((ev) => {
                    const start = parseEventDate(ev.date);
                    const isSaved = savedEventIds.includes(ev.id);

                    const dayNumber = bakuEventDay(ev.date)?.getDate() ?? '—';
                    const weekday = start ? start.toLocaleString(language, { weekday: 'short', timeZone: 'Asia/Baku' }).toUpperCase() : '';
                    const monthShort = start ? start.toLocaleString(language, { month: 'short', timeZone: 'Asia/Baku' }).toUpperCase() : '';
                    const timeStr = start ? start.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' }) : '—';

                    const lowestPrice =
                      ev.ticketTiers && ev.ticketTiers.length > 0
                        ? Math.min(...ev.ticketTiers.map((t) => t.price))
                        : ev.price;

                    return (
                      <article
                        key={ev.id}
                        className="group relative rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-4 sm:p-5 md:p-6 transition-all duration-300 hover:border-brand-accent/30 hover:shadow-[0_12px_36px_-12px_rgba(18,18,18,0.08)] hover:-translate-y-0.5 shadow-2xs"
                      >
                        {/* MOBILE APP LAYOUT (Below md) */}
                        <div className="md:hidden flex flex-col w-full">
                          {/* Banner Poster with Floating Pill Badges */}
                          <div className="relative w-full rounded-2xl overflow-hidden bg-brand-muted/30 border border-brand-dark/[0.08] mb-3">
                            <Link to={`/event/${ev.id}`} className="w-full block">
                              {ev.imageUrl ? (
                                <SecureImage
                                  src={ev.imageUrl}
                                  alt={ev.title}
                                  className="w-full h-auto object-contain block"
                                  crossOrigin="anonymous"
                                />
                              ) : (
                                <div className="w-full aspect-[16/9] flex items-center justify-center font-display text-xl text-brand-dark/30">
                                  AZ FASHION
                                </div>
                              )}
                            </Link>

                            {/* Floating Date Pill */}
                            <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-brand-dark/90 backdrop-blur-md text-white font-mono text-[10px] font-semibold flex items-center gap-1.5 shadow-md border border-white/10">
                              <span className="text-brand-accent font-bold">{weekday} {dayNumber}</span>
                              <span>•</span>
                              <span>{monthShort} {timeStr}</span>
                            </div>

                            {/* Floating Action Icons */}
                            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                              <button
                                onClick={(e) => toggleSaveEvent(e, ev.id)}
                                className={`w-7 h-7 rounded-full flex items-center justify-center shadow-md backdrop-blur-md transition-all ${
                                  isSaved ? 'bg-brand-accent text-white' : 'bg-brand-card/95 text-brand-dark hover:bg-brand-card'
                                }`}
                                aria-label="Save Show"
                              >
                                <Bookmark size={13} fill={isSaved ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                onClick={(e) => handleShare(e, ev)}
                                className="w-7 h-7 rounded-full bg-brand-card/95 backdrop-blur-md text-brand-dark hover:bg-brand-card flex items-center justify-center shadow-md transition-all"
                                aria-label="Share Event"
                              >
                                <Share2 size={13} />
                              </button>
                            </div>

                            {/* Floating Admission Pill */}
                            <div className="absolute bottom-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-brand-card/95 backdrop-blur-md text-brand-dark font-display text-xs font-bold shadow-md border border-brand-dark/10">
                              {lowestPrice ? `${lowestPrice} AZN` : t('open_schedule', 'Open Schedule')}
                            </div>
                          </div>

                          {/* Mobile Event Meta & Body */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-brand-accent/5 text-brand-accent border border-brand-accent/20 font-mono">
                                OFFICIAL RUNWAY
                              </span>
                              {ev.availableTickets !== undefined && ev.availableTickets <= 10 && ev.availableTickets > 0 && (
                                <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 border border-amber-500/20 flex items-center gap-1">
                                  <Flame size={9} /> LIMITED PASSES
                                </span>
                              )}
                            </div>

                            <Link to={`/event/${ev.id}`}>
                              <h3 className="text-lg font-display font-bold text-brand-dark leading-tight line-clamp-2">
                                {ev.title}
                              </h3>
                            </Link>

                            <div className="flex items-center gap-1.5 text-xs text-brand-dark/70 font-normal">
                              <MapPin size={13} className="text-brand-accent shrink-0" />
                              <span className="truncate">{ev.location || 'Heydar Aliyev Center • Baku'}</span>
                            </div>

                            {/* Full-width Touch CTA */}
                            <div className="pt-2">
                              <Link
                                to={`/event/${ev.id}`}
                                className="w-full py-3 rounded-full bg-brand-dark text-white hover:bg-brand-accent transition-colors flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider shadow-2xs active:scale-[0.98]"
                              >
                                <span>{t('view_tickets_cta', 'Билеты & Досье показа')}</span>
                                <ArrowRight size={13} />
                              </Link>
                            </div>
                          </div>
                        </div>

                        {/* DESKTOP & TABLET ROW LAYOUT (md: and above) */}
                        <div className="hidden md:flex flex-row items-center justify-between gap-5 w-full">
                          {/* LEFT SECTION: Tour Date Badge & Thumbnail */}
                          <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                            {/* Concert Tour Date Block */}
                            <div className="w-20 sm:w-22 h-20 sm:h-24 rounded-2xl bg-brand-muted/60 border border-brand-dark/[0.08] flex flex-col items-center justify-center text-center p-2 shrink-0 group-hover:border-brand-accent/30 transition-colors shadow-2xs">
                              <span className="text-[10px] sm:text-[11px] font-bold text-brand-accent uppercase tracking-wider">
                                {weekday}
                              </span>
                              <span className="font-display text-3xl sm:text-4xl font-bold leading-none text-brand-dark my-0.5">
                                {dayNumber}
                              </span>
                              <span className="text-[10px] sm:text-[11px] font-semibold text-brand-dark/70 uppercase tracking-wider">
                                {monthShort}
                              </span>
                            </div>

                            {/* Event Poster Thumbnail */}
                            <Link 
                              to={`/event/${ev.id}`}
                              className="w-20 sm:w-22 h-20 sm:h-24 rounded-2xl overflow-hidden bg-brand-muted border border-brand-dark/[0.08] shrink-0 relative block"
                            >
                              {ev.imageUrl ? (
                                <SecureImage
                                  src={ev.imageUrl}
                                  alt={ev.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                  crossOrigin="anonymous"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center font-display text-xl text-brand-dark/30">
                                  AZ
                                </div>
                              )}
                            </Link>
                          </div>

                          {/* CENTER SECTION: Event Details & Metadata */}
                          <div className="flex-1 min-w-0 pr-0 lg:pr-6">
                            {/* Badges / Category row */}
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="text-[10px] uppercase tracking-wider font-semibold px-2.5 py-0.5 rounded-full bg-brand-accent/5 text-brand-accent border border-brand-accent/20 font-mono">
                                OFFICIAL RUNWAY
                              </span>
                              {ev.availableTickets !== undefined && ev.availableTickets <= 10 && ev.availableTickets > 0 && (
                                <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 border border-amber-500/20 flex items-center gap-1">
                                  <Flame size={10} /> LIMITED PASSES
                                </span>
                              )}
                              <span className="text-[11px] text-brand-dark/60 font-medium flex items-center gap-1">
                                <Clock size={11} /> {timeStr} AZT
                              </span>
                            </div>

                            {/* Title */}
                            <Link to={`/event/${ev.id}`}>
                              <h3 className="text-xl sm:text-2xl font-display font-semibold text-brand-dark group-hover:text-brand-accent transition-colors leading-tight mb-2 truncate">
                                {ev.title}
                              </h3>
                            </Link>

                            {/* Venue / Location */}
                            <div className="flex items-center gap-2 text-xs sm:text-sm text-brand-dark/75 font-normal">
                              <MapPin size={13} className="text-brand-accent shrink-0" />
                              <span className="truncate">{ev.location || 'Heydar Aliyev Center • Baku'}</span>
                            </div>
                          </div>

                          {/* RIGHT SECTION: Price & Ticket Action */}
                          <div className="flex flex-col items-end justify-center gap-3 shrink-0">
                            {/* Price */}
                            <div className="text-right">
                              <div className="text-[10px] uppercase tracking-wider font-semibold text-brand-dark/50 font-mono">
                                ADMISSION
                              </div>
                              <div className="font-display text-lg sm:text-xl font-semibold text-brand-dark">
                                {lowestPrice ? `${lowestPrice} AZN` : t('open_schedule', 'Open Schedule')}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => toggleSaveEvent(e, ev.id)}
                                className={`p-2.5 rounded-full border transition-all shadow-xs ${
                                  isSaved
                                    ? 'bg-brand-accent text-white border-brand-accent'
                                    : 'bg-brand-light border-brand-dark/15 text-brand-dark hover:border-brand-dark'
                                }`}
                                title={isSaved ? 'Saved in personal calendar' : 'Save show'}
                                aria-label="Save Show"
                              >
                                <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
                              </button>

                              <button
                                onClick={(e) => handleShare(e, ev)}
                                className="p-2.5 rounded-full border border-brand-dark/15 bg-brand-light text-brand-dark hover:border-brand-dark transition-all shadow-xs"
                                title="Share event link"
                                aria-label="Share Event"
                              >
                                <Share2 size={14} />
                              </button>

                              <Link
                                to={`/event/${ev.id}`}
                                className="px-5 py-2.5 rounded-full bg-brand-dark text-white hover:bg-brand-accent text-xs font-semibold uppercase tracking-wider flex items-center gap-2 shadow-xs group/btn whitespace-nowrap transition-colors"
                              >
                                <span>{t('view_tickets_cta', 'Tickets / Details')}</span>
                                <ArrowRight size={13} className="transition-transform group-hover/btn:translate-x-1" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
