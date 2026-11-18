import { useAnnouncements } from '../lib/useAnnouncements';
import { getTimestampMillis } from '../lib/dateUtils';
import { toast } from 'sonner';
import {SecureImage} from '../components/SecureMedia';
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bell, 
  CheckCheck, 
  Trash2, 
  MessageSquare, 
  Heart, 
  MessageCircle, 
  UserPlus, 
  Briefcase, 
  Award, 
  Sparkles, 
  Info, 
  Clock, 
  ChevronRight, 
  Check, 
  ExternalLink,
  RefreshCw,
  Building2,
  Radio,
  ShieldCheck,
  AlertCircle,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { AppNotification, NotificationType } from '../types';
import ModelAgencyInvitationCard from '../components/ModelAgencyInvitationCard';
import { 
  subscribeToUserNotifications, 
  markNotificationAsRead, 
  markAllNotificationsAsRead, 
  deleteNotification, 
  clearReadNotifications
} from '../lib/notificationService';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const { currentUser, dbUser } = useAuth();
  const ui = useUI();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<string | null>(null);
  const announcements = useAnnouncements();

  useEffect(() => {
    setNotifications([]);
    setFailure(false);
    setLoading(Boolean(currentUser));
    if (!currentUser?.uid) return;
    return subscribeToUserNotifications(currentUser.uid, items => {
      setNotifications(items);
      setLoading(false);
    }, 15, () => {
      setFailure(true);
      setLoading(false);
    });
  }, [currentUser?.uid, attempt]);

  async function change(key: string, operation: () => Promise<void>) {
    if (action) return;
    setAction(key);
    try { await operation(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t('admin_load_failed')); }
    finally { setAction(null); }
  }

  const handleMarkAsRead = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    void change(id, () => markNotificationAsRead(id));
  };
  const handleDelete = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    void change(id, () => deleteNotification(id));
  };
  const handleMarkAllAsRead = () => {
    if (currentUser) void change('all', () => markAllNotificationsAsRead(currentUser.uid));
  };
  const handleClearRead = () => {
    if (!currentUser) return;
    void change('clear', async () => {
      if (await ui.confirm(t('confirm_clear_read_notifs', 'Delete all read notifications?'))) await clearReadNotifications(currentUser.uid);
    });
  };

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.read) void change(notification.id, () => markNotificationAsRead(notification.id));
    const path = notification.link;
    if (path && path.startsWith('/') && !path.startsWith('//') && !path.includes(String.fromCharCode(92))) navigate(path);
  };

  const allNotifications = useMemo(() => [...notifications, ...announcements]
    .filter(item => item.type !== 'message')
    .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt)), [notifications, announcements]);
  const unreadCount = allNotifications.filter(notification => !notification.read).length;
  const filteredNotifications = filter === 'unread' ? allNotifications.filter(notification => !notification.read) : allNotifications;

  // Helper for notification icons and styling matching luxury editorial palette
  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'agency_broadcast':
        return <Radio size={16} className="text-brand-accent animate-pulse" />;
      case 'agency_invite':
        return <Building2 size={16} className="text-brand-accent" />;
      case 'agency_verified':
      case 'designer_verified':
        return <ShieldCheck size={16} className="text-brand-accent" />;
      case 'agency_rejected':
      case 'designer_rejected':
        return <AlertCircle size={16} className="text-red-700" />;
      case 'model_verified':
        return <Sparkles size={16} className="text-amber-600 fill-amber-500/20" />;
      case 'model_rejected':
        return <X size={16} className="text-red-700" />;
      case 'message':
      case 'chat_request':
      case 'chat_accepted':
        return <MessageSquare size={16} className="text-brand-accent" />;
      case 'like':
        return <Heart size={16} className="text-red-700 fill-red-700/20" />;
      case 'comment':
        return <MessageCircle size={16} className="text-brand-dark" />;
      case 'follow':
        return <UserPlus size={16} className="text-brand-dark" />;
      case 'job_application':
      case 'job_status':
        return <Briefcase size={16} className="text-amber-800" />;
      case 'golden_needle':
        return <Sparkles size={16} className="text-amber-600 fill-amber-500/20" />;
      case 'subscription':
        return <Award size={16} className="text-brand-accent" />;
      case 'system':
      default:
        return <Info size={16} className="text-brand-dark/70" />;
    }
  };

  const getIconBackground = (type: NotificationType) => {
    switch (type) {
      case 'agency_broadcast':
        return 'bg-brand-accent/10 border border-brand-accent/30';
      case 'agency_invite':
        return 'bg-brand-accent/10 border border-brand-accent/30';
      case 'agency_verified':
      case 'designer_verified':
        return 'bg-brand-accent/10 border border-brand-accent/30';
      case 'agency_rejected':
      case 'designer_rejected':
      case 'model_rejected':
        return 'bg-red-500/10 border border-red-500/20';
      case 'model_verified':
        return 'bg-amber-400/15 border border-amber-400/30';
      case 'message':
      case 'chat_request':
      case 'chat_accepted':
        return 'bg-brand-accent/5 border border-brand-accent/20';
      case 'like':
        return 'bg-red-500/10 border border-red-500/20';
      case 'comment':
        return 'bg-brand-muted/70 border border-brand-dark/10';
      case 'follow':
        return 'bg-brand-muted/70 border border-brand-dark/10';
      case 'job_application':
      case 'job_status':
        return 'bg-amber-500/10 border border-amber-500/20';
      case 'golden_needle':
        return 'bg-amber-400/15 border border-amber-400/30';
      case 'subscription':
        return 'bg-brand-accent/10 border border-brand-accent/20';
      case 'system':
      default:
        return 'bg-brand-muted border border-brand-dark/10';
    }
  };

  // Helper date formatting
  const formatNotificationTime = (timestamp: number) => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    if (diffMins < 1) return t('just_now', 'Just now');
    if (diffMins < 60) return `${diffMins} ${t('minutes_ago_short', 'm ago')}`;
    if (diffHours < 24) return `${diffHours} ${t('hours_ago_short', 'h ago')}`;
    if (diffDays === 1) return t('yesterday', 'Yesterday');
    if (diffDays < 15) return `${diffDays} ${t('days_ago_short', 'd ago')}`;
    
    return new Date(timestamp).toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric'
    });
  };

  const get15DaysWindowText = () => {
    const startDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${startDate.toLocaleDateString(i18n.language, options)} — ${endDate.toLocaleDateString(i18n.language, options)}`;
  };

  // If user is not logged in: editorial guest card
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-brand-light text-brand-dark pb-24">
        {/* Editorial Hero Header */}
        <section className="border-b border-brand-dark/[0.08] bg-brand-light pt-6 pb-6 sm:py-10 px-4 sm:px-8 relative overflow-hidden shrink-0">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-serif font-normal tracking-tight text-brand-dark">
              Notifications / <span className="italic text-brand-accent font-serif font-normal">{t('ui_notifications')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-brand-dark/65 mt-1.5 max-w-xl font-normal leading-relaxed">
              {t('notifications_login_desc', 'Please sign in to access your personal notifications and stay updated on messages, job alerts, and community activity.')}
            </p>
          </div>
        </section>

        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-8 sm:p-10 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-brand-accent/5 border border-brand-accent/20 flex items-center justify-center mx-auto mb-5 text-brand-accent">
              <Bell size={24} />
            </div>
            <h2 className="text-xl sm:text-2xl font-serif font-normal tracking-tight text-brand-dark mb-2">
              {t('notifications_login_required', 'Notifications Center')}
            </h2>
            <p className="text-xs sm:text-sm text-brand-dark/70 mb-6 leading-relaxed font-normal">
              {t('notifications_login_desc', 'Войдите в аккаунт, чтобы просматривать персональные оповещения, отклики и сообщения.')}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 bg-brand-dark text-white px-7 py-3 rounded-full font-semibold uppercase tracking-wider text-xs hover:bg-brand-accent transition-colors shadow-xs w-full sm:w-auto"
            >
              <span>{t('login_email', 'Sign In / Register')}</span>
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-light text-brand-dark pb-24 lg:pb-16 animate-in fade-in duration-500">
      
      {/* 1. MAGAZINE EDITORIAL HERO HEADER */}
      <section className="border-b border-brand-dark/[0.08] bg-brand-light pt-6 pb-6 sm:py-10 px-4 sm:px-8 relative overflow-hidden shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-brand-dark/15 bg-brand-card text-[10px] sm:text-[11px] font-mono font-medium tracking-wider text-brand-dark shadow-2xs">
                <Clock size={12} className="text-brand-accent" />
                <span>{t('window_15_days', 'Last 15 Days')}</span>
                <span className="text-brand-dark/40">•</span>
                <span className="text-brand-dark/60">{get15DaysWindowText()}</span>
              </div>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-serif font-normal tracking-tight text-brand-dark leading-[1.02]">
              {t('ui_notifications')}
            </h1>
            
            <p className="text-xs sm:text-sm text-brand-dark/65 mt-1.5 max-w-xl font-normal leading-relaxed">
              Синхронизация оповещений за 15 дней: кастинги, статус аккредитаций, приглашения агентств и активность сообщества.
            </p>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap pt-2 md:pt-0">
            <div className="flex gap-1" aria-label={t('ui_notifications')}>
              {(['all', 'unread'] as const).map(option => (
                <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}
                  className={`min-h-11 border border-brand-border px-3 text-xs font-semibold ${filter === option ? 'bg-brand-action text-white' : 'bg-brand-card text-brand-dark'}`}>
                  {t(option === 'all' ? 'notifications_all' : 'notifications_unread')}
                </button>
              ))}
            </div>
            {unreadCount > 0 && (
              <div className="px-3.5 py-1.5 rounded-full bg-brand-accent text-white text-xs font-mono font-bold tracking-wider flex items-center gap-1.5 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-card animate-pulse" />
                <span>{unreadCount} {t('unread', 'unread')}</span>
              </div>
            )}

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                disabled={action !== null}
                className="px-4 py-2 rounded-full border border-brand-dark/15 bg-brand-card hover:border-brand-accent hover:text-brand-accent text-brand-dark text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
              >
                <CheckCheck size={14} className="text-brand-accent" />
                <span>{t('mark_all_read', 'Mark All Read')}</span>
              </button>
            )}

            {allNotifications.some(n => n.read) && (
              <button
                onClick={handleClearRead}
                disabled={action !== null}
                title={t('clear_read', 'Clear Read')}
                className="p-2 rounded-full border border-brand-dark/15 bg-brand-card hover:border-red-500 hover:text-red-600 text-brand-dark/70 text-xs transition-all shadow-2xs cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
            )}

            
          </div>
        </div>
      </section>

      {/* 2. NOTIFICATION LIST CONTENT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6">
        {/* Model Agency Pending Invitation or Affiliation Banner */}
        {dbUser && (
          <ModelAgencyInvitationCard user={dbUser} />
        )}

        {failure && <p role="alert" className="py-3 text-sm text-brand-accent">
          {t('admin_load_failed')} <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>{t('ui_refresh')}</button>
        </p>}
        {loading ? (
          <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-16 text-center shadow-xs">
            <RefreshCw size={28} className="animate-spin text-brand-accent mx-auto mb-3" />
            <p className="font-mono uppercase tracking-wider text-xs text-brand-dark/70">
              {t('loading_notifications', 'Loading notification archive...')}
            </p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-12 sm:p-16 text-center shadow-xs max-w-2xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-brand-muted/70 border border-brand-dark/[0.08] flex items-center justify-center mx-auto mb-4 text-brand-dark/40">
              <Bell size={24} />
            </div>
            <h3 className="text-xl sm:text-2xl font-serif font-normal tracking-tight text-brand-dark mb-1.5">
              {t(filter === 'unread' ? 'notifications_read_all' : 'no_notifications_15d')}
            </h3>
            <p className="text-xs sm:text-sm text-brand-dark/60 max-w-md mx-auto mb-6 font-normal leading-relaxed">
              {t('notifications_empty_explanation', 'Новые сообщения, кастинг-заявки, статус аккредитации и системные уведомления будут отображаться здесь в режиме реального времени.')}
            </p>
            
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {filteredNotifications.map((notif) => {
                const isUnread = !notif.read;
                return (
                  <motion.div
                    key={notif.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => handleNotificationClick(notif)}
                    className={`rounded-2xl border p-4 sm:p-5 transition-all relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 group cursor-pointer ${
                      isUnread 
                        ? 'bg-brand-card border-brand-accent/30 shadow-xs hover:border-brand-accent/60 ring-1 ring-brand-accent/10' 
                        : 'bg-brand-card/80 border-brand-dark/[0.08] hover:border-brand-dark/20 hover:bg-brand-card shadow-2xs'
                    }`}
                  >
                    {/* Left: Icon / Avatar + Content */}
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      {/* Icon or Sender Avatar */}
                      <div className="relative shrink-0 mt-0.5">
                        {notif.fromUserAvatar ? (
                          <SecureImage 
                            src={notif.fromUserAvatar} 
                            alt={notif.fromUserName || 'User'} 
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-full border border-brand-dark/15 object-cover"
                          />
                        ) : (
                          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${getIconBackground(notif.type)}`}>
                            {getNotificationIcon(notif.type)}
                          </div>
                        )}
                        
                        {/* Sub-badge icon if avatar is used */}
                        {notif.fromUserAvatar && (
                          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${getIconBackground(notif.type)}`}>
                            {getNotificationIcon(notif.type)}
                          </div>
                        )}
                      </div>

                      {/* Text Body */}
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-brand-accent shrink-0 animate-pulse" />
                          )}
                          <span className="text-xs font-display font-bold uppercase tracking-wide text-brand-dark">
                            {notif.fromUserName || notif.title || 'Azerbaijan Fashion'}
                          </span>
                          <span className="text-[11px] font-mono text-brand-dark/45">
                            • {formatNotificationTime(getTimestampMillis(notif.createdAt))}
                          </span>
                        </div>

                        {notif.title && notif.fromUserName && (
                          <h4 className="text-xs sm:text-sm font-semibold text-brand-dark truncate mb-0.5">
                            {notif.title}
                          </h4>
                        )}

                        {/* Agency Broadcast category and deadline badges */}
                        {notif.type === 'agency_broadcast' && notif.metadata && (
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            {notif.metadata.category && (
                              <span className="bg-brand-action text-white text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm">
                                {notif.metadata.category === 'casting' && '🎬 КАСТИНГ'}
                                {notif.metadata.category === 'fitting' && '👗 ПРИМЕРКА'}
                                {notif.metadata.category === 'runway' && '👠 ПОКАЗ'}
                                {notif.metadata.category === 'general' && '📢 ОБЪЯВЛЕНИЕ'}
                              </span>
                            )}
                            {notif.metadata.deadline && (
                              <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-sm flex items-center gap-1">
                                <Clock size={11} /> Дедлайн: {notif.metadata.deadline}
                              </span>
                            )}
                          </div>
                        )}

                        {notif.message && (
                          <p className="text-xs text-brand-dark/70 line-clamp-3 leading-relaxed font-normal whitespace-pre-line">
                            {notif.message}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-brand-dark/[0.06] w-full sm:w-auto justify-between sm:justify-end">
                      {notif.link && (
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-dark/70 flex items-center gap-1 group-hover:text-brand-accent transition-colors">
                          <span>{t('view', 'View')}</span>
                          <ExternalLink size={12} />
                        </span>
                      )}

                      <div className="flex items-center gap-1.5">
                        {isUnread && (
                          <button
                            onClick={(e) => handleMarkAsRead(e, notif.id)}
                            title={t('mark_as_read', 'Mark as read')}
                            className="p-2 rounded-full border border-brand-dark/10 bg-brand-card hover:border-brand-accent hover:text-brand-accent text-brand-dark/70 transition-colors shadow-2xs"
                          >
                            <Check size={13} />
                          </button>
                        )}

                        <button
                          onClick={(e) => handleDelete(e, notif.id)}
                          title={t('delete', 'Delete notification')}
                          className="p-2 rounded-full border border-brand-dark/10 bg-brand-card hover:border-red-500 hover:text-red-600 text-brand-dark/60 transition-colors shadow-2xs"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
