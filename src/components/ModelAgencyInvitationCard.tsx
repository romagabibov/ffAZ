import '../locales/model';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/apiClient';
import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Check, 
  X, 
  ShieldCheck, 
  AlertCircle, 
  LogOut, 
  Clock, 
  Sparkles,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  updateDoc, 
  addDoc, 
  serverTimestamp 
} from '../lib/firestoreClient';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { User, AgencyInvitation } from '../types';
import ModelVerifiedBadge from './ModelVerifiedBadge';

interface ModelAgencyInvitationCardProps {
  user: User;
  onUpdated?: () => void;
  variant?: 'banner' | 'card';
}

export default function ModelAgencyInvitationCard({ user, onUpdated, variant = 'banner' }: ModelAgencyInvitationCardProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const ui = useUI();

  const [pendingInvitations, setPendingInvitations] = useState<AgencyInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchInvitations = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch pending invitations where this user is the invited model
      const q = query(
        collection(db, 'agency_invitations'),
        where('modelUserId', '==', currentUser.uid),
        where('status', '==', 'pending')
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as AgencyInvitation[];
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      setPendingInvitations(list);
    } catch (err) {
      console.warn('Could not fetch agency invitations for model:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, [currentUser, user.id, user.modelAgencyName, user.modelVerificationStatus]);

  // Handle Accept Invitation
  const handleAccept = async (invite: AgencyInvitation) => {
    if (!currentUser) return;

    // RULE: A model cannot belong to two agencies!
    if (
      user.hasModelBadge &&
      user.modelAgencyName &&
      user.modelAgencyName.trim().toLowerCase() !== invite.agencyName.trim().toLowerCase()
    ) {
      ui.alert(t('model_member_conflict', { agency: user.modelAgencyName }));
      return;
    }

    if (!await ui.confirm(t('model_accept_question', { agency: invite.agencyName }))) {
      return;
    }

    setProcessingId(invite.id);
    try {
      await updateDoc(doc(db,'agency_invitations',invite.id),{status:'accepted'});

      ui.alert(t('model_joined', { agency: invite.agencyName }));
      setPendingInvitations(prev => prev.filter(i => i.id !== invite.id));
      onUpdated?.();
    } catch (err: any) {
      console.error('Error accepting invitation:', err);
      ui.alert(err instanceof Error ? err.message : t('api_request_failed'));
    } finally {
      setProcessingId(null);
    }
  };

  // Handle Decline Invitation
  const handleDecline = async (invite: AgencyInvitation) => {
    if (!currentUser) return;

    if (!await ui.confirm(t('model_decline_question', { agency: invite.agencyName }))) {
      return;
    }

    setProcessingId(invite.id);
    try {
      await updateDoc(doc(db,'agency_invitations',invite.id),{status:'declined'});

      ui.alert(t('model_declined', { agency: invite.agencyName }));
      setPendingInvitations(prev => prev.filter(i => i.id !== invite.id));
      onUpdated?.();
    } catch (err: any) {
      console.error('Error declining invitation:', err);
      ui.alert(err instanceof Error ? err.message : t('api_request_failed'));
    } finally {
      setProcessingId(null);
    }
  };

  // Handle Leave Agency (Strict Rule: One model can only belong to one agency)
  const handleLeaveAgency = async () => {
    if (!currentUser || !user.modelAgencyName) return;

    if (!await ui.confirm(t('model_leave_question', { agency: user.modelAgencyName }))) {
      return;
    }

    setProcessingId('leave');
    try {
      const response=await apiFetch('/api/agency/remove-model',{method:'POST',body:JSON.stringify({userId:currentUser.uid})});if(!response.ok)throw new Error((await response.json()).error);
      ui.alert(t('model_left', { agency: user.modelAgencyName }));
      onUpdated?.();
    } catch (err: any) {
      console.error('Error leaving agency:', err);
      ui.alert(err instanceof Error ? err.message : t('api_request_failed'));
    } finally {
      setProcessingId(null);
    }
  };

  // If currently confirmed in an agency
  const isConfirmedInAgency = user.hasModelBadge && Boolean(user.modelAgencyName || user.modelVerifiedByAgency);

  // If no invitations and not confirmed in agency, don't show anything unless asked
  if (pendingInvitations.length === 0 && !isConfirmedInAgency) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* 1. ACTIVE PENDING INVITATIONS BANNER */}
      {pendingInvitations.map(invite => (
        <div 
          key={invite.id}
          className="rounded-3xl border-2 border-brand-accent bg-brand-card p-5 sm:p-7 shadow-md relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300"
        >
          {/* Top highlight bar */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-brand-action" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-brand-action text-white text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                  <Building2 size={12} /> {t('model_invitation')}
                </span>
                <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
                  {t('model_invite_wait')}
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark tracking-tight">
                {t('model_invitation_named', { agency: invite.agencyName })}
              </h3>

              <p className="text-xs sm:text-sm text-brand-dark/80 leading-relaxed font-normal">
                {invite.invitedByUserName && (
                  <span className="font-semibold text-brand-dark">
                    {t('model_representative')} {invite.invitedByUserName}.{' '}
                  </span>
                )}
                {t('model_invite_details')}
              </p>

              {/* Exclusivity Warning */}
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] font-mono text-amber-900 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-700" />
                <span>
                  {t('model_one_agency', { agency: invite.agencyName })}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 w-full sm:w-auto">
              <button
                type="button"
                disabled={processingId === invite.id}
                onClick={() => handleAccept(invite)}
                className="bg-brand-action hover:bg-brand-dark text-white px-5 py-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                <Check size={15} />
                <span>{processingId === invite.id ? t('model_confirming') : t('model_accept')}</span>
              </button>

              <button
                type="button"
                disabled={processingId === invite.id}
                onClick={() => handleDecline(invite)}
                className="bg-brand-card hover:bg-red-50 text-red-700 border border-red-200 px-5 py-3 rounded-full text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <X size={15} />
                <span>{t('ui_reject')}</span>
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* 2. CONFIRMED AGENCY AFFILIATION CARD (IF CONFIRMED) */}
      {isConfirmedInAgency && pendingInvitations.length === 0 && (
        <div className="rounded-3xl border border-brand-dark/[0.12] bg-brand-card p-5 sm:p-7 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono uppercase tracking-wider text-brand-dark/60">
                {t('model_verified')}
              </span>
              <ModelVerifiedBadge size="sm" showLabel agencyName={user.modelVerifiedByAgency || user.modelAgencyName} />
            </div>

            <h3 className="text-base sm:text-lg font-serif font-normal text-brand-dark">
              {t('model_agency_label')} <strong className="font-semibold">{user.modelVerifiedByAgency || user.modelAgencyName}</strong>
            </h3>

            <p className="text-xs text-brand-dark/70 max-w-2xl leading-relaxed">
              {t('model_roster_details', { agency: user.modelVerifiedByAgency || user.modelAgencyName })}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              disabled={processingId === 'leave'}
              onClick={handleLeaveAgency}
              className="px-4 py-2 rounded-full border border-red-200 text-red-700 hover:bg-red-50 bg-brand-card font-semibold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title={t('model_leave')}
            >
              <LogOut size={13} />
              <span>{processingId === 'leave' ? t('model_leaving') : t('model_leave')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
