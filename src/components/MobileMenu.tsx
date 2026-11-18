import { useEffect, useRef, type TouchEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight, Bell, Briefcase, Building2, Calendar, Compass, Crown, GraduationCap,
  Hand, Home, Info, LogOut, MessageSquare, Moon, Newspaper, ShieldCheck, Sparkles, Sun, User, X,
} from 'lucide-react';
import { motion, useDragControls } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useSiteFeatures } from '../context/SiteFeaturesContext';
import { useTheme } from '../context/ThemeContext';
import type { SocialLinkItem } from '../types';
import { SocialLinksBar } from './SocialLinks';

const icons = {
  '/': Home,
  '/events': Calendar,
  '/feed': Compass,
  '/messages': MessageSquare,
  '/designers': Sparkles,
  '/handmade': Hand,
  '/education': GraduationCap,
  '/agencies': Building2,
  '/opportunities': Briefcase,
  '/news': Newspaper,
  '/plans': Crown,
  '/about': Info,
};
const shortcuts = new Set(['/', '/events', '/feed', '/messages']);
const languages = ['az', 'ru', 'en'] as const;
const legalLinks = [
  ['/privacy', 'nav_privacy'],
  ['/terms', 'nav_terms'],
  ['/cookies', 'nav_cookies'],
] as const;

type MenuProps = {
  navLinks: Array<{ path: string; label: string }>;
  socialLinks: SocialLinkItem[];
  unreadMessages: number;
  unreadNotifications: number;
  onClose: () => void;
  onLogout: () => void;
};

export default function MobileMenu({
  navLinks, socialLinks, unreadMessages, unreadNotifications, onClose, onLogout,
}: MenuProps) {
  const { t, i18n } = useTranslation();
  const { currentUser, dbUser, isAdmin } = useAuth();
  const { isPathEnabled } = useSiteFeatures();
  const { isDark, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const dragControls = useDragControls();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusOrigin = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (focusOrigin instanceof HTMLElement && focusOrigin.isConnected) {
        focusOrigin.focus({ preventScroll: true });
      }
    };
  }, []);

  function startContentSwipe(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    touchOrigin.current = event.touches.length === 1 && event.currentTarget.scrollTop <= 0
      ? { x: touch.clientX, y: touch.clientY }
      : null;
  }

  function endContentSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = touchOrigin.current;
    touchOrigin.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || event.currentTarget.scrollTop > 0) return;
    const distance = touch.clientY - start.y;
    if (distance >= 72 && distance > Math.abs(touch.clientX - start.x) * 1.5) onClose();
  }

  const canOpenAdmin = isAdmin || ['news_editor', 'content_editor', 'ticket_editor'].includes(dbUser?.role || '');
  const sectionLinks = [
    ...navLinks.filter(({ path }) => !shortcuts.has(path)),
    ...[
      { path: '/plans', label: t('nav_plans') },
      { path: '/about', label: t('nav_about') },
    ].filter(({ path }) => isAdmin || isPathEnabled(path === '/plans' ? '/subscriptions' : path)),
  ];

  function renderLink({ path, label }: MenuProps['navLinks'][number], compact: boolean) {
    const Icon = icons[path as keyof typeof icons];
    const selected = pathname === path || (path !== '/' && pathname.startsWith(path + '/'))
      || (path === '/events' && pathname.startsWith('/event/'))
      || (path === '/messages' && pathname === '/chat');
    const unread = path === '/messages' ? unreadMessages : 0;
    const layout = compact
      ? 'flex-col justify-center gap-1 px-1 py-2 text-center'
      : 'gap-2 px-2.5 py-2.5 sm:px-4';
    const colors = selected
      ? 'border-brand-accent/45 bg-brand-accent/10'
      : 'border-brand-dark/15 bg-brand-card hover:border-brand-accent/45';
    return (
      <Link key={path}
        to={path === '/messages' && !currentUser ? '/login' : path}
        onClick={onClose}
        aria-current={selected ? 'page' : undefined}
        className={`relative flex min-w-0 min-h-12 items-center border text-brand-dark transition-colors focus-visible:outline-2 focus-visible:outline-brand-accent ${layout} ${colors}`}
      >
        {Icon && <Icon size={17} className="shrink-0 text-brand-accent" aria-hidden />}
        <span className="min-w-0 break-words text-[11px] sm:text-xs font-semibold leading-tight">{label}</span>
        {!compact && <ArrowUpRight size={12} className="ml-auto hidden shrink-0 text-brand-dark/45 min-[370px]:block" aria-hidden />}
        {unread > 0 && <span className="absolute top-1 right-1 rounded-full bg-brand-accent text-white px-1 text-[10px]">{unread > 99 ? '99+' : unread}</span>}
      </Link>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      id="mobile-sections-menu"
      aria-labelledby="mobile-menu-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        if (event.clientY < event.currentTarget.getBoundingClientRect().top) onClose();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none max-h-none overflow-visible border-0 bg-transparent p-0 text-brand-dark backdrop:bg-black/60 lg:hidden"
    >
      <motion.div
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.82 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.y >= 64 || (info.offset.y >= 30 && info.velocity.y > 500)) onClose();
        }}
        className="flex max-h-[calc(100dvh-1.25rem-env(safe-area-inset-top,0px))] flex-col overflow-hidden rounded-t-[24px] border-t border-brand-dark/15 bg-brand-light shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-200"
      >
        <header
          className="shrink-0 touch-none select-none cursor-grab border-b border-brand-dark/10 px-4 pt-2 pb-1 sm:px-7"
          onPointerDown={event => {
            if (event.target instanceof Element && !event.target.closest('button')) dragControls.start(event);
          }}
        >
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-brand-dark/35" />
          <div className="mt-1 mx-auto flex max-w-3xl items-center justify-between gap-3">
            <h2 id="mobile-menu-title" className="font-serif text-2xl leading-none">{t('ui_more')}</h2>
            <button type="button" onClick={onClose} aria-label={t('ui_menu_close')}
              className="flex min-h-11 min-w-11 items-center justify-center text-brand-dark hover:text-brand-accent focus-visible:outline-2 focus-visible:outline-brand-accent">
              <X size={20} aria-hidden />
            </button>
          </div>
        </header>
        <div
          onTouchStart={startContentSwipe}
          onTouchEnd={endContentSwipe}
          onTouchCancel={() => { touchOrigin.current = null; }}
          className="min-h-0 overflow-y-auto overscroll-y-contain px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-7"
        >
          <div className="mx-auto grid max-w-3xl gap-3">
            <nav aria-label={t('ui_more')} className="space-y-3">
              <div className="grid grid-cols-4 gap-1.5">
                {navLinks.filter(({ path }) => shortcuts.has(path)).map(link => renderLink(link, true))}
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {sectionLinks.map(link => renderLink(link, false))}
              </div>
            </nav>

            <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-y border-brand-dark/10 py-0.5 text-xs font-semibold">
              <Link to={currentUser ? '/dashboard' : '/login'} onClick={onClose} className="flex min-h-11 min-w-0 items-center gap-2 hover:text-brand-accent">
                <User size={16} className="shrink-0 text-brand-accent" aria-hidden />
                {currentUser ? t('dashboard') : t('login_email')}
              </Link>
              {currentUser && (
                <Link to="/notifications" onClick={onClose} className="flex min-h-11 items-center gap-2 hover:text-brand-accent">
                  <Bell size={16} className="shrink-0 text-brand-accent" aria-hidden />
                  {t('ui_notifications')}
                  {unreadNotifications > 0 && <span className="rounded-full bg-brand-accent px-1.5 text-[10px] text-white">{unreadNotifications > 20 ? '20+' : unreadNotifications}</span>}
                </Link>
              )}
              {canOpenAdmin && (
                <Link to="/admin" onClick={onClose} className="flex min-h-11 items-center gap-2 hover:text-brand-accent">
                  <ShieldCheck size={16} className="shrink-0 text-brand-accent" aria-hidden />
                  {t('admin')}
                </Link>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs font-semibold">
              <div className="flex gap-0.5" role="group" aria-label={t('menu_language')}>
                {languages.map(language => (
                  <button key={language} type="button" onClick={() => { void i18n.changeLanguage(language); }}
                    aria-pressed={(i18n.resolvedLanguage || i18n.language).split('-')[0] === language}
                    className="min-h-11 min-w-11 rounded-full font-mono aria-pressed:bg-brand-muted aria-pressed:text-brand-accent hover:text-brand-accent focus-visible:outline-brand-accent">
                    {language.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={toggleTheme} title={t(isDark ? 'theme_light' : 'theme_dark')} aria-label={t(isDark ? 'theme_light' : 'theme_dark')}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-brand-dark/15 hover:text-brand-accent">
                  {isDark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
                </button>
                {currentUser && (
                  <button type="button" onClick={onLogout} title={t('logout')} aria-label={t('logout')}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-brand-dark/15 hover:text-brand-accent">
                    <LogOut size={17} aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-x-4">
              <div className="flex flex-wrap gap-x-3">
                {legalLinks.map(([path, key]) => (
                  <Link key={path} to={path} onClick={onClose} className="inline-flex min-h-11 items-center text-[11px] text-brand-dark/70 hover:text-brand-accent">
                    {t(key)}
                  </Link>
                ))}
              </div>
              <SocialLinksBar links={socialLinks} variant="mobile-drawer" />
            </footer>
          </div>
        </div>
      </motion.div>
    </dialog>
  );
}
