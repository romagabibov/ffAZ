import React from 'react';
import { Link } from 'react-router';
import { useSiteFeatures } from '../context/SiteFeaturesContext';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { EyeOff, AlertTriangle, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';

interface FeatureRouteGuardProps {
  featureId: string;
  children: React.ReactNode;
}

export default function FeatureRouteGuard({
  featureId,
  children
}: FeatureRouteGuardProps) {
  const { isFeatureEnabled, toggleFeature, features } = useSiteFeatures();
  const { isAdmin } = useAuth();
  const { t, i18n } = useTranslation();
  const feature = features[featureId];
  const featureTitle = (i18n.resolvedLanguage === 'ru' ? feature?.nameRu :
    i18n.resolvedLanguage === 'en' ? feature?.nameEn : feature?.nameAz) || t('feature_unavailable_title');

  const isEnabled = isFeatureEnabled(featureId);

  // If enabled, render the normal page content
  if (isEnabled) {
    return <>{children}</>;
  }

  // If disabled but the viewer is an administrator:
  // Render the page with a sticky admin banner allowing instant re-activation!
  if (isAdmin) {
    return (
      <div className="relative">
        {/* Admin Warning Banner */}
        <div className="bg-amber-500 text-black px-4 py-2 text-xs font-mono font-semibold flex items-center justify-between gap-3 sticky top-16 sm:top-[68px] z-40 border-b border-black/20 shadow-md">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-black shrink-0" />
            <span>
              {t('feature_admin_preview', { name: featureTitle })}
            </span>
          </div>

          <button
            onClick={() => toggleFeature(featureId, true)}
            className="bg-black text-white hover:bg-neutral-800 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
          >
            <CheckCircle2 size={12} />
            <span>{t('feature_enable')}</span>
          </button>
        </div>

        {children}
      </div>
    );
  }

  // For regular visitors when the section is disabled:
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center bg-brand-light">
      <div className="max-w-md w-full bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-8 sm:p-10 shadow-xl space-y-5 animate-in zoom-in-95 duration-300">
        <div className="w-14 h-14 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center mx-auto">
          <EyeOff size={28} />
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-accent bg-brand-accent/5 px-3 py-1 rounded-full border border-brand-accent/15 inline-block">
            Azerbaijan Fashion Week
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-normal text-brand-dark tracking-tight">
            {featureTitle}
          </h2>
          <p className="text-xs sm:text-sm text-brand-dark/70 font-normal leading-relaxed">
            {t('feature_unavailable')}</p>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 w-full py-3 px-6 rounded-full bg-brand-dark text-white hover:bg-brand-accent transition-colors font-mono uppercase tracking-wider text-xs font-bold shadow-xs"
          >
            <ArrowLeft size={14} />
            <span>{t('back_to_home')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
