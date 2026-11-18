import '../locales/catalogues';
import {SecureImage} from '../components/SecureMedia';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { 
  MapPin, 
  ArrowUpRight, 
  X, 
  Instagram, 
  Globe, 
  Search, 
  Sparkles, 
  MessageSquare, 
  ExternalLink, 
  ShieldCheck, 
  UserCheck 
} from 'lucide-react';
import { collection, getDocs, addDoc, serverTimestamp, doc, writeBatch, query, limit } from '../lib/firestoreClient';
import { Link, useNavigate } from 'react-router';
import { db } from '../lib/firebase';
import { DEFAULT_AGENCIES } from '../data/defaultAgencies';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { getOrCreateConversation } from '../lib/chatService';
import AgencyBadge from '../components/AgencyBadge';
import { AgencyItem } from '../types';

export default function Agencies() {
  const { t, i18n } = useTranslation();
  const { currentUser, dbUser, isAdmin } = useAuth();
  const ui = useUI();
  const navigate = useNavigate();
  const [selectedAgency, setSelectedAgency] = useState<AgencyItem | null>(null);
  const [agencies, setAgencies] = useState<AgencyItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [contactLoading, setContactLoading] = useState(false);
  const [linkingLoading, setLinkingLoading] = useState(false);

  // Lock body scroll and prevent page scrolling when agency modal popup is open
  useEffect(() => {
    if (selectedAgency) {
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleCloseModal();
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [selectedAgency]);

  const fetchAgencies = async () => {
    setLoading(true);
    try {
      let snap = await getDocs(collection(db, 'agencies'));
      


      const OBSOLETE_AGENCY_KEYWORDS = ['fms models', 'fashion model school', 'high life model agency', 'high life', 'baku model management', 'baku models'];

      const list: AgencyItem[] = snap.docs
        .map(docSnap => {
          const a = docSnap.data();
          let focusArr: string[] = [];
          if (Array.isArray(a.focus)) {
            focusArr = a.focus;
          } else if (typeof a.focus === 'string' && a.focus) {
            focusArr = [a.focus];
          } else {
            focusArr = ['Scouting', 'Placement'];
          }

          let agencyName = (a.name || 'Agency Name').trim();
          if (agencyName.toLowerCase() === 'nl models') {
            agencyName = 'LN Models';
          }

          return {
            id: docSnap.id,
            name: agencyName,
            location: a.location || t('catalogue_baku'),
            description: a.description || a.bio || t('catalogue_agency_default'),
            focus: focusArr,
            image: a.image || a.imageUrl || 'https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?auto=format&fit=crop&q=80',
            instagram: a.instagram || '',
            website: a.website || '',
            order: typeof a.order === 'number' ? a.order : 999,
            linkedUserId: a.linkedUserId,
            linkedUserName: a.linkedUserName,
            linkedUserHandle: a.linkedUserHandle,
            hasAgencyBadge: a.hasAgencyBadge ?? true
          };
        })
        .filter(agency => {
          const lowerName = agency.name.toLowerCase();
          return !OBSOLETE_AGENCY_KEYWORDS.some(k => lowerName.includes(k));
        });

      list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      setAgencies(list);
    } catch (err) {
      console.error("Failed fetching agencies", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgencies();
  }, []);

  const handleOpenAgency = (agency: AgencyItem) => {
    setSelectedAgency(agency);
  };

  const handleCloseModal = () => {
    setSelectedAgency(null);
  };

  const handleContactAgency = async (agency: AgencyItem) => {
    if (!currentUser) {
      navigate('/login');
      return;
    }

    if (!agency.linkedUserId) {
      ui.alert(t('catalogue_agency_unlinked'));
      return;
    }

    if (currentUser.uid === agency.linkedUserId) {
      ui.alert(t('catalogue_agency_own'));
      return;
    }

    setContactLoading(true);
    try {
      const convId = await getOrCreateConversation(
        {
          uid: currentUser.uid,
          displayName: dbUser?.name || currentUser.displayName || 'Fashion Member',
          email: currentUser.email,
          photoURL: dbUser?.avatarUrl || currentUser.photoURL,
          role: dbUser?.role || 'user',
          username: dbUser?.username,
          handle: dbUser?.handle
        },
        {
          id: agency.linkedUserId,
          name: agency.linkedUserName || agency.name,
          email: '',
          avatarUrl: agency.image || '',
          role: 'user',
          headline: t('catalogue_agency_rep', { agency: agency.name }),
          username: agency.linkedUserHandle?.replace('@', '') || '',
          handle: agency.linkedUserHandle || `@${agency.name.toLowerCase().replace(/[^a-z0-9_]/g, '')}`
        },
        'pending'
      );

      handleCloseModal();
      navigate(`/messages?conversationId=${convId}`);
    } catch (err) {
      console.error('Error starting conversation with agency:', err);
      navigate(`/messages?userId=${agency.linkedUserId}&name=${encodeURIComponent(agency.name)}`);
    } finally {
      setContactLoading(false);
    }
  };

  const handleLinkCurrentAccount = async (agency: AgencyItem) => {
    if (!currentUser || !dbUser) {
      navigate('/login');
      return;
    }
    if (!isAdmin) return;

    const confirmLink = window.confirm(t('catalogue_agency_confirm', { name: dbUser.name || currentUser.email, agency: agency.name }));
    if (!confirmLink) return;

    setLinkingLoading(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', currentUser.uid), {
        isAgency: true,
        isAgencyRepresentative: true,
        hasAgencyBadge: true,
        agencyVerificationStatus: 'approved',
        agencyBadgeGrantedAt: Date.now(),
        representedAgencyName: agency.name,
        representedAgencyId: agency.id,
        industry: 'agency'
      });

      batch.update(doc(db, 'agencies', agency.id), {
        linkedUserId: currentUser.uid,
        hasAgencyBadge: true
      });
      await batch.commit();

      ui.alert(t('catalogue_agency_linked', { agency: agency.name }));
      await fetchAgencies();
      setSelectedAgency(prev => prev ? {
        ...prev,
        linkedUserId: currentUser.uid,
        linkedUserName: dbUser.name,
        linkedUserHandle: dbUser.handle,
        hasAgencyBadge: true
      } : null);
    } catch (e: any) {
      console.error('Failed to link agency:', e);
      ui.alert(e instanceof Error ? e.message : t('api_request_failed'));
    } finally {
      setLinkingLoading(false);
    }
  };

  const filteredAgencies = agencies.filter(a => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.location.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="animate-in fade-in duration-700 bg-brand-light min-h-screen pb-20">
      {/* 1. EDITORIAL HERO HEADER */}
      <section className="border-b border-brand-dark/[0.08] bg-brand-light pt-6 pb-6 sm:py-10 px-4 sm:px-8 relative overflow-hidden shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-serif font-normal tracking-tight text-brand-dark leading-[1.02]">
              {t('catalogue_agencies_title')}
            </h1>
            <p className="text-xs sm:text-sm text-brand-dark/65 mt-1.5 max-w-2xl font-normal leading-relaxed">
              {t('catalogue_agencies_intro')}
            </p>
          </div>

          {/* Search Box */}
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-dark/40" size={15} />
              <input
                type="text"
                placeholder={t('catalogue_agency_search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 bg-brand-muted/40 border border-brand-dark/[0.12] rounded-full text-xs font-medium text-brand-dark placeholder:text-brand-dark/40 focus:outline-none focus:border-brand-accent focus:bg-brand-card transition-all shadow-2xs"
              />
              {searchQuery && (
                <button 
                  type="button" 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-dark/40 hover:text-brand-dark cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 2. AGENCIES GRID */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
        {loading ? (
          <div className="py-24 text-center">
            <div className="inline-block w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="font-mono text-xs uppercase tracking-wider text-brand-dark/50">{t('catalogue_agency_loading')}</p>
          </div>
        ) : filteredAgencies.length === 0 ? (
          <div className="py-16 text-center rounded-3xl border border-dashed border-brand-dark/20 bg-brand-card p-8 max-w-md mx-auto shadow-2xs space-y-2">
            <p className="font-serif text-lg text-brand-dark">{t('catalogue_agency_empty')}</p>
            <p className="font-mono text-xs text-brand-dark/50 uppercase tracking-wider">{t('catalogue_adjust_search')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {filteredAgencies.map((agency, index) => (
              <motion.div 
                key={agency.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
                className="bg-brand-card rounded-3xl border border-brand-dark/[0.08] flex flex-col group overflow-hidden shadow-xs hover:border-brand-accent/30 hover:shadow-sm transition-all"
              >
                {/* Agency Image Container */}
                <div className="relative aspect-[16/10] sm:aspect-[16/11] overflow-hidden bg-brand-muted">
                  <SecureImage 
                    src={agency.image} 
                    alt={agency.name} 
                    className="w-full h-full object-cover grayscale contrast-[1.05] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" 
                    crossOrigin="anonymous" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity"></div>
                  
                  {/* Badges Overlay */}
                  <div className="absolute top-3.5 left-3.5 flex items-center gap-2">
                    <div className="bg-brand-card/95 backdrop-blur-md text-brand-dark px-2.5 py-1 rounded-full border border-brand-dark/10 flex items-center gap-1.5 shadow-2xs">
                      <AgencyBadge size="xs" />
                      <span className="font-mono text-[9px] font-bold tracking-wider uppercase">{t('catalogue_agency_official')}</span>
                    </div>
                  </div>

                  {agency.linkedUserId && (
                    <div className="absolute top-3.5 right-3.5 bg-brand-dark/90 backdrop-blur-md text-white px-2.5 py-1 rounded-full border border-white/20 font-mono text-[10px] font-semibold flex items-center gap-1 shadow-2xs">
                      <ShieldCheck size={11} className="text-brand-accent" />
                      <span>{agency.linkedUserHandle || 'Verified'}</span>
                    </div>
                  )}

                  <div className="absolute bottom-3 left-3.5 right-3.5 flex items-center gap-1.5 text-white/90 text-xs font-mono">
                    <MapPin size={12} className="text-brand-accent shrink-0" />
                    <span className="truncate">{agency.location}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 sm:p-7 flex flex-col flex-grow space-y-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-serif font-normal tracking-tight text-brand-dark group-hover:text-brand-accent transition-colors flex items-center gap-2 flex-wrap">
                      <span>{agency.name}</span>
                      <AgencyBadge size="xs" />
                    </h2>
                  </div>

                  <p className="text-brand-dark/70 text-xs sm:text-sm font-normal line-clamp-3 leading-relaxed flex-grow">
                    {agency.description}
                  </p>

                  {/* Focus Tags */}
                  <div className="pt-2 border-t border-brand-dark/[0.06]">
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                      {agency.focus.map((f: string) => (
                        <span key={f} className="rounded-full px-2.5 py-0.5 bg-brand-muted/70 text-brand-dark/70 border border-brand-dark/[0.06] font-medium">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action Button */}
                  <button 
                    type="button"
                    onClick={() => handleOpenAgency(agency)} 
                    className="mt-2 w-full bg-brand-dark text-white rounded-full px-5 py-3 text-xs font-semibold uppercase tracking-wider hover:bg-brand-accent transition-all flex items-center justify-between group/btn shadow-2xs cursor-pointer"
                  >
                    <span>{t('catalogue_agency_details')}</span>
                    <ArrowUpRight size={15} className="group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 3. EDITORIAL DETAILS & MODELS MODAL (POPUP) */}
      {selectedAgency && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 overflow-y-auto overscroll-contain"
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity cursor-pointer" 
            onClick={handleCloseModal}
          />
          <div className="relative z-10 bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-6 sm:p-8 md:p-10 max-w-3xl w-full shadow-2xl my-auto max-h-[92vh] overflow-y-auto overscroll-contain space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex justify-between items-start gap-4 pb-4 border-b border-brand-dark/[0.08]">
              <div>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-brand-accent bg-brand-accent/5 border border-brand-accent/15 px-2.5 py-0.5 rounded-full font-semibold">
                    {t('catalogue_agency_single')}
                  </span>
                  <AgencyBadge size="xs" showLabel agencyName={selectedAgency.name} />
                </div>
                <h3 className="text-2xl sm:text-3xl md:text-4xl font-serif font-normal tracking-tight text-brand-dark flex items-center gap-2 flex-wrap">
                  <span>{selectedAgency.name}</span>
                  <AgencyBadge size="md" />
                </h3>
                <div className="flex items-center gap-1.5 text-brand-dark/60 font-mono text-xs mt-1">
                  <MapPin size={13} className="text-brand-accent shrink-0" />
                  <span>{selectedAgency.location}</span>
                </div>
              </div>

              <button 
                type="button"
                onClick={handleCloseModal} 
                className="w-9 h-9 rounded-full border border-brand-dark/10 hover:bg-brand-dark hover:text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer shadow-2xs"
              >
                <X size={16} />
              </button>
            </div>

            {/* Hero Image */}
            <div className="relative h-52 sm:h-72 rounded-2xl overflow-hidden border border-brand-dark/[0.08] shadow-2xs bg-brand-muted">
              <SecureImage 
                src={selectedAgency.image} 
                alt={selectedAgency.name} 
                className="w-full h-full object-cover" 
                crossOrigin="anonymous" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
              <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                <span className="bg-brand-card/95 backdrop-blur-md text-brand-dark text-xs font-mono font-semibold px-3 py-1 rounded-full shadow-xs">
                  {t('catalogue_agency_verified')}
                </span>
              </div>
            </div>

            {/* Linked Official Agency Representative Profile Card */}
            {selectedAgency.linkedUserId && (
              <div className="rounded-2xl bg-brand-accent/[0.03] border border-brand-accent/20 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-accent flex items-center gap-1.5 mb-1">
                    <ShieldCheck size={13} />
                    <span>{t('catalogue_rep_verified')}</span>
                  </div>
                  <div className="font-serif text-lg font-normal text-brand-dark flex items-center gap-2">
                    <span>{selectedAgency.linkedUserName || selectedAgency.name}</span>
                    <AgencyBadge size="xs" />
                  </div>
                  {selectedAgency.linkedUserHandle && (
                    <div className="text-xs font-mono text-brand-dark/60 mt-0.5">
                      {selectedAgency.linkedUserHandle}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Link
                    to={`/u/${(selectedAgency.linkedUserHandle || selectedAgency.linkedUserId).replace('@', '')}`}
                    className="bg-brand-card hover:bg-brand-dark hover:text-white text-brand-dark border border-brand-dark/[0.12] px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 justify-center flex-1 sm:flex-initial shadow-2xs"
                  >
                    <span>{t('ui_profile')}</span>
                    <ExternalLink size={12} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleContactAgency(selectedAgency)}
                    disabled={contactLoading}
                    className="bg-brand-accent hover:bg-brand-dark text-white px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 justify-center flex-1 sm:flex-initial shadow-2xs cursor-pointer"
                  >
                    <MessageSquare size={13} />
                    <span>{contactLoading ? t('catalogue_chat_opening') : t('send_message_btn')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Quick Link Account Button if unlinked */}
            {!selectedAgency.linkedUserId && currentUser && isAdmin && (
              <div className="rounded-2xl bg-brand-muted/30 border border-dashed border-brand-dark/20 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-brand-dark/70 font-medium">
                  {t('catalogue_agency_connect_text', { agency: selectedAgency.name })}
                </span>
                <button
                  type="button"
                  onClick={() => handleLinkCurrentAccount(selectedAgency)}
                  disabled={linkingLoading}
                  className="bg-brand-dark text-white rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-accent transition-colors shrink-0 shadow-2xs cursor-pointer"
                >
                  {linkingLoading ? t('catalogue_linking') : t('catalogue_link_account')}
                </button>
              </div>
            )}

            {/* Agency Owner Management Shortcut */}
            {(selectedAgency.linkedUserId === currentUser?.uid || isAdmin) && (
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200/80 p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
                  <ShieldCheck size={16} className="text-brand-accent shrink-0" />
                  <span>{t('catalogue_agency_manage')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleCloseModal();
                    navigate('/dashboard?tab=agency-models');
                  }}
                  className="bg-brand-dark text-white px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider hover:bg-brand-accent transition-colors shrink-0 shadow-2xs cursor-pointer"
                >
                  {t('catalogue_open_account')}
                </button>
              </div>
            )}

            {/* Overview / Bio */}
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/60">
                {t('catalogue_agency_about')}
              </h4>
              <p className="text-brand-dark/80 text-sm leading-relaxed font-normal whitespace-pre-wrap">
                {selectedAgency.description}
              </p>
            </div>

            {/* Focus & Specialization */}
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/60">
                {t('catalogue_agency_focus')}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedAgency.focus.map((f: string, i: number) => (
                  <span key={i} className="rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider bg-brand-muted/70 text-brand-dark border border-brand-dark/[0.08]">
                    {f}
                  </span>
                ))}
              </div>
            </div>

            {/* External Links */}
            {(selectedAgency.instagram || selectedAgency.website) && (
              <div className="flex flex-wrap gap-2.5 pt-2">
                {selectedAgency.instagram && (
                  <a 
                    href={selectedAgency.instagram.startsWith('http') ? selectedAgency.instagram : `https://${selectedAgency.instagram}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-full border border-brand-dark/[0.12] bg-brand-muted/40 hover:bg-brand-dark hover:text-white text-brand-dark text-xs font-semibold uppercase tracking-wider transition-colors shadow-2xs"
                  >
                    <Instagram size={14} className="shrink-0" />
                    <span>Instagram</span>
                    <ExternalLink size={11} className="opacity-60" />
                  </a>
                )}
                {selectedAgency.website && (
                  <a 
                    href={selectedAgency.website.startsWith('http') ? selectedAgency.website : `https://${selectedAgency.website}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-full border border-brand-dark/[0.12] bg-brand-muted/40 hover:bg-brand-dark hover:text-white text-brand-dark text-xs font-semibold uppercase tracking-wider transition-colors shadow-2xs"
                  >
                    <Globe size={14} className="shrink-0" />
                    <span>{t('catalogue_website')}</span>
                    <ExternalLink size={11} className="opacity-60" />
                  </a>
                )}
              </div>
            )}

            {/* Footer Action */}
            <div className="pt-4 border-t border-brand-dark/[0.08] flex items-center justify-end">
              <button 
                type="button"
                onClick={handleCloseModal} 
                className="bg-brand-dark text-white hover:bg-brand-accent rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors shadow-2xs cursor-pointer"
              >
                {t('ui_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
