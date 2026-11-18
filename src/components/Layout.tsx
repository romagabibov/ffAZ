import { useAnnouncements } from '../lib/useAnnouncements';
import RouteErrorBoundary from './RouteErrorBoundary';
import { useTheme } from '../context/ThemeContext';
import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { 
 Moon, Sun, Menu, X, MessageSquare, LogOut, Home, Compass, 
 Calendar, User, Sparkles, Bell
} from 'lucide-react';
import { motion } from 'motion/react';
import { collection, query, where, onSnapshot, orderBy, limit } from '../lib/firestoreClient';
import { db } from '../lib/firebase';
import { Conversation, SocialLinkItem } from '../types';
import { SocialLinksBar, DEFAULT_SOCIAL_LINKS } from './SocialLinks';
import { subscribeToUnreadNotifications } from '../lib/notificationService';
import { loadPublicSite } from '../lib/publicSite';
import { 
  initDeviceNotificationWorker, 
  showDeviceNotification 
} from '../lib/deviceNotificationService';
import { 
 playMessageReceivedSound, 
 playNotificationSound 
} from '../lib/soundEffects';
import { Toaster } from 'sonner';
import { useSiteFeatures } from '../context/SiteFeaturesContext';
const MobileMenu = lazy(() => import('./MobileMenu'));
const VisualFeatureInspector = lazy(() => import('./admin/VisualFeatureInspector'));

export default function Layout() {
 const { t, i18n } = useTranslation();
 const { currentUser, dbUser, isAdmin } = useAuth();
 const { isPathEnabled } = useSiteFeatures();
 const navigate = useNavigate();
 const location = useLocation();
 const locationPath = useRef(location.pathname);
 useEffect(() => { locationPath.current = location.pathname; }, [location.pathname]);
 const { isDark, toggleTheme } = useTheme();

 const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
 const [unreadTotal, setUnreadTotal] = useState(0);
 const [personalUnread, setUnreadNotifsCount] = useState(0);
 const announcements = useAnnouncements();
 const unreadNotifsCount = personalUnread + announcements.filter(item => !item.read).length;
 const [socialLinks, setSocialLinks] = useState<SocialLinkItem[]>(DEFAULT_SOCIAL_LINKS);
 const previousUnreadCountRef = useRef<number | null>(null);
 const previousUnreadNotifsRef = useRef<number | null>(null);
 const lastKnownMsgTimesRef = useRef<Record<string, number>>({});
 const isFirstConvLoadRef = useRef<boolean>(true);

 // Initialize service worker for native device shade notifications
 useEffect(() => {
   initDeviceNotificationWorker();
 }, []);

 // Public settings share the homepage cache.
 useEffect(() => {
 let active = true;
 void loadPublicSite().then(({ socialLinks }) => {
   if (active && socialLinks.length) setSocialLinks(socialLinks);
 });
 return () => { active = false; };
 }, []);

 // Subscribe to real-time notifications count (last 15 days)
 useEffect(() => {
 if (!currentUser) {
 setUnreadNotifsCount(0);
 previousUnreadNotifsRef.current = null;
 return;
 }

 const unsubscribe = subscribeToUnreadNotifications(
 currentUser.uid,
 Number((dbUser as any)?.notificationsReadAt||0),
 (notifs) => {
 const unread = notifs.filter(n => !n.read).length;
 if (previousUnreadNotifsRef.current !== null && unread > previousUnreadNotifsRef.current) {
 if (!locationPath.current.startsWith('/notifications')) {
 playNotificationSound();
 }
 }
 previousUnreadNotifsRef.current = unread;
 setUnreadNotifsCount(unread);
 }
 );

 return () => {
 if (typeof unsubscribe === 'function') unsubscribe();
 };
 }, [currentUser?.uid, (dbUser as any)?.notificationsReadAt]);

  useEffect(() => {
    if (!currentUser) {
      setUnreadTotal(0);
      previousUnreadCountRef.current = null;
      lastKnownMsgTimesRef.current = {};
      isFirstConvLoadRef.current = true;
      return;
    }

    const q = query(
      collection(db, 'conversations'),
      where('unreadFor','array-contains',currentUser.uid),orderBy('updatedAt','desc'),limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as Conversation;
        if (data.unreadCounts?.[currentUser.uid]) {
          count += data.unreadCounts[currentUser.uid];
        }

        // Check for new incoming message from the other participant
        if (data.lastMessage && data.lastMessage.senderId !== currentUser.uid && data.lastMessage.createdAt) {
          const prevTime = lastKnownMsgTimesRef.current[docSnap.id] || 0;
          const rawCreated = data.lastMessage.createdAt as any;
          const msgTime = typeof rawCreated === 'number'
            ? rawCreated
            : (rawCreated?.toMillis ? rawCreated.toMillis() : Date.now());

          if (!isFirstConvLoadRef.current && msgTime > prevTime) {
            // Trigger native notification in device notification shade (Android / iOS / Windows / macOS)
            const senderName = data.lastMessage.senderName || data.participantDetails?.[data.lastMessage.senderId]?.name || 'FFAZ Direct';
            const senderAvatar = data.participantDetails?.[data.lastMessage.senderId]?.avatarUrl || '';

            showDeviceNotification({
              title: `💬 ${senderName}`,
              body: data.lastMessage.text || 'Новое сообщение',
              icon: senderAvatar || '/icon.svg',
              tag: `chat_${docSnap.id}`,
              url: `/messages?user=${data.lastMessage.senderId}`
            });
          }

          lastKnownMsgTimesRef.current[docSnap.id] = msgTime;
        }
      });

      isFirstConvLoadRef.current = false;

      // Play sound if new unread message arrived and user is not inside active messages page
      if (previousUnreadCountRef.current !== null && count > previousUnreadCountRef.current) {
        if (!locationPath.current.startsWith('/messages')) {
          playMessageReceivedSound();
        }
      }
      previousUnreadCountRef.current = count;
      setUnreadTotal(count);
    }, (err) => {
      console.error('Error listening for unread messages:', err);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

 const handleLogout = async () => {
 await signOut(auth);
 setIsMobileMenuOpen(false);
 navigate('/');
 };

 const changeLanguage = (lng: string) => { void i18n.changeLanguage(lng); };

 const closeMenu = () => setIsMobileMenuOpen(false);
 useEffect(() => { setIsMobileMenuOpen(false); }, [location.key]);
 useEffect(() => {
   const desktop = window.matchMedia('(min-width: 1024px)');
   const closeOnDesktop = (event: MediaQueryListEvent) => {
     if (event.matches) setIsMobileMenuOpen(false);
   };
   desktop.addEventListener('change', closeOnDesktop);
   return () => desktop.removeEventListener('change', closeOnDesktop);
 }, []);

 const isMessagesPage = location.pathname.startsWith('/messages') || location.pathname.startsWith('/chat');
 const searchParams = new URLSearchParams(location.search);
 const isChatConversationActive = isMessagesPage && !!searchParams.get('conversationId');

 const allNavLinks = useMemo(() => [
 { path: '/', label: t('home', 'Home') },
 { path: '/events', label: t('events', 'Events') },
 { path: '/feed', label: t('nav_feed', 'Feed') },
 { path: '/messages', label: t('nav_chat', 'Chat') },
 { path: '/designers', label: t('designers', 'Designers') },
 { path: '/handmade', label: t('nav_handmade') },
 { path: '/education', label: t('nav_education', 'Education') },
 { path: '/agencies', label: t('nav_agencies', 'Agencies') },
 { path: '/opportunities', label: t('opportunities', 'Opportunities') },
 { path: '/news', label: t('nav_news', 'News') },
 ], [t]);

 const navLinks = useMemo(() => {
   return allNavLinks.filter((link) => isAdmin || isPathEnabled(link.path));
 }, [allNavLinks, isAdmin, isPathEnabled]);

 return (
 <>
 <Toaster 
 position="bottom-right" 
 theme={isDark ? 'dark' : 'light'}
 richColors 
 closeButton
 toastOptions={{
 className: 'font-mono text-xs border-2 border-brand-dark',
 }}
 />

      <div className={`flex flex-col font-sans relative bg-brand-light text-brand-dark transition-colors duration-300 w-full max-w-full ${isMessagesPage ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : 'min-h-screen overflow-x-hidden'}`}>
 <nav className="sticky top-0 z-50 bg-brand-light/85 backdrop-blur-xl border-b border-brand-dark/[0.07] px-4 sm:px-8 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 transition-colors duration-300 min-h-[68px] shrink-0 flex items-center shadow-[0_4px_24px_-8px_rgba(28,25,23,0.03)]">
 <div className="w-full max-w-[1800px] mx-auto flex items-center justify-between gap-2 lg:gap-4">
 {/* Logo */}
 <Link to="/" onClick={closeMenu} className="group text-xl sm:text-2xl 2xl:text-3xl uppercase tracking-wider text-brand-dark flex items-center gap-2.5 shrink-0">
 <span className="group-hover:text-brand-accent transition-colors font-serif tracking-[0.18em] text-2xl sm:text-3xl font-normal">AZ/FSHN</span><span className="text-[9px] font-mono tracking-[0.25em] text-brand-accent font-bold px-2 py-0.5 rounded-full bg-brand-accent/5 border border-brand-accent/20 hidden sm:inline-block">BAKU</span>
 </Link>
 
 {/* Desktop Navigation Links with Spring Layout Pill Indicator */}
 <div className="hidden lg:flex min-w-0 items-center gap-1 xl:gap-1.5 text-xs 2xl:text-sm font-medium tracking-wide overflow-x-auto no-scrollbar py-1 relative bg-brand-muted/50 p-1 rounded-full border border-brand-dark/[0.06]">
 {navLinks.map((link) => {
 const isActive = link.path === '/' 
 ? location.pathname === '/' 
 : location.pathname.startsWith(link.path);
 return (
 <Link
 key={link.path}
 to={link.path}
 className={`relative px-2.5 xl:px-3.5 py-1.5 transition-all whitespace-nowrap text-[11px] 2xl:text-xs font-medium tracking-wider rounded-full ${
                isActive 
                  ? 'text-white font-semibold' 
                  : 'text-brand-dark/70 hover:text-brand-dark hover:bg-brand-dark/[0.04]'
              }`}
 >
 {isActive && (
 <motion.div layoutId="desktop-nav-active-pill" className="absolute inset-0 bg-brand-accent rounded-full shadow-[0_2px_12px_rgba(128,29,43,0.3)] -z-10" transition={{ type: "spring", stiffness: 420, damping: 32 }} />
 )}
 <span className="relative z-10 flex items-center gap-1"><span>{link.label}</span>{isAdmin && !isPathEnabled(link.path) && <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-red-600 text-white font-bold leading-none">OFF</span>}</span>
 </Link>
 );
 })}
 </div>

 {/* Desktop Right Actions (Notifications, User, Languages, Theme) */}
 <div className="hidden lg:flex items-center gap-2 shrink-0">

 {/* Notifications button */}
 <Link 
 to={currentUser ? "/notifications" : "/login"} 
 className={`relative h-9 w-9 rounded-full border border-brand-dark/15 dark:border-brand-dark/20 transition-all flex items-center justify-center text-xs font-bold uppercase tracking-wider shrink-0 hover:scale-105 active:scale-95 shadow-xs ${
            location.pathname === '/notifications'
              ? 'bg-brand-accent text-white border-brand-accent shadow-[0_2px_10px_rgba(128,29,43,0.3)]'
              : 'bg-brand-light/90 text-brand-dark hover:bg-brand-dark hover:text-brand-light hover:border-brand-dark'
          }`}
 title={t('notifications', 'Notifications')}
 aria-label={t('notifications', 'Notifications')}
 >
 <Bell size={15} className="shrink-0" />
 {unreadNotifsCount > 0 && (
 <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black min-w-4 h-4 px-1 rounded-full border border-brand-dark flex items-center justify-center leading-none animate-pulse">
 {unreadNotifsCount >= 20 ? '20+' : unreadNotifsCount}
 </span>
 )}
 </Link>

 
 {currentUser && (
 <Link 
 to="/dashboard" 
 className={`h-9 w-9 rounded-full border border-brand-dark/15 dark:border-brand-dark/20 text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 shadow-xs ${
              location.pathname === '/dashboard'
                ? 'bg-brand-accent text-white border-brand-accent shadow-[0_2px_10px_rgba(128,29,43,0.3)]'
                : 'bg-brand-light/90 text-brand-dark hover:bg-brand-dark hover:text-brand-light hover:border-brand-dark'
            }`}
 title={t('dashboard', 'Dashboard')}
 aria-label={t('dashboard', 'Dashboard')}
 >
 <User size={15} className="shrink-0" />
 </Link>
 )}

 {(isAdmin||['news_editor','content_editor','ticket_editor'].includes(dbUser?.role||'')) && (
 <Link 
 to="/admin" 
 className={`h-9 w-9 rounded-full border border-brand-dark/15 dark:border-brand-dark/20 text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 shadow-xs ${
              location.pathname.startsWith('/admin')
                ? 'bg-brand-accent text-white border-brand-accent shadow-[0_2px_10px_rgba(128,29,43,0.3)]'
                : 'bg-brand-light/90 text-brand-dark hover:bg-brand-dark hover:text-brand-light hover:border-brand-dark'
            }`}
 title={t('admin', 'Admin')}
 aria-label={t('admin', 'Admin')}
 >
 <Sparkles size={15} className="shrink-0" />
 </Link>
 )}

 {!currentUser ? (
 <Link 
 to="/login" 
 className="h-9 px-4 rounded-full border border-brand-dark/20 bg-brand-light/90 hover:bg-brand-dark hover:text-brand-light hover:border-brand-dark text-[11px] font-medium uppercase tracking-wider text-brand-dark transition-all whitespace-nowrap flex items-center shadow-xs hover:scale-105 active:scale-95"
 >
 {t('login_email')}
 </Link>
 ) : (
 <button 
 onClick={handleLogout} 
 title={t('logout')} 
 className="h-9 w-9 rounded-full border border-brand-dark/15 bg-brand-light/90 hover:bg-brand-accent hover:border-brand-accent hover:text-white text-brand-dark transition-all flex items-center justify-center shrink-0 shadow-xs hover:scale-105 active:scale-95"
 >
 <LogOut size={15} />
 </button>
 )}
 
 {/* Segmented Language Picker */}
 <div className="h-9 flex items-stretch border border-brand-dark/15 bg-brand-light/80 backdrop-blur-xs rounded-full p-0.5 text-[11px] font-medium overflow-hidden shadow-xs">
 <button 
 onClick={() => changeLanguage('en')} 
 className={`px-2.5 rounded-full flex items-center justify-center transition-all ${
                i18n.language === 'en' ? 'bg-brand-dark text-brand-light font-semibold shadow-xs' : 'text-brand-dark/70 hover:text-brand-dark hover:bg-brand-dark/[0.04]'
              }`}
 >
 EN
 </button>
 <button onClick={() => changeLanguage('az')} className={`px-2.5 rounded-full flex items-center justify-center transition-all ${
                i18n.language === 'az' ? 'bg-brand-dark text-brand-light font-semibold shadow-xs' : 'text-brand-dark/70 hover:text-brand-dark hover:bg-brand-dark/[0.04]'
              }`}>AZ</button>
 <button onClick={() => changeLanguage('ru')} className={`px-2.5 rounded-full flex items-center justify-center transition-all ${
                i18n.language === 'ru' ? 'bg-brand-dark text-brand-light font-semibold shadow-xs' : 'text-brand-dark/70 hover:text-brand-dark hover:bg-brand-dark/[0.04]'
              }`}>RU</button>
 </div>

 {/* Theme Toggle Button */}
 <button 
 onClick={toggleTheme} 
 title={t(isDark ? 'theme_light' : 'theme_dark')} aria-label={t(isDark ? 'theme_light' : 'theme_dark')} 
 className="h-9 w-9 rounded-full border border-brand-dark/15 bg-brand-light/90 hover:bg-brand-dark hover:text-brand-light hover:border-brand-dark text-brand-dark transition-all flex items-center justify-center shrink-0 shadow-xs hover:scale-105 active:scale-95"
 >
 {isDark ? <Sun size={15} /> : <Moon size={15} />}
 </button>
 </div>

 {/* Mobile / Tablet Header Controls (below lg) */}
 <div className="lg:hidden flex items-center gap-2">
 <Link 
 to={currentUser ? "/notifications" : "/login"} 
 onClick={closeMenu}
 className={`p-2 border border-brand-dark/40 transition-colors relative flex items-center justify-center ${
 location.pathname === '/notifications'
 ? 'bg-brand-dark text-brand-light'
 : 'bg-brand-light text-brand-dark hover:bg-brand-accent hover:text-white'
 }`}
 title={t('ui_notifications')}
 >
 <Bell size={18} />
 {unreadNotifsCount > 0 && (
 <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black min-w-[17px] h-[17px] px-0.5 rounded-full border border-brand-dark flex items-center justify-center animate-pulse">
 {unreadNotifsCount >= 20 ? '20+' : unreadNotifsCount}
 </span>
 )}
 </Link>

 <button onClick={toggleTheme} className="p-2 border border-brand-dark/40 bg-brand-light text-brand-dark hover:text-brand-accent transition-colors flex items-center justify-center">
 {isDark ? <Sun size={18} /> : <Moon size={18} />}
 </button>
 </div>
 </div>
 </nav>

 {isMobileMenuOpen && (
   <Suspense fallback={null}>
     <MobileMenu navLinks={navLinks} socialLinks={socialLinks} unreadMessages={unreadTotal}
       unreadNotifications={unreadNotifsCount} onClose={closeMenu} onLogout={handleLogout} />
   </Suspense>
 )}

  <main className={`flex-1 w-full mx-auto ${isMessagesPage ? "h-[calc(100dvh-68px)] max-h-[calc(100dvh-68px)] overflow-hidden flex flex-col min-h-0" : "pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-0 overflow-x-hidden"}`}>
        <RouteErrorBoundary key={location.key}><Outlet /></RouteErrorBoundary>
      </main>

  {/* Mobile / Tablet Fixed Bottom Navigation Bar (Hidden in Messages to maximize chat height) */}
  {(!isMessagesPage && (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-light/95 backdrop-blur-2xl border-t border-brand-dark/[0.08] px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] flex items-center justify-around lg:hidden shadow-[0_-8px_30px_rgba(0,0,0,0.06)] transition-colors duration-300">
      {/* 1. Home Tab */}
      <Link 
        to="/" 
        onClick={closeMenu} 
        className={`flex flex-col items-center gap-1 p-1 min-w-[44px] min-h-11 transition-all ${
          location.pathname === '/' ? 'text-brand-accent' : 'text-brand-dark/60 hover:text-brand-dark'
        }`}
      >
        <div className={`p-1.5 rounded-full transition-all ${location.pathname === '/' ? 'bg-brand-accent text-white shadow-xs scale-105' : ''}`}>
          <Home size={18} strokeWidth={location.pathname === '/' ? 2.5 : 2} className={location.pathname === '/' ? 'text-white' : ''} />
        </div>
        <span className="text-[9px] uppercase font-semibold tracking-wider">{t('nav_home', 'Home')}</span>
      </Link>

      {/* 2. Feed Tab */}
      <Link 
        to="/feed" 
        onClick={closeMenu} 
        className={`flex flex-col items-center gap-1 p-1 min-w-[44px] min-h-11 transition-all ${
          location.pathname === '/feed' ? 'text-brand-accent' : 'text-brand-dark/60 hover:text-brand-dark'
        }`}
      >
        <div className={`p-1.5 rounded-full transition-all ${location.pathname === '/feed' ? 'bg-brand-accent text-white shadow-xs scale-105' : ''}`}>
          <Compass size={18} strokeWidth={location.pathname === '/feed' ? 2.5 : 2} className={location.pathname === '/feed' ? 'text-white' : ''} />
        </div>
        <span className="text-[9px] uppercase font-semibold tracking-wider">{t('nav_feed', 'Feed')}</span>
      </Link>

      {/* 3. Direct Chat Tab */}
      <Link 
        to={currentUser ? "/messages" : "/login"} 
        onClick={closeMenu} 
        className={`flex flex-col items-center gap-1 p-1 min-w-[44px] min-h-11 transition-all relative ${
          location.pathname === '/messages' || location.pathname === '/chat' ? 'text-brand-accent' : 'text-brand-dark/60 hover:text-brand-dark'
        }`}
      >
        <div className={`relative p-1.5 rounded-full transition-all ${location.pathname === '/messages' || location.pathname === '/chat' ? 'bg-brand-accent text-white shadow-xs scale-105' : ''}`}>
          <MessageSquare size={18} strokeWidth={location.pathname === '/messages' || location.pathname === '/chat' ? 2.5 : 2} className={location.pathname === '/messages' || location.pathname === '/chat' ? 'text-white' : ''} />
          {unreadTotal > 0 && (
            <span className="absolute -top-1 -right-1 bg-brand-accent text-white text-[9px] font-bold min-w-[16px] h-[16px] px-0.5 rounded-full border border-white flex items-center justify-center animate-pulse">
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
        </div>
        <span className="text-[9px] uppercase font-semibold tracking-wider">{t('nav_chat', 'Chat')}</span>
      </Link>

      {/* 4. Events / Runway Tab */}
      <Link 
        to="/events" 
        onClick={closeMenu} 
        className={`flex flex-col items-center gap-1 p-1 min-w-[44px] min-h-11 transition-all ${
          location.pathname === '/events' ? 'text-brand-accent' : 'text-brand-dark/60 hover:text-brand-dark'
        }`}
      >
        <div className={`p-1.5 rounded-full transition-all ${location.pathname === '/events' ? 'bg-brand-accent text-white shadow-xs scale-105' : ''}`}>
          <Calendar size={18} strokeWidth={location.pathname === '/events' ? 2.5 : 2} className={location.pathname === '/events' ? 'text-white' : ''} />
        </div>
        <span className="text-[9px] uppercase font-semibold tracking-wider">{t('nav_events', 'Events')}</span>
      </Link>

      {/* 5. More / Разделы Menu Trigger */}
      <button 
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
        className={`flex flex-col items-center gap-1 p-1 min-w-[44px] min-h-11 transition-all ${
          isMobileMenuOpen || location.pathname === '/more' || location.pathname === '/sections' ? 'text-brand-accent' : 'text-brand-dark/60 hover:text-brand-dark'
        }`}
        aria-label={t(isMobileMenuOpen ? 'ui_menu_close' : 'ui_menu_open')}
        aria-expanded={isMobileMenuOpen}
        aria-controls={isMobileMenuOpen ? 'mobile-sections-menu' : undefined}
        aria-haspopup="dialog"
      >
        <div className={`p-1.5 rounded-full transition-all ${isMobileMenuOpen || location.pathname === '/more' || location.pathname === '/sections' ? 'bg-brand-accent text-white shadow-xs scale-105' : ''}`}>
          {isMobileMenuOpen ? <X size={18} className="text-white" /> : <Menu size={18} />}
        </div>
        <span className="text-[9px] uppercase font-semibold tracking-wider">{t('ui_more')}</span>
      </button>
    </div>
  ))}

  {/* Desktop Footer (Hidden on Mobile and in Messages) */}
 <footer className={`${isMessagesPage ? 'hidden' : 'hidden lg:block'} border-t border-brand-dark/[0.07] p-12 md:p-16 text-center text-xs font-medium uppercase tracking-[0.16em] text-brand-dark/75 bg-brand-muted/40 transition-colors duration-300`}>
 {/* Social Media Network Buttons */}
 <div className="mb-8 flex flex-col items-center justify-center">
 <SocialLinksBar links={socialLinks} variant="desktop-footer" />
 </div>

 {/* Navigation Primary Links */}
 <div className="flex justify-center flex-wrap gap-6 sm:gap-8 mb-6">
 <Link to="/about" className="hover:text-brand-accent transition-colors">{t('nav_about', 'About Us')}</Link>
 <Link to="/plans" className="text-brand-accent hover:underline font-black transition-colors">{t('nav_plans', 'Plans & Subscriptions')}</Link>
 <Link to="/vacancies" className="hover:text-brand-accent transition-colors">{t('nav_vacancies', 'Vacancies')}</Link>
 <Link to="/volunteers" className="hover:text-brand-accent transition-colors">{t('nav_volunteers', 'Volunteers')}</Link>
 <Link to="/news" className="hover:text-brand-accent transition-colors">{t('nav_news', 'News')}</Link>
 <Link to="/designers" className="hover:text-brand-accent transition-colors">{t('nav_designers', 'Designers')}</Link>
 {isPathEnabled('/handmade') && <Link to="/handmade" className="hover:text-brand-accent transition-colors">{t('nav_handmade')}</Link>}
 </div>

 {/* Navigation Legal Links (Duplicate About Us removed) */}
 <div className="flex justify-center flex-wrap gap-6 mb-8 text-xs text-brand-dark/70">
 <Link to="/privacy" className="hover:text-brand-dark transition-colors border-b-2 border-transparent hover:border-brand-dark pb-1">{t('nav_privacy', 'Privacy Policy')}</Link>
 <span>/</span>
 <Link to="/terms" className="hover:text-brand-dark transition-colors border-b-2 border-transparent hover:border-brand-dark pb-1">{t('nav_terms', 'Terms of Use')}</Link>
 <span>/</span>
 <Link to="/cookies" className="hover:text-brand-dark transition-colors border-b-2 border-transparent hover:border-brand-dark pb-1">{t('nav_cookies', 'Cookies Policy')}</Link>
 </div>

 &copy; {new Date().getFullYear()} {t('ui_rights')}
 </footer>
 </div>
 {isAdmin && <Suspense fallback={null}><VisualFeatureInspector /></Suspense>}
 </>
 );
}
