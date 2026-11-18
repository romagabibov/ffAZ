import '../../locales/inspector';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useSiteFeatures, SiteFeatureConfig } from '../../context/SiteFeaturesContext';
import { 
  Sliders, 
  ToggleLeft, 
  ToggleRight, 
  Eye, 
  EyeOff, 
  ExternalLink, 
  Check, 
  X, 
  LayoutGrid, 
  ChevronRight, 
  Layers, 
  ShieldAlert, 
  Sparkles, 
  ArrowRight,
  Maximize2,
  Minimize2,
  Search,
  CheckCircle2,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function VisualFeatureInspector() {
  const { isAdmin } = useAuth();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || 'az';
  const featureName = (feature: SiteFeatureConfig) => language === 'ru' ? feature.nameRu : language === 'en' ? feature.nameEn : feature.nameAz;
  const featureDescription = (feature: SiteFeatureConfig) => language === 'ru' ? feature.descriptionRu : t('feature_description_' + feature.id, { defaultValue: '' });
  const { 
    features, 
    visualEditMode, 
    setVisualEditMode, 
    toggleFeature, 
    isPathEnabled 
  } = useSiteFeatures();
  const location = useLocation();
  const navigate = useNavigate();

  const [isExpanded, setIsExpanded] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'page' | 'feature' | 'home_section'>('all');

  // Only admins can see this
  if (!isAdmin) return null;

  // If visual mode is disabled, show a subtle floating trigger pill at bottom left
  if (!visualEditMode) {
    return (
      <div className="fixed bottom-20 lg:bottom-6 left-4 z-40">
        <button
          onClick={() => setVisualEditMode(true)}
          className="bg-brand-dark/95 hover:bg-brand-accent text-white px-3.5 py-2 rounded-full border border-white/20 shadow-xl backdrop-blur-md text-[11px] font-mono uppercase tracking-wider flex items-center gap-2 transition-all hover:scale-105 active:scale-95 group cursor-pointer"
          title={t('inspector_open')}
        >
          <Sliders size={13} className="text-brand-accent group-hover:text-white transition-colors" />
          <span>{t('inspector_title')}</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      </div>
    );
  }

  // Find the feature that corresponds to current route
  const currentPath = location.pathname;
  const currentPageFeature = Object.values(features).find(
    (f) => f.category === 'page' && f.path && (f.path === currentPath || (f.path !== '/' && currentPath.startsWith(f.path)))
  );

  const quickPages = [
    { name: t('nav_home'), path: '/' },
    { name: t('nav_events'), path: '/events' },
    { name: t('nav_feed'), path: '/feed' },
    { name: t('nav_designers'), path: '/designers' },
    { name: t('nav_education'), path: '/education' },
    { name: t('nav_agencies'), path: '/agencies' },
    { name: t('nav_vacancies'), path: '/opportunities' },
    { name: t('nav_chat'), path: '/messages' },
    { name: t('nav_news'), path: '/news' },
    { name: t('nav_about'), path: '/about' },
  ];

  // Specific sections on the Home page
  const homeSectionIds = [
    { id: 'home_hero_banner', name: t('inspector_hero') },
    { id: 'home_ticker', name: t('inspector_ticker') },
    { id: 'home_manifesto', name: t('inspector_manifesto') },
    { id: 'home_partners_strip', name: t('inspector_sponsorship') },
    { id: 'home_sponsors_marquee', name: t('inspector_logos') },
    { id: 'home_newsletter', name: t('inspector_newsletter') },
  ];

  const filteredFeatures = Object.values(features).filter((f) => {
    if (activeFilter !== 'all' && f.category !== activeFilter) return false;
    if (drawerSearch.trim()) {
      const q = drawerSearch.toLocaleLowerCase(language);
      return (
        featureName(f).toLocaleLowerCase(language).includes(q) ||
        featureDescription(f).toLocaleLowerCase(language).includes(q) ||
        (f.path && f.path.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const isAtHome = currentPath === '/';

  return (
    <>
      {/* 1. FLOATING CONTROL DOCK AT THE BOTTOM */}
      <div className="fixed bottom-16 lg:bottom-4 inset-x-3 sm:inset-x-6 z-50 pointer-events-none flex justify-center">
        <div className="pointer-events-auto max-w-4xl w-full bg-brand-dark/95 text-brand-light backdrop-blur-2xl border-2 border-brand-accent/40 rounded-3xl p-3 sm:p-4 shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex flex-col gap-3 transition-all animate-in slide-in-from-bottom duration-300">
          
          {/* Top Bar inside Dock */}
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-accent"></span>
              </span>
              <span className="text-[10px] sm:text-xs font-mono font-bold uppercase tracking-widest text-brand-accent">
                {t('inspector_mode')}
              </span>
              <span className="hidden md:inline text-white/50 font-mono text-[10px]">{t('inspector_toggle_hint')}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Layers size={13} />
                <span>{t('inspector_functions')} · {Object.values(features).filter(f => f.enabled).length}/{Object.values(features).length}</span>
                {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>

              <button
                onClick={() => navigate('/admin?tab=site_modules')}
                className="bg-brand-accent/20 hover:bg-brand-accent text-white px-3 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider flex items-center gap-1 transition-colors border border-brand-accent/40 cursor-pointer"
              >
                <span>{t('inspector_admin')}</span>
                <ExternalLink size={12} />
              </button>

              <button
                onClick={() => setVisualEditMode(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                title={t('inspector_close')}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Current Page Status & Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="text-xs font-mono text-white/70">
                {t('inspector_current')} <strong className="text-white">{currentPageFeature ? featureName(currentPageFeature) : currentPath}</strong>
              </div>

              {currentPageFeature && (
                <button
                  onClick={() => toggleFeature(currentPageFeature.id)}
                  className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm cursor-pointer active:scale-95 ${
                    currentPageFeature.enabled
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-red-600 hover:bg-red-500 text-white'
                  }`}
                >
                  {currentPageFeature.enabled ? (
                    <>
                      <Eye size={13} />
                      <span>{t('inspector_on')}</span>
                    </>
                  ) : (
                    <>
                      <EyeOff size={13} />
                      <span>{t('inspector_off')}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Quick jump to other sections */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest mr-1 shrink-0">{t('inspector_jump')}</span>
              {quickPages.map((qp) => {
                const isActive = location.pathname === qp.path;
                const feat = Object.values(features).find(f => f.path === qp.path);
                const isEnabled = feat ? feat.enabled : true;

                return (
                  <button
                    key={qp.path}
                    onClick={() => navigate(qp.path)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                      isActive
                        ? 'bg-brand-accent text-white font-bold'
                        : isEnabled
                        ? 'bg-white/10 hover:bg-white/20 text-white/90'
                        : 'bg-red-950/60 text-red-300 border border-red-800/40 line-through opacity-70'
                    }`}
                  >
                    <span>{qp.name}</span>
                    {!isEnabled && <span className="text-[9px]">{t('inspector_off')}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* If on Home screen: quick toggles for all 6 home blocks */}
          {isAtHome && (
            <div className="pt-2 border-t border-white/10 flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
              <span className="text-[10px] font-mono text-brand-accent font-bold uppercase tracking-wider shrink-0">
                {t('inspector_home_blocks')}
              </span>
              {homeSectionIds.map((hs) => {
                const feat = features[hs.id];
                const isEnabled = feat ? feat.enabled : true;

                return (
                  <button
                    key={hs.id}
                    onClick={() => toggleFeature(hs.id)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                      isEnabled
                        ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40'
                        : 'bg-red-950/80 hover:bg-red-900/80 text-red-300 border border-red-600/50 line-through'
                    }`}
                    title={isEnabled ? t('inspector_disable', { name: hs.name }) : t('inspector_enable', { name: hs.name })}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span>{hs.name}</span>
                    <span className="text-[9px] font-bold">{isEnabled ? t('inspector_on_short') : t('inspector_off_short')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. FULL EXPANDED DRAWER (POPUP OVERLAY) */}
      <AnimatePresence>
        {isExpanded && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25 }}
              className="bg-brand-light text-brand-dark rounded-3xl border-2 border-brand-dark w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              {/* Drawer Header */}
              <div className="p-5 sm:p-6 border-b border-brand-dark/10 flex items-center justify-between bg-brand-card">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-accent bg-brand-accent/5 px-2.5 py-0.5 rounded-full border border-brand-accent/20">
                      {t('inspector_manage')}
                    </span>
                    <span className="text-xs font-mono text-brand-dark/50">Live Toggle Console</span>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark mt-1">
                    {t('inspector_manage_hint')}
                  </h3>
                </div>

                <button
                  onClick={() => setIsExpanded(false)}
                  className="w-9 h-9 rounded-full border border-brand-dark/15 hover:bg-brand-dark hover:text-white flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search & Category Filter Pills */}
              <div className="px-5 sm:px-6 py-3 bg-brand-muted/30 border-b border-brand-dark/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'all', label: t('status_all') },
                    { id: 'page', label: t('inspector_pages') },
                    { id: 'home_section', label: t('inspector_home_blocks') },
                    { id: 'feature', label: t('inspector_features') },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveFilter(tab.id as any)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === tab.id
                          ? 'bg-brand-dark text-white'
                          : 'bg-brand-card border border-brand-dark/15 text-brand-dark/70 hover:text-brand-dark'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-dark/40" />
                  <input
                    type="text"
                    placeholder={t('inspector_search')}
                    value={drawerSearch}
                    onChange={(e) => setDrawerSearch(e.target.value)}
                    className="w-full bg-brand-card border border-brand-dark/15 rounded-full pl-9 pr-3 py-1 text-xs font-mono text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="p-5 sm:p-6 overflow-y-auto space-y-2.5 divide-y divide-brand-dark/5 flex-1 bg-brand-light/60">
                {filteredFeatures.map((item) => (
                  <div
                    key={item.id}
                    className="pt-2.5 first:pt-0 flex items-center justify-between gap-4 p-3 rounded-2xl bg-brand-card border border-brand-dark/[0.08] shadow-2xs hover:border-brand-accent/30 transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-brand-dark tracking-tight">
                          {featureName(item)}
                        </h4>
                        {item.path && (
                          <span className="font-mono text-[10px] text-brand-dark/40 bg-brand-dark/[0.04] px-2 py-0.5 rounded-md">
                            {item.path}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-brand-dark/60 mt-0.5 line-clamp-1">
                        {featureDescription(item)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.path && (
                        <button
                          onClick={() => {
                            setIsExpanded(false);
                            navigate(item.path!);
                          }}
                          className="px-2.5 py-1 rounded-full bg-brand-muted/50 hover:bg-brand-dark hover:text-white border border-brand-dark/10 text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                          title={t('inspector_visit')}
                        >
                          <span>{t('inspector_visit')}</span>
                          <ArrowRight size={11} />
                        </button>
                      )}

                      <button
                        onClick={() => toggleFeature(item.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95 ${
                          item.enabled
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                        }`}
                      >
                        {item.enabled ? (
                          <>
                            <Check size={13} strokeWidth={2.5} />
                            <span>{t('inspector_on_short')}</span>
                          </>
                        ) : (
                          <>
                            <X size={13} strokeWidth={2.5} />
                            <span>{t('inspector_off_short')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 sm:p-5 border-t border-brand-dark/10 bg-brand-card flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-mono text-brand-dark/60">
                  {t('inspector_apply')}
                </span>

                <button
                  onClick={() => setIsExpanded(false)}
                  className="px-5 py-2 rounded-full bg-brand-dark text-white hover:bg-brand-accent transition-colors font-mono uppercase tracking-wider text-xs font-bold cursor-pointer"
                >
                  {t('inspector_done')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
