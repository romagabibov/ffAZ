import { eventEndMillis, getTimestampMillis } from '../../lib/dateUtils';
import { readApiJson } from '../../lib/apiClient';
import {apiFetch} from '../../lib/apiClient';
import {SecureImage} from '../SecureMedia';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, limit, startAfter, documentId, type QueryDocumentSnapshot } from '../../lib/firestoreClient';
import { db } from '../../lib/firebase';
import { GiveawayEntry, Event } from '../../types';
import { toast } from 'sonner';
import { createNotification } from '../../lib/notificationService';
import { 
  Gift, 
  Crown, 
  Trophy, 
  Sparkles, 
  Search, 
  CheckCircle2, 
  X, 
  RotateCcw, 
  Trash2, 
  Calendar, 
  MapPin, 
  User, 
  Mail, 
  AtSign, 
  Dices, 
  ExternalLink,
  ChevronRight,
  Flame,
  Award,
  Filter
} from 'lucide-react';

export default function TicketGiveawaysAdminTab() {
  const [giveaways, setGiveaways] = useState<GiveawayEntry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [participantFilter, setParticipantFilter] = useState<'all' | 'winners' | 'pending'>('all');

  // Autogenerator Random Shuffle Animation State
  const [isRolling, setIsRolling] = useState(false);
  const [rollingCandidate, setRollingCandidate] = useState<string>('');
  const [winnerCelebration, setWinnerCelebration] = useState<GiveawayEntry | null>(null);

  const [failed, setFailed] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesCursor, setEntriesCursor] = useState<QueryDocumentSnapshot | null>(null);
  const task = useRef(0);

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('date', 'desc'), limit(100));
    return onSnapshot(q, snapshot => {
      setEvents(snapshot.docs.map(row => ({ ...row.data(), id: row.id } as Event)).filter(event => {
        const end = eventEndMillis(event);
        return !end || end > Date.now();
      }));
      setLoading(false);
    }, () => { setLoading(false); setFailed(true); });
  }, []);

  useEffect(() => {
    task.current++;
    setEntriesCursor(null);
    setGiveaways([]);
    setWinnerCelebration(null);
    if (!selectedEventId) return;
    void loadEntries(selectedEventId);
    return () => { task.current++; };
  }, [selectedEventId]);

  async function loadEntries(eventId: string, cursor?: QueryDocumentSnapshot) {
    const request = ++task.current;
    setEntriesLoading(true);
    setFailed(false);
    try {
      const base = query(collection(db, 'giveaway_entries'), where('eventId', '==', eventId), orderBy(documentId()), limit(50));
      const page = await getDocs(cursor ? query(base, startAfter(cursor)) : base);
      if (request !== task.current) return;
      const entries = page.docs.map(d => ({ ...d.data(), id: d.id } as GiveawayEntry));
      setGiveaways(previous => (cursor ? [...previous, ...entries] : entries).sort((a, b) => getTimestampMillis(b.enteredAt) - getTimestampMillis(a.enteredAt)));
      setEntriesCursor(page.size === 50 ? page.docs.at(-1)! : null);
    } catch {
      if (request === task.current) setFailed(true);
    } finally {
      if (request === task.current) setEntriesLoading(false);
    }
  }

  const eventGroups = useMemo(() => Object.fromEntries(events.map(event => {
    const entries = event.id === selectedEventId ? giveaways : [];
    return [event.id, {
      event, eventTitle: event.title, eventDate: event.date, entries, winners: entries.filter(entry => entry.isWinner),
    }];
  })), [giveaways, events, selectedEventId]);

  // Currently selected event group
  const activeGroup = selectedEventId ? eventGroups[selectedEventId] : null;

  // Filtered participants in modal
  const filteredParticipants = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.entries.filter((entry) => {
      const matchesSearch = 
        !searchQuery.trim() ||
        entry.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.userEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.userHandle?.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (participantFilter === 'winners') return !!entry.isWinner;
      if (participantFilter === 'pending') return !entry.isWinner;
      return true;
    });
  }, [activeGroup, searchQuery, participantFilter]);

  // Run the Random Auto-Generator
  const handleRunAutoGenerator = async () => {
    if (!activeGroup || activeGroup.entries.length === 0) {
      toast.error('Нет зарегистрированных участников для розыгрыша.');
      return;
    }

    const pool = activeGroup.entries.filter(entry => !entry.isWinner);
    if (entriesLoading || entriesCursor || isRolling || !pool.length) return;
    const finalWinner = pool[Math.floor(Math.random() * pool.length)];
    setIsRolling(true);
    setWinnerCelebration(null);
    try {
      await modifyEntry('award', finalWinner);
      setWinnerCelebration(finalWinner);
    } catch {} finally {
      setIsRolling(false);
    }
  };

  async function modifyEntry(action: 'award' | 'revoke' | 'delete', entry: Pick<GiveawayEntry, 'id' | 'userName'>) {
    const route = action === 'award' ? 'giveaway-award' : 'giveaway-revoke';
    try {
      await readApiJson('/api/admin/' + route, { method: 'POST', body: JSON.stringify({ entryId: entry.id, remove: action === 'delete' }) });
      setGiveaways(previous => action === 'delete' ? previous.filter(row => row.id !== entry.id) : previous.map(row =>
        row.id === entry.id ? { ...row, isWinner: action === 'award', status: action === 'award' ? 'won' : 'entered' } : row));
      toast.success(action === 'award' ? 'Билет выдан' : action === 'revoke' ? 'Билет отозван' : 'Заявка удалена');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить заявку');
      throw error;
    }
  }

  const handleToggleWinner = (entry: GiveawayEntry, value: boolean) => {
    void modifyEntry(value ? 'award' : 'revoke', entry).catch(() => {});
  };
  const handleDeleteEntry = (id: string, name: string) => {
    if (!window.confirm(`Удалить заявку участника «${name}» из розыгрыша?`)) return;
    void modifyEntry('delete', { id, userName: name }).catch(() => {});
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-brand-dark/[0.08] pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-800 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center gap-1">
              <Crown size={11} /> LEVEL 3 VIP • РОЗЫГРЫШИ
            </span>
            <span className="text-[10px] font-mono text-brand-dark/50">
              {events.length} событий
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif font-normal tracking-tight text-brand-dark">
            Розыгрыши билетов на показы
          </h2>
          <p className="text-xs text-brand-dark/60 mt-0.5">
            Управление заявками подписчиков Elite VIP (3-й уровень), просмотр списков и запуск автогенератора выбора победителей.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-900 text-xs font-mono flex items-center gap-2">
            <Trophy size={16} className="text-amber-600 shrink-0" />
            <span>Победителей выбрано: <strong>{giveaways.filter(g => g.isWinner).length}</strong></span>
          </div>
        </div>
      </div>

      {failed && <p role="alert" className="text-sm text-brand-accent">Не удалось загрузить список.</p>}
      {loading ? (
        <div className="p-12 text-center">
          <div className="w-8 h-8 border-2 border-amber-600 border-r-transparent rounded-full animate-spin mx-auto mb-3" />
          <span className="text-xs font-mono uppercase text-brand-dark/60 tracking-wider">
            [Загрузка розыгрышей...]
          </span>
        </div>
      ) : Object.keys(eventGroups).length === 0 ? (
        <div className="text-center p-12 sm:p-16 rounded-3xl border border-dashed border-brand-dark/20 bg-brand-card shadow-2xs max-w-xl mx-auto space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-700 flex items-center justify-center mx-auto">
            <Gift size={24} />
          </div>
          <h3 className="text-lg font-display font-semibold text-brand-dark uppercase">
            Нет активных заявок на розыгрыш
          </h3>
          <p className="text-xs text-brand-dark/60 max-w-md mx-auto leading-relaxed">
            Когда подписчики 3-го уровня (Elite VIP) нажмут кнопку «Выиграть билет» на страницах показов, их заявки сгруппируются здесь по каждому событию.
          </p>
        </div>
      ) : (
        /* Event Groups Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Object.entries(eventGroups).map(([evId, group]) => {
            const hasWinners = group.winners.length > 0;
            return (
              <div 
                key={evId}
                className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-4 hover:border-amber-500/40 hover:shadow-md transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-800 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1">
                      <Gift size={11} /> {evId === selectedEventId && !entriesLoading ? `${group.entries.length} участников` : 'Участники'}
                    </span>

                    {hasWinners ? (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 border border-emerald-500/30 flex items-center gap-1">
                        <Trophy size={10} /> {group.winners.length} ПОБЕДИТЕЛЬ
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        Ожидает розыгрыша
                      </span>
                    )}
                  </div>

                  <h3 className="font-display font-bold text-lg text-brand-dark leading-snug group-hover:text-amber-800 transition-colors">
                    {group.eventTitle}
                  </h3>

                  <div className="text-xs text-brand-dark/60 mt-2 space-y-1">
                    {group.eventDate && (
                      <p className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-brand-accent shrink-0" />
                        <span>{new Date(group.eventDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </p>
                    )}
                    {group.event?.location && (
                      <p className="flex items-center gap-1.5">
                        <MapPin size={13} className="text-brand-accent shrink-0" />
                        <span className="truncate">{group.event.location}</span>
                      </p>
                    )}
                  </div>

                  {/* Winner Preview Pill if exists */}
                  {hasWinners && (
                    <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
                      <span className="text-[9px] font-mono uppercase text-emerald-700 font-bold block mb-0.5">ПОБЕДИТЕЛЬ:</span>
                      <p className="font-semibold truncate">
                        🏆 {group.winners.map(w => w.userName).join(', ')}
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-brand-dark/[0.08] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-brand-dark/50">
                    Список участников
                  </span>

                  <button
                    onClick={() => {
                      setSelectedEventId(evId);
                      setWinnerCelebration(null);
                      setSearchQuery('');
                      setParticipantFilter('all');
                    }}
                    className="px-4 py-2 rounded-full bg-brand-dark hover:bg-amber-600 text-white text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95"
                  >
                    <span>Розыгрыш</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* EVENT PARTICIPANTS & AUTOGENERATOR MODAL */}
      {selectedEventId && activeGroup && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.1] max-w-4xl w-full p-6 sm:p-8 shadow-2xl space-y-6 my-auto max-h-[92vh] overflow-y-auto relative text-brand-dark">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-brand-dark/[0.08] pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-800 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1">
                    <Crown size={12} /> РОЗЫГРЫШ VIP-БИЛЕТОВ
                  </span>
                  <span className="text-[10px] font-mono text-brand-dark/50">
                    {activeGroup.entries.length} участников
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-serif text-brand-dark font-normal">
                  {activeGroup.eventTitle}
                </h3>
              </div>

              <button
                onClick={() => setSelectedEventId(null)}
                className="w-8 h-8 rounded-full border border-brand-dark/15 hover:bg-neutral-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* AUTOGENERATOR INTERACTIVE HERO BOX */}
            <div className="rounded-3xl border-2 border-amber-500/40 bg-linear-to-br from-amber-500/15 via-amber-400/5 to-white p-6 sm:p-8 text-center space-y-4 shadow-sm relative overflow-hidden">
              <div className="max-w-md mx-auto space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold tracking-widest text-amber-900 bg-amber-500/20 px-3 py-1 rounded-full border border-amber-500/30 inline-block">
                  ⚡ АВТОГЕНЕРАТОР ПОБЕДИТЕЛЯ
                </span>
                <h4 className="text-lg sm:text-xl font-display font-bold text-brand-dark">
                  Случайный выбор победителя среди участников Elite VIP
                </h4>
                <p className="text-xs text-brand-dark/70">
                  Алгоритм случайным образом выберет победителя из {activeGroup.entries.length} зарегистрированных подписчиков 3-го уровня и отправит ему именное уведомление.
                </p>
              </div>

              {/* Rolling Animation Display */}
              {isRolling && (
                <div className="py-4 px-6 rounded-2xl bg-brand-dark text-amber-300 font-mono text-lg sm:text-xl font-bold border border-amber-400/30 animate-pulse shadow-lg max-w-sm mx-auto flex items-center justify-center gap-3">
                  <Dices size={24} className="animate-spin text-amber-400" />
                  <span className="truncate">{rollingCandidate || 'Выбор...'}</span>
                </div>
              )}

              {/* Winner Celebratory Reveal Box */}
              {winnerCelebration && !isRolling && (
                <div className="p-5 rounded-2xl bg-emerald-500/15 border-2 border-emerald-500 text-emerald-950 max-w-md mx-auto space-y-2 animate-in zoom-in-95 duration-200 shadow-md">
                  <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-sm">
                    <Trophy size={24} />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-widest font-bold text-emerald-800 block">
                    🎉 ПОБЕДИТЕЛЬ РОЗЫГРЫША!
                  </span>
                  <p className="font-display font-bold text-xl text-emerald-950">
                    {winnerCelebration.userName}
                  </p>
                  <p className="text-xs font-mono text-emerald-800">
                    {winnerCelebration.userEmail} {winnerCelebration.userHandle ? `• @${winnerCelebration.userHandle}` : ''}
                  </p>
                  <span className="text-[11px] text-emerald-900 block pt-1">
                    ✓ VIP-билет подтвержден и добавлен в кабинет гостя
                  </span>
                </div>
              )}

              {/* Action Button */}
              <div>
                <button
                  onClick={handleRunAutoGenerator}
                  disabled={isRolling || entriesLoading || Boolean(entriesCursor) || activeGroup.entries.every(entry => entry.isWinner)}
                  className="px-8 py-4 rounded-full bg-linear-to-r from-amber-600 to-brand-accent hover:from-amber-700 hover:to-brand-dark text-white font-semibold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all shadow-md active:scale-95 cursor-pointer mx-auto disabled:opacity-50"
                >
                  <Dices size={18} className={isRolling ? 'animate-spin' : ''} />
                  <span>{isRolling ? 'Выбираем победителя...' : 'Запустить автогенератор (Выбрать победителя)'}</span>
                  <Sparkles size={16} />
                </button>
              </div>
            </div>

            {/* Participants Filter & Search Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-1.5 p-1 bg-brand-muted/30 border border-brand-dark/[0.08] rounded-full text-xs font-semibold">
                <button
                  onClick={() => setParticipantFilter('all')}
                  className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                    participantFilter === 'all' ? 'bg-brand-dark text-white' : 'text-brand-dark/70 hover:text-brand-dark'
                  }`}
                >
                  Все ({activeGroup.entries.length})
                </button>
                <button
                  onClick={() => setParticipantFilter('winners')}
                  className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                    participantFilter === 'winners' ? 'bg-emerald-700 text-white' : 'text-brand-dark/70 hover:text-brand-dark'
                  }`}
                >
                  Победители ({activeGroup.winners.length})
                </button>
                <button
                  onClick={() => setParticipantFilter('pending')}
                  className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                    participantFilter === 'pending' ? 'bg-amber-700 text-white' : 'text-brand-dark/70 hover:text-brand-dark'
                  }`}
                >
                  В ожидании ({activeGroup.entries.length - activeGroup.winners.length})
                </button>
              </div>

              {/* Search */}
              <div className="relative flex-1 sm:max-w-xs">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-dark/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по имени, email..."
                  className="w-full pl-9 pr-4 py-2 rounded-full border border-brand-dark/15 bg-brand-card text-xs outline-none focus:border-brand-accent transition-colors shadow-2xs"
                />
              </div>
            </div>

            {/* Participants List / Table */}
            <div className="border border-brand-dark/[0.08] rounded-2xl overflow-hidden bg-brand-card shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-brand-muted/40 border-b border-brand-dark/[0.08] font-mono text-[10px] uppercase text-brand-dark/60 tracking-wider">
                      <th className="p-3 pl-4">Участник</th>
                      <th className="p-3">Email / Контакты</th>
                      <th className="p-3">Тариф</th>
                      <th className="p-3">Дата заявки</th>
                      <th className="p-3">Статус</th>
                      <th className="p-3 text-right pr-4">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-dark/[0.06]">
                    {filteredParticipants.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-brand-dark/50">
                          Участники по заданным критериям не найдены.
                        </td>
                      </tr>
                    ) : (
                      filteredParticipants.map((entry) => (
                        <tr 
                          key={entry.id} 
                          className={`hover:bg-brand-muted/20 transition-colors ${
                            entry.isWinner ? 'bg-emerald-50/60 font-medium' : ''
                          }`}
                        >
                          <td className="p-3 pl-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-brand-muted border border-brand-dark/10 overflow-hidden flex items-center justify-center font-bold text-xs shrink-0 text-brand-dark">
                                {entry.userAvatar ? (
                                  <SecureImage src={entry.userAvatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span>{entry.userName?.charAt(0) || 'U'}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="font-semibold text-brand-dark block truncate">
                                  {entry.userName}
                                </span>
                                {entry.userHandle && (
                                  <span className="text-[10px] font-mono text-brand-dark/50 block truncate">
                                    @{entry.userHandle}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="p-3 font-mono text-brand-dark/70">
                            {entry.userEmail}
                          </td>

                          <td className="p-3">
                            <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-900 border border-amber-500/30">
                              {entry.subscriptionTier?.toUpperCase() || 'VIP'}
                            </span>
                          </td>

                          <td className="p-3 font-mono text-brand-dark/60 text-[11px]">
                            {new Date(entry.enteredAt).toLocaleString()}
                          </td>

                          <td className="p-3">
                            {entry.isWinner ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px] uppercase shadow-2xs">
                                <Trophy size={11} /> ПОБЕДИТЕЛЬ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-[10px] uppercase border border-neutral-200">
                                Участник
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-right pr-4 space-x-1.5 whitespace-nowrap">
                            {entry.isWinner ? (
                              <button
                                onClick={() => handleToggleWinner(entry, false)}
                                className="px-2.5 py-1 rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-100 text-[10px] font-semibold uppercase cursor-pointer"
                                title="Снять статус победителя"
                              >
                                Отменить
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleWinner(entry, true)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold uppercase transition-colors cursor-pointer shadow-2xs"
                                title="Назначить победителем вручную"
                              >
                                Назначить победителем
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteEntry(entry.id, entry.userName)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                              title="Удалить заявку"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-brand-dark/[0.08]">
              <span className="text-xs text-brand-dark/50 font-mono">
                {entriesLoading && <span role="status">Загрузка… · </span>}
                {entriesCursor && <button type="button" className="underline" disabled={entriesLoading}
                  onClick={() => loadEntries(selectedEventId, entriesCursor)}>Загрузить ещё · </button>}
                {activeGroup.entries.length} заявок зарегистрировано на этот показ
              </span>
              <button
                onClick={() => setSelectedEventId(null)}
                className="px-5 py-2 rounded-full bg-brand-dark text-white text-xs font-semibold uppercase tracking-wider hover:bg-brand-accent transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
