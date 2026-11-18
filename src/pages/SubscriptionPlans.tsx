import '../locales/plans';
import { openPayment } from '../lib/paymentRedirect';
import { readApiJson } from '../lib/apiClient';
import { subscriptionPrice, type PaidPlan, type SubscriptionCheckoutState } from '../lib/subscriptionPricing';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp, addDoc, collection } from '../lib/firestoreClient';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/apiClient';
import { useNavigate, Link, useSearchParams } from 'react-router';
import { 
  Check, X, Sparkles, Award, ShieldCheck, Zap, Briefcase, 
  HelpCircle, ChevronDown, ChevronUp, Lock, Send, MessageSquare, 
  Eye, Star, Crown, Flame, ArrowRight, ExternalLink, CheckCircle2,
  Building2, Users, ArrowUpRight, CreditCard, Shield, AlertCircle,
  Clock, CheckCircle, RefreshCw, Smartphone, Plus
} from 'lucide-react';
import GoldenNeedleBadge from '../components/GoldenNeedleBadge';
import SilverNeedleBadge from '../components/SilverNeedleBadge';
import { useUI } from '../context/UIContext';
import { isSubscriptionActive } from '../lib/communityLimits';

export default function SubscriptionPlans() {
  const ui = useUI();
  const { dbUser, currentUser } = useAuth();
  const { t, i18n } = useTranslation();
  const [search] = useSearchParams();
  const monthlyEquivalent = (total: number) => new Intl.NumberFormat(i18n.resolvedLanguage || 'az', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total / 12);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showNeedleModal, setShowNeedleModal] = useState(false);
  const [needleBrandName, setNeedleBrandName] = useState('');
  const [needlePortfolioLink, setNeedlePortfolioLink] = useState('');
  const navigate = useNavigate();

  // Downgrade confirmation modal
  const [showDowngradeModal, setShowDowngradeModal] = useState(false);

  const isSubActive = isSubscriptionActive(dbUser);
  const currentTier = isSubActive 
    ? (dbUser?.subscriptionTier === 'creator' ? 'pro' : (dbUser?.subscriptionTier || 'free'))
    : 'free';

  const [paymentState, setPaymentState] = useState<SubscriptionCheckoutState | null>(null);
  const [paymentError, setPaymentError] = useState('');

  async function checkPayment(signal?: AbortSignal) {
    setLoading(true);
    setPaymentError('');
    try {
      const state = await readApiJson<SubscriptionCheckoutState>('/api/subscriptions/check-payment', { method: 'POST', body: '{}', signal });
      if (!signal?.aborted) setPaymentState(state);
    } catch (error) {
      if (!signal?.aborted) setPaymentError(error instanceof Error ? error.message : t('admin_load_failed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  const returning = search.get('checkout') === '1';
  useEffect(() => {
    if (!returning || !currentUser?.uid) return;
    const controller = new AbortController();
    void checkPayment(controller.signal);
    return () => controller.abort();
  }, [returning, currentUser?.uid]);

  const handleInitiateTierChange = async (tier: 'free' | PaidPlan) => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (tier === 'free') {
      if (currentTier === 'pro' || currentTier === 'elite') setShowDowngradeModal(true);
      return;
    }
    setLoading(true);
    setPaymentError('');
    try {
      const state = await readApiJson<SubscriptionCheckoutState>('/api/subscriptions/purchase', {
        method: 'POST', body: JSON.stringify({ planId: tier, billingCycle: tier === 'job_one_time' ? 'monthly' : billingCycle, language: i18n.language.slice(0, 2).toUpperCase() }),
      });
      setPaymentState(state);
      if (state.status === 'pending') openPayment(state);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('admin_load_failed');
      setPaymentError(message);
      void ui.alert(message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDowngrade = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/subscriptions/purchase', {
        method: 'POST',
        body: JSON.stringify({
          planId: 'free',
          billingCycle: 'monthly',
          amount: 0
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t('plans_change_error'));
      }
      setShowDowngradeModal(false);
      ui.alert(t('plans_downgraded'));
    } catch (err: any) {
      console.error(err);
      ui.alert(err instanceof Error ? err.message : t('plans_change_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleApplySilverNeedle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (!needlePortfolioLink.trim()) {
      ui.alert(t('plans_portfolio_required'));
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'needleApplications'), {
        userId: currentUser.uid,
        userName: dbUser?.name || currentUser.displayName || 'Anonymous',
        userEmail: currentUser.email,
        type: 'silver',
        brandName: needleBrandName.trim() || dbUser?.name,
        portfolioUrl: needlePortfolioLink.trim(),
        status: 'pending',
        fee: 40,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'users', currentUser.uid), {
        silverNeedleStatus: 'pending'
      });

      setShowNeedleModal(false);
      ui.alert(t('plans_needle_submitted'));
    } catch (err: any) {
      console.error(err);
      ui.alert(err instanceof Error ? err.message : t('plans_needle_error'));
    } finally {
      setLoading(false);
    }
  };

  const faqItems = [
    {
      q: t('plans_payment_question'),
      a: t('plans_pay_answer')
    },
    {
      q: t('plans_one_time_question'),
      a: t('plans_one_time_answer')
    },
    {
      q: t('plans_chat_question'),
      a: t('plans_chat_answer')
    },
    {
      q: t('plans_jobs_question'),
      a: t('plans_jobs_answer')
    },
    {
      q: t('plans_difference_question'),
      a: t('plans_difference_answer', {
        proMonth: subscriptionPrice('pro', 'monthly'), proYear: subscriptionPrice('pro', 'yearly'),
        eliteMonth: subscriptionPrice('elite', 'monthly'), eliteYear: subscriptionPrice('elite', 'yearly'),
      })
    },
    {
      q: t('plans_giveaway_question'),
      a: t('plans_giveaway_answer')
    },
    {
      q: t('plans_needle_question'),
      a: t('plans_needle_answer')
    },
    {
      q: t('plans_change_question'),
      a: t('plans_change_answer')
    }
  ];

  return (
    <div className="bg-brand-light min-h-screen text-brand-dark pb-24 lg:pb-20">
      {(returning || paymentState) && (
        <section className="mx-auto my-4 max-w-5xl space-y-3 border border-brand-border bg-brand-card p-4 text-brand-dark">
          {paymentError && <p role="alert">{paymentError}</p>}
          {paymentState?.status === 'applied' ? (
            <p>{paymentState.plan === 'job_one_time' ? t('plans_slot_paid') : t('plans_paid')}
              {paymentState.plan === 'job_one_time' && <Link className="ml-2 underline" to="/careers?post=true">{t('plans_write_listing')}</Link>}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p>{paymentState?.status === 'expired' ? t('ticket_checkout_expired') : t('ticket_checkout_confirming')}</p>
              {paymentState?.status === 'pending' && (paymentState.paymentUrl || paymentState.paymentForm) && <button type="button" onClick={() => openPayment(paymentState)} className="brand-button min-h-11">{t('ticket_checkout_pay')}</button>}
              <button type="button" onClick={() => checkPayment()} disabled={loading} className="brand-button-outline min-h-11">{t('ticket_checkout_check')}</button>
            </div>
          )}
        </section>
      )}
      
      {/* 1. EDITORIAL HERO HEADER */}
      <section className="border-b border-brand-dark/[0.08] bg-brand-light pt-6 pb-6 sm:py-10 px-4 sm:px-8 relative overflow-hidden shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
              <span className="text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-brand-accent px-3 py-0.5 rounded-full bg-brand-accent/5 border border-brand-accent/15 font-mono">
                {t('plans_member_label')}
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-serif font-normal tracking-tight text-brand-dark leading-[1.05]">
              {t('plans_title')}
            </h1>
            <p className="text-xs sm:text-sm text-brand-dark/70 font-normal max-w-2xl mt-2 leading-relaxed">
              {t('plans_intro')}
            </p>
          </div>

          {/* Billing Switcher (Pill Style) */}
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <div className="inline-flex bg-brand-card p-1 rounded-full border border-brand-dark/[0.1] shadow-2xs">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-4 py-2 rounded-full font-semibold uppercase tracking-wider text-xs transition-all cursor-pointer ${
                  billingCycle === 'monthly'
                    ? 'bg-brand-dark text-white shadow-2xs'
                    : 'text-brand-dark/70 hover:text-brand-dark'
                }`}
              >
                {t('plans_monthly')}
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('yearly')}
                className={`px-4 py-2 rounded-full font-semibold uppercase tracking-wider text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                  billingCycle === 'yearly'
                    ? 'bg-brand-accent text-white shadow-2xs'
                    : 'text-brand-dark/70 hover:text-brand-dark'
                }`}
              >
                <span>{t('plans_yearly')}</span>
                <span className="bg-brand-card text-brand-dark text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full uppercase">
                  -20%
                </span>
              </button>
            </div>
            <span className="text-[11px] font-mono text-brand-dark/50">
              {billingCycle === 'yearly' ? t('plans_free_month') : t('plans_cancel_anytime')}
            </span>
          </div>
        </div>
      </section>

      {/* 2. THREE PRICING CARDS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 items-stretch">
          
          {/* TIER 1: FREE */}
          <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-5 sm:p-8 flex flex-col justify-between shadow-xs hover:border-brand-dark/20 hover:shadow-md transition-all">
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark/50">
                  {t('plans_basic')}
                </span>
                <span className="px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-muted text-brand-dark/80">
                  FREE
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mb-1">
                FFAZ Free
              </h2>
              <p className="text-xs text-brand-dark/65 mb-6 leading-relaxed">
                {t('plans_free_for')}
              </p>

              {/* Price */}
              <div className="mb-6 pb-6 border-b border-brand-dark/[0.08]">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl sm:text-5xl font-display font-bold text-brand-dark">0</span>
                  <span className="text-lg font-bold font-mono text-brand-dark/80">AZN</span>
                </div>
                <p className="text-xs text-brand-dark/50 mt-1">{t('plans_basic_access')}</p>
              </div>

              {/* Features */}
              <ul className="space-y-3 text-xs text-brand-dark/80 mb-8">
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_browse_content')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_free_requests')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_unlimited_after_accept')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_message_tools')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_browse_jobs_hidden')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_live_free')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_catalogue')}</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button 
                disabled={loading || currentTier === 'free' || currentTier === 'guest'} 
                onClick={() => handleInitiateTierChange('free')}
                className="w-full py-3 px-4 rounded-full font-semibold uppercase tracking-wider text-xs border border-brand-dark/20 text-brand-dark hover:bg-brand-dark hover:text-white transition-all disabled:opacity-40 cursor-pointer shadow-2xs"
              >
                {currentTier === 'free' || currentTier === 'guest' ? t('plans_current') : t('plans_switch_free')}
              </button>
            </div>
          </div>

          {/* TIER 2: PRO */}
          <div className="rounded-3xl border-2 border-brand-accent bg-brand-card p-5 sm:p-8 flex flex-col justify-between shadow-lg relative ring-4 ring-brand-accent/5">
            {/* Badge */}
            <div className="absolute -top-3.5 right-6 bg-brand-accent text-white px-3.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider shadow-sm flex items-center gap-1.5">
              <Sparkles size={12} />
              <span>{t('plans_popular')}</span>
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-accent/10 text-brand-accent">
                  PRO
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mb-1">
                FFAZ Pro
              </h2>
              <p className="text-xs text-brand-accent font-medium mb-6 leading-relaxed">
                {t('plans_pro_for')}
              </p>

              {/* Price */}
              <div className="mb-6 pb-6 border-b border-brand-dark/[0.08]">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl sm:text-5xl font-display font-bold text-brand-accent">
                    {billingCycle === 'yearly' ? monthlyEquivalent(subscriptionPrice('pro', billingCycle)) : subscriptionPrice('pro', billingCycle)}
                  </span>
                  <span className="text-lg font-bold font-mono text-brand-dark">AZN</span>
                  <span className="text-xs text-brand-dark/60 font-medium">{t('plans_each_month')}</span>
                </div>
                <p className="text-xs text-brand-dark/50 mt-1">
                  {billingCycle === 'yearly' ? t('plans_paid_year', { amount: subscriptionPrice('pro', 'yearly') }) : t('plans_paid_month')}
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-3 text-xs text-brand-dark/85 mb-8">
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_chat')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_priority')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_tools')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_direct_apply')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_boost')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_live_pro')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_badge')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-brand-accent shrink-0 mt-0.5" />
                  <span>{t('plans_pro_listings')}</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button 
                disabled={loading || currentTier === 'pro'} 
                onClick={() => handleInitiateTierChange('pro')}
                className="w-full py-3 px-4 rounded-full font-semibold uppercase tracking-wider text-xs bg-brand-accent text-white hover:bg-brand-dark transition-all disabled:opacity-40 cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <CreditCard size={14} />
                <span>{currentTier === 'pro' ? t('plans_current') : t('plans_buy_pro')}</span>
              </button>
            </div>
          </div>

          {/* TIER 3: ELITE VIP */}
          <div className="rounded-3xl border border-stone-800 bg-stone-900 text-white p-5 sm:p-8 flex flex-col justify-between shadow-xl relative">
            {/* Top Amber Ribbon */}
            <div className="absolute -top-3.5 right-6 bg-amber-400 text-stone-950 px-3.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5">
              <Crown size={12} />
              <span>{t('plans_top')}</span>
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-300/30">
                  ELITE VIP
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white mb-1">
                FFAZ Elite VIP
              </h2>
              <p className="text-xs text-white/60 mb-6 leading-relaxed">
                {t('plans_elite_for')}
              </p>

              {/* Price */}
              <div className="mb-6 pb-6 border-b border-white/10">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl sm:text-5xl font-display font-bold text-amber-300">
                    {billingCycle === 'yearly' ? monthlyEquivalent(subscriptionPrice('elite', billingCycle)) : subscriptionPrice('elite', billingCycle)}
                  </span>
                  <span className="text-lg font-bold font-mono text-white">AZN</span>
                  <span className="text-xs text-white/60 font-medium">{t('plans_each_month')}</span>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {billingCycle === 'yearly' ? t('plans_paid_year', { amount: subscriptionPrice('elite', 'yearly') }) : t('plans_paid_month')}
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-3 text-xs text-white/90 mb-8">
                <li className="flex items-start gap-2.5 bg-white/5 p-2.5 rounded-2xl border border-white/10">
                  <Star size={16} className="text-amber-400 shrink-0 mt-0.5 fill-amber-400" />
                  <span className="font-semibold text-amber-200">
                    {t('plans_vip_giveaway')}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_vip_chat')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_designer_review')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_elite_castings')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_lounge')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_live_elite')}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{t('plans_needle_priority')}</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <button 
                disabled={loading || currentTier === 'elite'} 
                onClick={() => handleInitiateTierChange('elite')}
                className="w-full py-3 px-4 rounded-full font-semibold uppercase tracking-wider text-xs bg-brand-card text-stone-950 hover:bg-amber-400 transition-all disabled:opacity-40 cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <Crown size={14} />
                <span>{currentTier === 'elite' ? t('plans_current') : t('plans_buy_elite')}</span>
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* 2.5 SINGLE JOB POSTING SECTION (7 AZN / 7 МАНАТ) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 mb-16">
        <div className="rounded-3xl border border-brand-accent/30 bg-gradient-to-br from-brand-card via-white to-brand-accent/5 p-7 sm:p-10 shadow-sm relative overflow-hidden">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8 relative z-10">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-accent/20 bg-brand-accent/10 px-3.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-brand-accent mb-3">
                <Briefcase size={13} />
                <span>{t('plans_one_time')}</span>
              </div>
              
              <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mb-2">
                {t('plans_one_time_title', { amount: subscriptionPrice('job_one_time', 'monthly') })}
              </h3>
              
              <p className="text-xs sm:text-sm text-brand-dark/75 leading-relaxed font-normal">
                {t('plans_one_time_intro')}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-5 text-xs text-brand-dark/85 font-medium">
                <div className="flex items-center gap-2">
                  <Check size={15} className="text-brand-accent shrink-0" />
                  <span>{t('plans_listing_duration')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={15} className="text-brand-accent shrink-0" />
                  <span>{t('plans_listing_applicants')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={15} className="text-brand-accent shrink-0" />
                  <span>{t('plans_listing_questions')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check size={15} className="text-brand-accent shrink-0" />
                  <span>{t('plans_listing_ready')}</span>
                </div>
              </div>
            </div>

            <div className="bg-brand-card rounded-2xl border border-brand-dark/[0.1] p-6 sm:p-7 text-center shadow-xs lg:w-72 shrink-0 w-full flex flex-col items-center justify-between">
              <div className="mb-4">
                <span className="text-[10px] font-mono uppercase tracking-wider text-brand-dark/50 font-bold block">
                  {t('plans_one_time_payment')}
                </span>
                <div className="flex items-baseline justify-center gap-1 mt-1">
                  <span className="text-4xl font-display font-bold text-brand-accent">7</span>
                  <span className="text-lg font-bold font-mono text-brand-dark">AZN</span>
                  <span className="text-xs text-brand-dark/50">{t('plans_per_post')}</span>
                </div>
                <span className="text-[11px] text-brand-dark/60 font-mono block mt-1">
                  {t('plans_one_listing')}
                </span>
                {Number(dbUser?.singleJobCredits || 0) > 0 && (
                  <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-bold">
                    {t('plans_credits_available')} {dbUser?.singleJobCredits}
                  </span>
                )}
              </div>

              <div className="w-full flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleInitiateTierChange('job_one_time')}
                  className="w-full py-3.5 px-6 rounded-full bg-brand-accent hover:bg-brand-dark text-white font-semibold uppercase tracking-wider text-xs transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2"
                >
                  <CreditCard size={14} />
                  <span>{t('plans_pay_listing')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/careers?post=true')}
                  className="w-full py-2.5 px-6 rounded-full border border-brand-dark/20 text-brand-dark hover:bg-brand-muted/40 font-semibold uppercase tracking-wider text-[11px] transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>{t('plans_write_listing')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. FEATURE MATRIX / COMPARISON TABLE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 mb-16">
        <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card overflow-hidden shadow-xs">
          
          <div className="p-6 sm:p-8 border-b border-brand-dark/[0.08] bg-brand-muted/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-serif font-bold text-brand-dark mt-1.5">
                {t('plans_compare')}
              </h2>
            </div>
          </div>

          <div className="overflow-x-auto no-scrollbar scroll-smooth">
            <div className="sm:hidden flex items-center justify-between text-[10px] font-mono text-brand-dark/50 px-4 py-2 bg-brand-muted/40 border-b border-brand-dark/[0.06]">
              <span>{t('plans_scroll_compare')}</span>
              <span className="text-brand-accent font-bold">{t('plans_three')}</span>
            </div>
            <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[620px] sm:min-w-[680px]">
              <thead>
                <tr className="border-b border-brand-dark/[0.08] bg-brand-dark text-white uppercase tracking-wider text-[11px] font-mono">
                  <th className="p-4">{t('plans_features')}</th>
                  <th className="p-4 text-center w-36">Free (0 AZN)</th>
                  <th className="p-4 text-center w-44 bg-brand-accent text-white">Pro ({billingCycle === 'yearly' ? monthlyEquivalent(subscriptionPrice('pro', billingCycle)) : subscriptionPrice('pro', billingCycle)} AZN)</th>
                  <th className="p-4 text-center w-48 bg-stone-900 text-amber-300">Elite VIP ({billingCycle === 'yearly' ? monthlyEquivalent(subscriptionPrice('elite', billingCycle)) : subscriptionPrice('elite', billingCycle)} AZN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-dark/[0.06] text-brand-dark">
                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_browse_content')}</td>
                  <td className="p-4 text-center"><Check className="mx-auto text-brand-dark/70" size={17} /></td>
                  <td className="p-4 text-center bg-brand-accent/5"><Check className="mx-auto text-brand-accent" size={17} /></td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_browse_jobs')}</td>
                  <td className="p-4 text-center text-xs text-brand-dark/60">{t('plans_contacts_hidden')}</td>
                  <td className="p-4 text-center bg-brand-accent/5 font-semibold text-brand-accent text-xs">{t('plans_contacts_visible')}</td>
                  <td className="p-4 text-center bg-stone-50 font-semibold text-brand-dark text-xs">{t('plans_contacts_visible')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_application_portfolio')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5"><Check className="mx-auto text-brand-accent" size={17} /></td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_reach')}</td>
                  <td className="p-4 text-center text-xs text-brand-dark/50">{t('plans_normal_reach')}</td>
                  <td className="p-4 text-center bg-brand-accent/5 font-mono text-xs font-semibold text-brand-accent">{t('plans_boost')}</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-bold text-brand-dark">{t('plans_top_priority')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_live_messages')}</td>
                  <td className="p-4 text-center text-xs text-brand-dark/70 font-mono">{t('plans_daily_one')}</td>
                  <td className="p-4 text-center bg-brand-accent/5 text-xs font-mono font-semibold text-brand-accent">{t('plans_daily_five')}</td>
                  <td className="p-4 text-center bg-stone-50 text-xs font-mono font-bold text-brand-dark">{t('plans_daily_ten')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_badge')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5 font-mono text-xs font-bold text-brand-accent">PRO</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-bold text-amber-600">ELITE VIP</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">
                    <div>{t('plans_direct_messages')}</div>
                    <div className="text-[11px] text-brand-dark/50 font-normal">{t('plans_request_members')}</div>
                  </td>
                  <td className="p-4 text-center text-xs font-mono text-brand-dark/80">{t('plans_five_requests')}</td>
                  <td className="p-4 text-center bg-brand-accent/5 font-mono text-xs font-semibold text-brand-accent">{t('plans_unlimited_pro')}</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-bold text-brand-dark">{t('plans_unlimited_vip')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">
                    <div>{t('plans_chat_features')}</div>
                    <div className="text-[11px] text-brand-dark/50 font-normal">{t('plans_chat_media')}</div>
                  </td>
                  <td className="p-4 text-center"><Check className="mx-auto text-brand-dark/70" size={17} /></td>
                  <td className="p-4 text-center bg-brand-accent/5"><Check className="mx-auto text-brand-accent" size={17} /></td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">
                    <div>{t('plans_manage_messages')}</div>
                    <div className="text-[11px] text-brand-dark/50 font-normal">{t('plans_delete_messages')}</div>
                  </td>
                  <td className="p-4 text-center"><Check className="mx-auto text-brand-dark/70" size={17} /></td>
                  <td className="p-4 text-center bg-brand-accent/5"><Check className="mx-auto text-brand-accent" size={17} /></td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">
                    <div>{t('plans_chat_privacy')}</div>
                    <div className="text-[11px] text-brand-dark/50 font-normal">{t('plans_clear_history')}</div>
                  </td>
                  <td className="p-4 text-center"><Check className="mx-auto text-brand-dark/70" size={17} /></td>
                  <td className="p-4 text-center bg-brand-accent/5"><Check className="mx-auto text-brand-accent" size={17} /></td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_brand_listings')}</td>
                  <td className="p-4 text-center font-mono text-xs text-brand-accent font-semibold">{t('plans_per_listing')}</td>
                  <td className="p-4 text-center bg-brand-accent/5 font-mono text-xs font-semibold text-brand-accent">{t('plans_pro_listings')}</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-bold text-brand-dark">{t('plans_elite_listings')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_designer_registry')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5 text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-semibold text-brand-accent">{t('plans_review_required')}</td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_lounge')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5 text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-stone-50"><Check className="mx-auto text-brand-dark" size={17} /></td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_vip_giveaway')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5 text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-bold text-amber-700 flex items-center justify-center gap-1.5 py-4">
                    <Crown size={15} /> {t('plans_included')}
                  </td>
                </tr>

                <tr className="hover:bg-brand-muted/20 transition-colors">
                  <td className="p-4 font-medium">{t('plans_needle_priority')}</td>
                  <td className="p-4 text-center text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-brand-accent/5 text-brand-dark/30">—</td>
                  <td className="p-4 text-center bg-stone-50 font-mono text-xs font-semibold text-amber-600">{t('plans_priority')}</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </section>

      {/* 4. SILVER NEEDLE CERTIFICATION AUDIT CARD */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 mb-16">
        <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-7 sm:p-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-xs">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-dark/[0.08] bg-brand-light px-3 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider text-brand-dark mb-3">
              <SilverNeedleBadge size="xs" />
              <span>{t('plans_silver_label')}</span>
            </div>
            
            <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mb-2">
              {t('plans_silver_heading')}
            </h3>
            
            <p className="text-xs sm:text-sm text-brand-dark/70 leading-relaxed">
              {t('plans_silver_about')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowNeedleModal(true)}
            className="w-full md:w-auto px-7 py-3.5 bg-brand-dark text-white hover:bg-brand-accent rounded-full font-semibold uppercase tracking-wider text-xs transition-colors shrink-0 cursor-pointer shadow-2xs"
          >
            {t('plans_needle_apply')}
          </button>
        </div>
      </section>

      {/* 5. FAQ SECTION */}
      <section className="max-w-4xl mx-auto px-4 sm:px-8 mb-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mt-2">
            {t('plans_faq')}
          </h2>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={idx} className="rounded-2xl border border-brand-dark/[0.08] bg-brand-card overflow-hidden shadow-2xs">
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full p-5 sm:p-6 text-left font-display font-semibold text-sm sm:text-base text-brand-dark flex justify-between items-center gap-4 cursor-pointer hover:bg-brand-muted/20 transition-colors"
                >
                  <span>{item.q}</span>
                  <div className="w-8 h-8 rounded-full border border-brand-dark/10 flex items-center justify-center shrink-0 bg-brand-light">
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>
                {isOpen && (
                  <div className="p-5 sm:p-6 pt-0 text-xs sm:text-sm text-brand-dark/75 leading-relaxed border-t border-brand-dark/[0.05]">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 6. PAYMENT CHECKOUT MODAL */}
      {showDowngradeModal && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-brand-card rounded-3xl border border-brand-dark/[0.12] p-6 sm:p-8 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 mx-auto mb-4">
              <AlertCircle size={24} />
            </div>

            <h3 className="text-xl font-serif font-bold text-brand-dark text-center mb-2">
              {t('plans_switch_heading')}
            </h3>

            <p className="text-xs text-brand-dark/75 text-center leading-relaxed mb-6 font-normal">
              {t('plans_switch_details')}
            </p>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => setShowDowngradeModal(false)}
                className="flex-1 py-2.5 rounded-full border border-brand-dark/20 text-xs font-semibold uppercase tracking-wider text-brand-dark hover:bg-brand-muted transition-colors cursor-pointer"
              >
                {t('plans_keep')}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirmDowngrade}
                className="flex-1 py-2.5 rounded-full bg-brand-dark hover:bg-red-700 text-white text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
              >
                {loading ? t('plans_switching') : t('plans_confirm_switch')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. SILVER NEEDLE APPLICATION MODAL */}
      {showNeedleModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <form 
            onSubmit={handleApplySilverNeedle} 
            className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-6 sm:p-8 max-w-lg w-full shadow-2xl relative animate-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-brand-dark/[0.08]">
              <div className="flex items-center gap-2.5">
                <SilverNeedleBadge size="md" />
                <div>
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-accent block">
                    {t('plans_review_label')}
                  </span>
                  <h3 className="text-xl sm:text-2xl font-serif font-bold text-brand-dark">
                    {t('plans_silver_application')}
                  </h3>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowNeedleModal(false)} 
                className="w-8 h-8 rounded-full border border-brand-dark/15 flex items-center justify-center hover:bg-brand-muted transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-brand-dark/75 mb-6 leading-relaxed font-normal">
              {t('plans_silver_review')}
            </p>

            <div className="space-y-4 text-xs font-mono text-brand-dark mb-6">
              <div>
                <label className="block uppercase tracking-wider mb-1.5 text-brand-dark/70 font-bold">
                  {t('plans_brand_name')}
                </label>
                <input 
                  type="text" 
                  required
                  value={needleBrandName}
                  onChange={e => setNeedleBrandName(e.target.value)}
                  placeholder={t('plans_brand_hint')}
                  className="w-full bg-brand-muted/30 border border-brand-dark/[0.12] rounded-xl px-4 py-3 focus:outline-none focus:bg-brand-card focus:border-brand-accent transition-all font-sans text-sm text-brand-dark"
                />
              </div>

              <div>
                <label className="block uppercase tracking-wider mb-1.5 text-brand-dark/70 font-bold">
                  {t('plans_portfolio_url')}
                </label>
                <input 
                  type="url" 
                  required
                  value={needlePortfolioLink}
                  onChange={e => setNeedlePortfolioLink(e.target.value)}
                  placeholder="https://instagram.com/your_brand"
                  className="w-full bg-brand-muted/30 border border-brand-dark/[0.12] rounded-xl px-4 py-3 focus:outline-none focus:bg-brand-card focus:border-brand-accent transition-all font-sans text-sm text-brand-dark"
                />
              </div>

              <div className="p-4 bg-brand-muted/40 rounded-2xl border border-brand-dark/[0.08] text-xs text-brand-dark/80 leading-relaxed font-sans">
                {t('plans_silver_fee')}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-brand-dark/[0.08]">
              <button
                type="button"
                onClick={() => setShowNeedleModal(false)}
                className="px-6 py-2.5 rounded-full border border-brand-dark/20 text-xs font-semibold uppercase tracking-wider text-brand-dark hover:bg-brand-muted transition-colors cursor-pointer"
              >
                {t('ui_cancel')}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-7 py-2.5 rounded-full bg-brand-dark hover:bg-brand-accent text-white text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
              >
                {loading ? t('plans_submitting') : t('plans_submit_review')}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
