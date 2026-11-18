import '../locales/designer';
import { useTranslation } from 'react-i18next';
import { listIdentityApplications, readIdentityApplication } from '../lib/identityApplications';
import {getTimestampMillis} from '../lib/dateUtils';
import {SecureImage} from './SecureMedia';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  getDocs, 
  query, 
  where 
} from '../lib/firestoreClient';
import { 
  X, 
  Sparkles, 
  Check, 
  Globe, 
  Instagram, 
  Upload, 
  FileText, 
  Scissors, 
  Award, 
  MessageSquare, 
  ShieldCheck, 
  Phone, 
  MapPin, 
  Calendar, 
  AlertCircle,
  Clock,
  ExternalLink,
  Copy,
  ChevronRight,
  Eye,
  Send,
  Building2,
  CheckCircle2
} from 'lucide-react';
import GoldenNeedleBadge from './GoldenNeedleBadge';
import { uploadMediaFile } from '../lib/upload';
import { useNavigate } from 'react-router';
import { User as UserType } from '../types';

interface DesignerManagementHubProps {
  user: UserType;
  onStatusUpdated?: () => void;
}

export default function DesignerManagementHub({ user, onStatusUpdated }: DesignerManagementHubProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const ui = useUI();
  const navigate = useNavigate();

  // Status flags
  const isApproved = user.designerVerificationStatus === 'approved' || Boolean(user.hasGoldenNeedle);
  const [existingApplication, setExistingApplication] = useState<any>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [copiedChatLink, setCopiedChatLink] = useState(false);

  // Zoom image modal
  const [zoomImage, setZoomImage] = useState<{ url: string; caption?: string } | null>(null);

  // File upload refs & states
  const [idCardUploading, setIdCardUploading] = useState(false);
  const [personalPhotoUploading, setPersonalPhotoUploading] = useState(false);
  const idCardInputRef = useRef<HTMLInputElement>(null);
  const personalPhotoInputRef = useRef<HTMLInputElement>(null);

  // Form states (same questions as model agency verification, tailored for designer)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [brandName, setBrandName] = useState('');
  const [foundingYear, setFoundingYear] = useState('2022');
  const [brandAddress, setBrandAddress] = useState('');
  const [designerRole, setDesignerRole] = useState('Creative Director / Head Designer');
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState('');
  const [personalPhotoUrl, setPersonalPhotoUrl] = useState('');
  const [instagram, setInstagram] = useState('');
  const [website, setWebsite] = useState('');
  const [comment, setComment] = useState('');
  const [submittingApp, setSubmittingApp] = useState(false);

  // Fetch user's application if existing
  const fetchUserApplication = async () => {
    if (!currentUser) return;
    setLoadingApp(true);
    try {
      const { items } = await listIdentityApplications<any>('designer_applications', { mine: true });
      if (items.length) {
        const latest = await readIdentityApplication('designer_applications', items[0]);
        setExistingApplication(latest);

        // Pre-fill form values from previous application if needed
        if (latest) {
          setFirstName(latest.applicantFirstName || '');
          setLastName(latest.applicantLastName || '');
          setPatronymic(latest.applicantPatronymic || '');
          setPhone(latest.phoneNumber || '');
          setEmail(latest.userEmail || '');
          setBrandName(latest.brandName || '');
          setFoundingYear(latest.foundingYear || '2022');
          setBrandAddress(latest.brandAddress || '');
          setDesignerRole(latest.designerRole || 'Creative Director / Head Designer');
          setIdCardPhotoUrl(latest.status === 'pending' && !latest.needsDocumentReupload ? latest.idCardPhotoUrl || latest.idDocumentUrl || '' : '');
          setPersonalPhotoUrl(latest.status === 'pending' && !latest.needsDocumentReupload ? latest.personalPhotoUrl || '' : '');
          setInstagram(latest.instagram || '');
          setWebsite(latest.website || '');
          setComment(latest.comment || '');
        }
      }
    } catch (err) {
      console.error('Failed to fetch designer application:', err);
    } finally {
      setLoadingApp(false);
    }
  };

  useEffect(() => {
    fetchUserApplication();
  }, [currentUser]);

  // Sync initial user fields when empty
  useEffect(() => {
    if (user && !firstName && !lastName) {
      const nameParts = (user.name || '').trim().split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setEmail(user.email || '');
      if (user.designerBrandName || user.brandName) {
        setBrandName(user.designerBrandName || user.brandName || '');
      }
    }
  }, [user]);

  const isPending = !existingApplication?.needsDocumentReupload && (user.designerVerificationStatus === 'pending' || existingApplication?.status === 'pending');
  const isRejected = user.designerVerificationStatus === 'rejected' || (existingApplication?.status === 'rejected' && !isApproved);

  // File upload handler
  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>, type: 'idCard' | 'personal') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      ui.alert(t('designer_file_limit'));
      return;
    }

    if (type === 'idCard') setIdCardUploading(true);
    else setPersonalPhotoUploading(true);

    try {
      const url = await uploadMediaFile(file, undefined, type==='idCard'?'id_document':'verification_photo');
      if (type === 'idCard') {
        setIdCardPhotoUrl(url);
      } else {
        setPersonalPhotoUrl(url);
      }
    } catch (err: any) {
      console.error('File upload error:', err);
      ui.alert(err instanceof Error ? err.message : t('api_request_failed'));
    } finally {
      if (type === 'idCard') setIdCardUploading(false);
      else setPersonalPhotoUploading(false);
    }
  };

  // Submit application
  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!idCardPhotoUrl.trim()) {
      ui.alert(t('designer_id_required'));
      return;
    }
    if (!personalPhotoUrl.trim()) {
      ui.alert(t('designer_selfie_required'));
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      ui.alert(t('designer_name_required'));
      return;
    }
    if (!phone.trim()) {
      ui.alert(t('designer_phone_required'));
      return;
    }
    if (!brandName.trim()) {
      ui.alert(t('designer_brand_required'));
      return;
    }
    if (!foundingYear.trim()) {
      ui.alert(t('designer_year_required'));
      return;
    }

    setSubmittingApp(true);
    try {
      const now = Date.now();
      const userHandle = user.handle || (user.username ? `@${user.username}` : `@${currentUser.email?.split('@')[0]}`);

      // 1. Create document in designer_applications
      const appRef = await addDoc(collection(db, 'designer_applications'), {
        userId: currentUser.uid,
        userEmail: email.trim() || currentUser.email || '',
        userHandle: userHandle,
        applicantFirstName: firstName.trim(),
        applicantLastName: lastName.trim(),
        applicantPatronymic: patronymic.trim(),
        phoneNumber: phone.trim(),
        brandName: brandName.trim(),
        brandAddress: brandAddress.trim(),
        foundingYear: foundingYear.trim(),
        idCardPhotoUrl: idCardPhotoUrl,
        personalPhotoUrl: personalPhotoUrl,
        idDocumentUrl: idCardPhotoUrl,
        designerRole: designerRole.trim(),
        instagram: instagram.trim(),
        website: website.trim(),
        comment: comment.trim(),
        location: brandAddress.trim() || t('designer_baku'),
        status: 'pending',
        createdAt: now
      });

      // Pending state is committed atomically by the server.
      

      setJustSubmitted(true);
      setShowApplyForm(false);
      await fetchUserApplication();
      onStatusUpdated?.();
      ui.alert(t('designer_request_sent'));
    } catch (err: any) {
      console.error('Error submitting designer application:', err);
      handleFirestoreError(err, OperationType.CREATE, 'designer_applications');
    } finally {
      setSubmittingApp(false);
    }
  };

  const effectiveBrandName = user.designerBrandName || user.brandName || existingApplication?.brandName || 'Fashion Brand';
  const directChatLink = `${window.location.origin}/messages?name=${encodeURIComponent(effectiveBrandName)}&userId=${user.id}`;

  const copyDirectChatLink = () => {
    navigator.clipboard.writeText(directChatLink);
    setCopiedChatLink(true);
    setTimeout(() => setCopiedChatLink(false), 2200);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* HIDDEN FILE INPUTS */}
      <input 
        type="file" 
        ref={idCardInputRef} 
        accept="image/*" 
        className="hidden" 
        onChange={e => handleUploadFile(e, 'idCard')} 
      />
      <input 
        type="file" 
        ref={personalPhotoInputRef} 
        accept="image/*" 
        className="hidden" 
        onChange={e => handleUploadFile(e, 'personal')} 
      />

      {/* STATE 1: APPROVED DESIGNER HUB (SHOW DIRECT CHAT & GOLDEN NEEDLE SECTIONS) */}
      {isApproved && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* CELEBRATION BADGE BANNER */}
          <div className="bg-[#fffdf0] rounded-3xl border-2 border-amber-400/80 p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-amber-400/30">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shrink-0">
                  <Scissors size={26} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-amber-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                      {t('designer_approved')}
                    </span>
                    <GoldenNeedleBadge size="sm" showLabel />
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark mt-1">
                    {t('designer_verified')} {effectiveBrandName}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/designers?search=${encodeURIComponent(effectiveBrandName)}`)}
                className="px-4 py-2 bg-brand-card border border-brand-dark/15 rounded-full text-xs font-mono font-bold uppercase tracking-wider hover:bg-brand-dark hover:text-white transition-colors flex items-center gap-1.5 shrink-0"
              >
                <span>{t('designer_listed')}</span>
                <ExternalLink size={13} />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-brand-dark/80 mt-4 leading-relaxed font-medium">
              {t('designer_verified_detail')}
            </p>
          </div>

          {/* DEDICATED DIRECT CHAT WORKSPACE SECTION */}
          <div className="bg-brand-card rounded-3xl border-2 border-brand-dark p-6 sm:p-8 md:p-10 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-brand-dark/[0.08]">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="bg-brand-action text-white px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest rounded-full flex items-center gap-1">
                    <MessageSquare size={12} /> Direct Chat Workspace
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {t('designer_chat_active')}
                  </span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark">
                  {t('designer_chat_button_label')}
                </h3>
                <p className="text-xs sm:text-sm text-brand-dark/70 mt-1">
                  {t('designer_chat_intro')}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/messages')}
                  className="px-6 py-3 rounded-full bg-brand-action text-white font-mono font-bold text-xs uppercase tracking-wider hover:bg-black transition-colors shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Send size={14} />
                  <span>{t('designer_open_chat')}</span>
                </button>
              </div>
            </div>

            {/* Direct Chat Link & Public Access */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 bg-brand-light rounded-2xl border border-brand-dark/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
                    <Globe size={14} className="text-brand-accent" /> {t('designer_chat_link')}
                  </span>
                  <button
                    type="button"
                    onClick={copyDirectChatLink}
                    className="text-[11px] font-mono text-brand-accent hover:underline flex items-center gap-1 font-bold cursor-pointer"
                  >
                    {copiedChatLink ? (
                      <>
                        <Check size={13} className="text-emerald-600" />
                        <span className="text-emerald-700">{t('ui_copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>{t('ui_copy')}</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-2.5 bg-brand-card border border-brand-dark/10 rounded-xl font-mono text-[11px] text-brand-dark/70 truncate select-all">
                  {directChatLink}
                </div>
                <p className="text-[11px] text-brand-dark/60 leading-relaxed">
                  {t('designer_chat_link_hint')}
                </p>
              </div>

              <div className="p-5 bg-brand-light rounded-2xl border border-brand-dark/10 space-y-3">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-700" /> {t('designer_chat_visibility')}
                </span>
                <div className="p-3 bg-brand-card border border-brand-dark/10 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-brand-dark">{t('designer_chat_visible')}</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                    {t('designer_chat_enabled')}
                  </span>
                </div>
                <p className="text-[11px] text-brand-dark/60 leading-relaxed">
                  {t('designer_chat_visibility_hint')}
                </p>
              </div>
            </div>

            {/* QUICK ACTIONS ROW */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/messages')}
                className="px-5 py-2.5 rounded-full bg-brand-dark text-white font-mono font-semibold text-xs uppercase tracking-wider hover:bg-brand-accent transition-colors flex items-center gap-2"
              >
                <MessageSquare size={13} />
                <span>{t('designer_incoming_chats')}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/u/${user.handle?.replace(/^@+/, '') || user.username || user.id}`)}
                className="px-5 py-2.5 rounded-full border border-brand-dark/20 text-brand-dark font-mono font-semibold text-xs uppercase tracking-wider hover:bg-brand-dark hover:text-white transition-colors flex items-center gap-2"
              >
                <span>{t('designer_public_profile')}</span>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE 2: PENDING VERIFICATION NOTICE */}
      {isPending && !justSubmitted && (
        <div className="bg-brand-card rounded-3xl border-2 border-amber-300 p-6 sm:p-8 md:p-10 shadow-sm space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0">
              <Clock size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-mono font-bold text-[10px] uppercase">
                  {t('designer_review_eta')}
                </span>
                <span className="text-xs font-mono text-brand-dark/50">
                  {t('designer_request_id')} {existingApplication?.id || user.designerApplicationId || '—'}
                </span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark">
                {t('designer_in_review')}
              </h3>
              <p className="text-xs sm:text-sm text-brand-dark/70 mt-1 leading-relaxed">
                {t('designer_review_intro')}
              </p>
            </div>
          </div>

          {/* Submitted dossier summary */}
          <div className="p-5 bg-brand-light rounded-2xl border border-brand-dark/10 space-y-4 text-xs">
            <div className="font-serif font-bold text-sm uppercase tracking-wider text-brand-dark pb-2 border-b border-brand-dark/10 flex items-center justify-between">
              <span>{t('identity_attachments')}</span>
              <span className="font-mono text-[10px] text-brand-dark/50">
                {t('designer_submitted_at')} {existingApplication?.createdAt ? new Date(getTimestampMillis(existingApplication.createdAt)).toLocaleDateString() : t('designer_recent')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('designer_house')}</span>
                <strong className="text-brand-dark text-sm">{existingApplication?.brandName || brandName || '—'}</strong>
              </div>
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('designer_full_name')}</span>
                <strong className="text-brand-dark text-sm">
                  {existingApplication?.applicantFirstName || firstName} {existingApplication?.applicantLastName || lastName} {existingApplication?.applicantPatronymic || patronymic}
                </strong>
              </div>
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('designer_founded')}</span>
                <strong className="text-brand-dark text-sm">{existingApplication?.foundingYear || foundingYear || '—'}</strong>
              </div>
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('ui_phone')}</span>
                <strong className="text-brand-dark">{existingApplication?.phoneNumber || phone || '—'}</strong>
              </div>
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('ui_email')}</span>
                <strong className="text-brand-dark">{existingApplication?.userEmail || email || '—'}</strong>
              </div>
              <div>
                <span className="text-brand-dark/50 block font-mono text-[10px] uppercase">{t('designer_studio')}</span>
                <strong className="text-brand-dark">{existingApplication?.brandAddress || brandAddress || t('designer_baku')}</strong>
              </div>
            </div>

            {/* Document Preview Thumbnails */}
            <div className="pt-2 border-t border-brand-dark/10 flex items-center gap-4 flex-wrap">
              {(existingApplication?.idCardPhotoUrl || idCardPhotoUrl) && (
                <div 
                  onClick={() => setZoomImage({ url: existingApplication?.idCardPhotoUrl || idCardPhotoUrl, caption: t('designer_id_alt') })}
                  className="flex items-center gap-2 p-2 bg-brand-card rounded-xl border border-brand-dark/15 hover:border-brand-accent cursor-pointer group transition-all"
                >
                  <SecureImage 
                    src={existingApplication?.idCardPhotoUrl || idCardPhotoUrl} 
                    alt={t('identity_document')} 
                    className="w-10 h-10 object-cover rounded-lg"
                  />
                  <div className="text-left">
                    <span className="text-[10px] font-mono font-bold block text-brand-dark group-hover:text-brand-accent">
                      {t('identity_document')}
                    </span>
                    <span className="text-[9px] text-brand-dark/50">{t('designer_view_image')}</span>
                  </div>
                </div>
              )}

              {(existingApplication?.personalPhotoUrl || personalPhotoUrl) && (
                <div 
                  onClick={() => setZoomImage({ url: existingApplication?.personalPhotoUrl || personalPhotoUrl, caption: t('designer_personal_photo') })}
                  className="flex items-center gap-2 p-2 bg-brand-card rounded-xl border border-brand-dark/15 hover:border-brand-accent cursor-pointer group transition-all"
                >
                  <SecureImage 
                    src={existingApplication?.personalPhotoUrl || personalPhotoUrl} 
                    alt={t('identity_selfie')} 
                    className="w-10 h-10 object-cover rounded-lg"
                  />
                  <div className="text-left">
                    <span className="text-[10px] font-mono font-bold block text-brand-dark group-hover:text-brand-accent">
                      {t('designer_personal_photo')}
                    </span>
                    <span className="text-[9px] text-brand-dark/50">{t('designer_view_image')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 bg-brand-light border border-brand-dark/10 rounded-2xl text-xs text-brand-dark/80 font-medium">
            {t('designer_after_review')}
          </div>
        </div>
      )}

      {/* STATE 3: REJECTED NOTICE */}
      {isRejected && (
        <div className="bg-red-50 rounded-3xl border-2 border-red-300 p-6 sm:p-8 space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <AlertCircle size={24} className="text-red-700 shrink-0" />
            <h3 className="text-xl font-serif font-bold text-red-900">
              {t('designer_denied')}
            </h3>
          </div>
          {existingApplication?.rejectionReason && (
            <div className="p-3 bg-brand-card rounded-xl border border-red-200 text-xs text-red-800">
              <strong>{t('ui_rejection_reason')}</strong> {existingApplication.rejectionReason}
            </div>
          )}
          <p className="text-xs text-red-800/80">
            {t('designer_retry_hint')}
          </p>
          <button
            type="button"
            onClick={() => setShowApplyForm(true)}
            className="px-5 py-2.5 rounded-full bg-red-800 text-white font-semibold text-xs uppercase tracking-wider hover:bg-black transition-colors cursor-pointer"
          >
            {t('designer_retry')}
          </button>
        </div>
      )}

      {/* STATE 4: NOT APPLIED CALL TO ACTION (CTA) */}
      {!isApproved && !isPending && !justSubmitted && !showApplyForm && (
        <div className="bg-brand-card rounded-3xl border-2 border-brand-dark p-6 sm:p-10 shadow-md space-y-6 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-light border-2 border-brand-dark flex items-center justify-center mx-auto text-brand-accent">
            <Scissors size={32} />
          </div>

          <div className="space-y-2">
            <span className="bg-brand-accent text-white px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest">
              DESIGNER VERIFICATION & GOLDEN NEEDLE
            </span>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark">
              {t('designer_verify')}
            </h2>
            <p className="text-xs sm:text-sm text-brand-dark/70 max-w-lg mx-auto font-normal">
              {t('designer_verify_hint')}
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowApplyForm(true)}
              className="px-8 py-4 rounded-full bg-brand-action text-white font-bold text-xs uppercase tracking-widest hover:bg-black transition-all shadow-md hover:scale-[1.02] cursor-pointer inline-flex items-center gap-2"
            >
              <ShieldCheck size={16} />
              <span>{t('designer_form_open')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-4 border-t border-brand-dark/[0.08]">
            <div className="p-3 bg-brand-light rounded-xl border border-brand-dark/10 space-y-1">
              <div className="text-[11px] font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1">
                <Check size={13} className="text-emerald-700" /> {t('designer_golden_badge')}
              </div>
              <p className="text-[10px] text-brand-dark/60">{t('designer_badge_description')}</p>
            </div>

            <div className="p-3 bg-brand-light rounded-xl border border-brand-dark/10 space-y-1">
              <div className="text-[11px] font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1">
                <Check size={13} className="text-emerald-700" /> {t('designer_direct_chat')}
              </div>
              <p className="text-[10px] text-brand-dark/60">{t('designer_direct_orders')}</p>
            </div>

            <div className="p-3 bg-brand-light rounded-xl border border-brand-dark/10 space-y-1">
              <div className="text-[11px] font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1">
                <Check size={13} className="text-emerald-700" /> {t('designer_directory')}
              </div>
              <p className="text-[10px] text-brand-dark/60">{t('designer_directory_entry')}</p>
            </div>
          </div>
        </div>
      )}

      {/* STATE 5: VERIFICATION FORM (SAME QUESTIONS AS MODEL AGENCY VERIFICATION) */}
      {showApplyForm && !isPending && !justSubmitted && (
        <div className="bg-brand-card rounded-3xl border-2 border-brand-accent p-6 sm:p-10 shadow-lg space-y-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between pb-4 border-b border-brand-dark/[0.08]">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-brand-action text-white px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest">
                  {t('designer_application')}
                </span>
                <GoldenNeedleBadge size="xs" showLabel />
              </div>
              <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark">
                {t('designer_form_title')}
              </h3>
              <p className="text-xs text-brand-dark/60 mt-0.5">
                {t('designer_form_eta')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowApplyForm(false)}
              className="w-8 h-8 rounded-full border border-brand-dark/20 flex items-center justify-center hover:bg-brand-dark hover:text-white transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmitApplication} className="space-y-6">
            {/* 1. DOCUMENT & PERSONAL PHOTO UPLOADS */}
            <div className="space-y-3 p-5 bg-brand-light rounded-2xl border-2 border-brand-dark">
              <div className="font-serif font-bold text-xs uppercase tracking-wider text-brand-dark flex items-center gap-2">
                <FileText size={15} className="text-brand-accent" />
                <span>{t('designer_form_docs')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* ID CARD PHOTO (Şəxsiyyət vəsiqəsi) */}
                <div className="space-y-2">
                  <label className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark flex items-center justify-between">
                    <span>{t('designer_form_id')}</span>
                    <span className="text-brand-accent text-[10px]">{t('ui_required')}</span>
                  </label>

                  {idCardPhotoUrl ? (
                    <div className="relative group rounded-xl overflow-hidden border-2 border-brand-dark bg-brand-card">
                      <SecureImage
                        src={idCardPhotoUrl}
                        alt={t('identity_document')}
                        className="w-full h-36 object-cover cursor-pointer"
                        onClick={() => setZoomImage({ url: idCardPhotoUrl, caption: t('designer_id_alt') })}
                      />
                      <div className="absolute inset-0 bg-brand-dark/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => idCardInputRef.current?.click()}
                          className="px-3 py-1 bg-brand-card text-brand-dark text-xs font-mono font-bold uppercase tracking-wider rounded-full hover:bg-brand-accent hover:text-white cursor-pointer"
                        >
                          {t('designer_replace')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIdCardPhotoUrl('')}
                          className="p-1 bg-red-600 text-white rounded-full hover:bg-red-800 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => idCardInputRef.current?.click()}
                      disabled={idCardUploading}
                      className="w-full h-36 border-2 border-dashed border-brand-dark/40 hover:border-brand-accent rounded-xl flex flex-col items-center justify-center p-4 bg-brand-card transition-all text-center group cursor-pointer"
                    >
                      <Upload size={22} className="text-brand-dark/40 group-hover:text-brand-accent mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-dark">
                        {idCardUploading ? t('designer_loading_photo') : t('designer_upload_id')}
                      </span>
                      <span className="text-[10px] text-brand-dark/50 mt-1 font-mono">
                        JPG, PNG, WebP (Max 15MB)
                      </span>
                    </button>
                  )}
                </div>

                {/* PERSONAL PHOTO (Selfie / Portrait) */}
                <div className="space-y-2">
                  <label className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark flex items-center justify-between">
                    <span>{t('designer_portrait')}</span>
                    <span className="text-brand-accent text-[10px]">{t('ui_required')}</span>
                  </label>

                  {personalPhotoUrl ? (
                    <div className="relative group rounded-xl overflow-hidden border-2 border-brand-dark bg-brand-card">
                      <SecureImage
                        src={personalPhotoUrl}
                        alt={t('identity_selfie')}
                        className="w-full h-36 object-cover cursor-pointer"
                        onClick={() => setZoomImage({ url: personalPhotoUrl, caption: t('designer_personal_photo') })}
                      />
                      <div className="absolute inset-0 bg-brand-dark/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => personalPhotoInputRef.current?.click()}
                          className="px-3 py-1 bg-brand-card text-brand-dark text-xs font-mono font-bold uppercase tracking-wider rounded-full hover:bg-brand-accent hover:text-white cursor-pointer"
                        >
                          {t('designer_replace')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPersonalPhotoUrl('')}
                          className="p-1 bg-red-600 text-white rounded-full hover:bg-red-800 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => personalPhotoInputRef.current?.click()}
                      disabled={personalPhotoUploading}
                      className="w-full h-36 border-2 border-dashed border-brand-dark/40 hover:border-brand-accent rounded-xl flex flex-col items-center justify-center p-4 bg-brand-card transition-all text-center group cursor-pointer"
                    >
                      <Upload size={22} className="text-brand-dark/40 group-hover:text-brand-accent mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-dark">
                        {personalPhotoUploading ? t('designer_loading_photo') : t('designer_upload_photo')}
                      </span>
                      <span className="text-[10px] text-brand-dark/50 mt-1 font-mono">
                        {t('designer_photo_hint')}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 2. DESIGNER PERSONAL DETAILS */}
            <div className="space-y-4">
              <div className="font-serif font-bold text-xs uppercase tracking-wider text-brand-dark pb-1 border-b border-brand-dark/[0.08]">
                {t('designer_form_personal')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('ui_first_name')}
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder={t('designer_name_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('ui_last_name')}
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder={t('designer_last_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('ui_patronymic')}
                  </label>
                  <input
                    type="text"
                    required
                    value={patronymic}
                    onChange={e => setPatronymic(e.target.value)}
                    placeholder={t('designer_parent_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_phone')}
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+994 50 123 45 67"
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_email')}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="designer@brand.az"
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>
            </div>

            {/* 3. BRAND / FASHION HOUSE DETAILS */}
            <div className="space-y-4">
              <div className="font-serif font-bold text-xs uppercase tracking-wider text-brand-dark pb-1 border-b border-brand-dark/[0.08]">
                {t('designer_brand_details')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_brand_input')}
                  </label>
                  <input
                    type="text"
                    required
                    value={brandName}
                    onChange={e => setBrandName(e.target.value)}
                    placeholder={t('designer_brand_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_year')}
                  </label>
                  <input
                    type="number"
                    required
                    min="1950"
                    max="2026"
                    value={foundingYear}
                    onChange={e => setFoundingYear(e.target.value)}
                    placeholder={t('designer_year_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_position')}
                  </label>
                  <select
                    value={designerRole}
                    onChange={e => setDesignerRole(e.target.value)}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold uppercase tracking-wider"
                  >
                    <option value="Creative Director / Head Designer">{t('designer_creative_director')}</option>
                    <option value="Lead Fashion Designer">{t('designer_lead')}</option>
                    <option value="Brand Founder & Designer">{t('designer_founder_role')}</option>
                    <option value="Couture Master / Tailor">{t('designer_couture')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark flex items-center justify-between">
                    <span>{t('ui_address')}</span>
                    <span className="text-[10px] text-brand-dark/50 font-normal">{t('ui_optional')}</span>
                  </label>
                  <input
                    type="text"
                    value={brandAddress}
                    onChange={e => setBrandAddress(e.target.value)}
                    placeholder={t('designer_address_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-semibold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('designer_instagram')}
                  </label>
                  <input
                    type="text"
                    value={instagram}
                    onChange={e => setInstagram(e.target.value)}
                    placeholder={t('designer_instagram_hint')}
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-semibold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                    {t('ui_website')}
                  </label>
                  <input
                    type="text"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    placeholder="https://brand.az"
                    className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-semibold text-brand-dark focus:outline-none focus:border-brand-accent"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-dark">
                  {t('designer_collection_links')}
                </label>
                <textarea
                  rows={2}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder={t('designer_collection_hint')}
                  className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-medium text-brand-dark focus:outline-none focus:border-brand-accent"
                />
              </div>
            </div>

            {/* SUBMIT BUTTON */}
                <p className="text-xs leading-relaxed text-brand-dark/75">{t('identity_retention_notice')}</p>
            <div className="pt-4 border-t border-brand-dark/[0.08] flex items-center justify-between gap-4 flex-wrap">
              <button
                type="button"
                onClick={() => setShowApplyForm(false)}
                className="px-5 py-2.5 rounded-full border border-brand-dark/20 text-xs font-semibold uppercase tracking-wider hover:bg-brand-dark hover:text-white transition-colors cursor-pointer"
              >
                {t('ui_cancel')}
              </button>

              <button
                type="submit"
                disabled={submittingApp || idCardUploading || personalPhotoUploading}
                className="px-8 py-3 rounded-full bg-brand-action text-white font-bold text-xs uppercase tracking-widest hover:bg-black transition-all shadow-md hover:scale-[1.02] cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                <ShieldCheck size={16} />
                <span>{t(submittingApp ? 'ui_sending' : 'ui_submit_application')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* IMAGE ZOOM MODAL */}
      {zoomImage && (
        <div 
          className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white transition-colors p-1"
            >
              <X size={24} />
            </button>
            <SecureImage 
              src={zoomImage.url} 
              alt={zoomImage.caption || t('designer_viewer')} 
              className="max-h-[82vh] max-w-full object-contain rounded-xl border border-white/20 shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
            {zoomImage.caption && (
              <p className="text-white text-xs font-mono font-bold mt-2 bg-black/60 px-3 py-1 rounded-full">
                {zoomImage.caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
