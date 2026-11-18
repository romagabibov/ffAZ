import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, collection, getDocs, updateDoc, addDoc, serverTimestamp } from '../lib/firestoreClient';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_AGENCIES } from '../data/defaultAgencies';
import { DEFAULT_DESIGNERS } from '../data/defaultDesigners';
import { Sparkles, Building2, User, ShieldCheck, Scissors, Award, Check, Upload, FileText, Phone, MapPin, Globe, Instagram } from 'lucide-react';
import ModelVerifiedBadge from '../components/ModelVerifiedBadge';
import AgencyBadge from '../components/AgencyBadge';
import GoldenNeedleBadge from '../components/GoldenNeedleBadge';
import { uploadMediaFile } from '../lib/upload';
import { useTranslation } from 'react-i18next';
import { loadPublicDesigners } from '../lib/publicSite';
import { onboardingQuestions } from '../lib/onboardingQuestions';

export default function Onboarding() {
 const { t } = useTranslation();
 const { currentUser, dbUser, loading: authLoading } = useAuth();
 const navigate = useNavigate();

 const [industry, setIndustry] = useState('');
 const [degree, setDegree] = useState('');
 const [interestLevel, setInterestLevel] = useState('');
 const [ageGroup, setAgeGroup] = useState('');
 const [primaryGoal, setPrimaryGoal] = useState('');

 // Model & Agency fields
 const [agenciesList, setAgenciesList] = useState<Array<{ id?: string; name: string }>>([]);
 const [selectedAgency, setSelectedAgency] = useState('');
 const [customAgencyName, setCustomAgencyName] = useState('');

 // Agency representative specific fields
 const [agencyRole, setAgencyRole] = useState('director');

 // Designer specific fields
 const [designersList, setDesignersList] = useState<Array<{ id?: string; name: string; designerName?: string }>>([]);
 const [selectedDesignerBrand, setSelectedDesignerBrand] = useState('');
 const [customDesignerBrandName, setCustomDesignerBrandName] = useState('');
 const [designerRole, setDesignerRole] = useState('Creative Director / Head Designer');

 const [submitting, setSubmitting] = useState(false);

 useEffect(() => {
   if (authLoading) return;
   if (!currentUser) navigate('/login');
   else if (dbUser?.onboardingComplete && !submitting) navigate('/');
 }, [authLoading, currentUser, dbUser?.onboardingComplete, submitting, navigate]);

 useEffect(() => {
   if (authLoading || !currentUser || dbUser?.onboardingComplete) return;
   let active = true;
   if (['model', 'agency', 'agency_rep'].includes(industry)) {
     const fallback = DEFAULT_AGENCIES.map(a => ({ name: a.name }));
     void getDocs(collection(db, 'agencies')).then(snapshot => {
       if (active) setAgenciesList(snapshot.empty ? fallback : snapshot.docs.map(d => ({ id: d.id, name: d.data().name })));
     }).catch(() => {
       if (active) setAgenciesList(fallback);
     });
   } else if (['fashion_design', 'designer'].includes(industry)) {
     void loadPublicDesigners().then(list => {
       if (!active) return;
       const options = list?.length ? list.map(d => ({ id: d.id, name: d.name, designerName: d.founder })) : DEFAULT_DESIGNERS;
       setDesignersList([...options].sort((a, b) => a.name.localeCompare(b.name, 'az')));
     });
   }
   return () => { active = false; };
 }, [authLoading, currentUser, dbUser?.onboardingComplete, industry]);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!currentUser) return;
 setSubmitting(true);

 try {
 const isModelSelected = industry === 'model';
 const isAgencySelected = industry === 'agency' || industry === 'agency_rep';
 const isDesignerSelected = industry === 'fashion_design' || industry === 'designer';

 let resolvedAgencyName = '';
 let resolvedAgencyId = '';

 if (isModelSelected || isAgencySelected) {
 if (selectedAgency === '__custom__') {
 resolvedAgencyName = customAgencyName.trim();
 } else if (selectedAgency === '__freelance__') {
 resolvedAgencyName = 'Freelance / Независимая';
 } else if (selectedAgency) {
 resolvedAgencyName = selectedAgency;
 const match = agenciesList.find(a => a.name === selectedAgency);
 if (match?.id) resolvedAgencyId = match.id;
 }
 }

 let resolvedDesignerBrandName = '';
 let resolvedDesignerId = '';

 if (isDesignerSelected) {
 if (selectedDesignerBrand === '__custom__') {
 resolvedDesignerBrandName = customDesignerBrandName.trim();
 } else if (selectedDesignerBrand) {
 resolvedDesignerBrandName = selectedDesignerBrand;
 const match = designersList.find(d => d.name === selectedDesignerBrand);
 if (match?.id) resolvedDesignerId = match.id;
 }
 }

 const updatePayload: Record<string, any> = {
 onboardingComplete: true,
 industry,
 degree,
 interestLevel,
 ageGroup,
 primaryGoal
 };

 if (isModelSelected) {
 updatePayload.isModel = true;
 updatePayload.declaredModelAgencyName = resolvedAgencyName || 'Freelance';
 

 } else if (isAgencySelected) {
 updatePayload.isAgency = true;


 updatePayload.declaredAgencyName = resolvedAgencyName || '';

 updatePayload.declaredAgencyRole = agencyRole;
 } else if (isDesignerSelected) {
 updatePayload.isDesigner = true;
 updatePayload.designerBrandName = resolvedDesignerBrandName || '';
 updatePayload.brandName = resolvedDesignerBrandName || '';
 if (resolvedDesignerId) updatePayload.declaredDesignerId = resolvedDesignerId;
 updatePayload.declaredDesignerRole = designerRole;

 }

    const userDocRef = doc(db, 'users', currentUser.uid);
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) {
      await setDoc(userDocRef, {
        name: currentUser.displayName || 'Fashionista',
        role: 'user',
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        lastActiveAt: Date.now(),
        onboardingComplete: false
      });
    }
    await updateDoc(userDocRef, updatePayload);
 
 if (isDesignerSelected) {
 navigate('/dashboard?tab=designer');
 } else if (isAgencySelected) {
 navigate('/dashboard?tab=agency-models');
 } else if (isModelSelected) {
 navigate('/dashboard?tab=model');
 } else {
 navigate('/');
 }
 } catch (err) {
 handleFirestoreError(err, OperationType.UPDATE, 'users');
 } finally {
 setSubmitting(false);
 }
 };

 if (!currentUser) return null;

 return (
 <div className="flex justify-center items-center py-12 px-4 animate-in fade-in duration-700 bg-brand-light min-h-[calc(100vh-80px)]">
 <div className="w-full max-w-2xl bg-brand-light border-4 border-brand-dark p-6 sm:p-10 md:p-12">
 <div className="flex items-center gap-2 mb-3">
 <span className="bg-brand-accent text-white px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest font-mono">
 {t('onboarding_label')}
 </span>
 <span className="text-xs font-mono font-bold text-brand-dark/60">
 Azerbaijan Fashion Future
 </span>
 </div>

 <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold uppercase tracking-tighter mb-3 text-brand-dark">
 {t('onboarding_title')}
 </h1>
 <p className="text-brand-dark/70 font-bold uppercase tracking-widest text-xs sm:text-sm mb-8 border-b-2 border-brand-dark pb-6">
 {t('onboarding_intro')}
 </p>

 <form onSubmit={handleSubmit} className="space-y-6">
 {/* Industry Selection */}
 <div className="space-y-2">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold flex items-center justify-between">
 <span>{t('onboarding_industry')}</span>
 <span className="text-[10px] text-brand-accent font-mono font-bold">{t('ui_required')}</span>
 </label>
 <select
 required
 value={industry}
 onChange={e => setIndustry(e.target.value)}
 className="w-full bg-transparent border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent uppercase tracking-widest text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_select_industry')}</option>
 {onboardingQuestions.industry.options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
 </select>
 </div>

 {/* If Model is selected: Ask for Agency with choice or custom input */}
 {industry === 'model' && (
 <div className="p-5 bg-brand-muted/60 border-2 border-brand-dark space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
 <div className="flex items-center justify-between">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold flex items-center gap-1.5">
 <Building2 size={16} className="text-brand-accent" />
 {t('onboarding_model_agency')}
 </label>
 <ModelVerifiedBadge size="xs" />
 </div>
 <p className="text-xs text-brand-dark/70 font-semibold">
 {t('onboarding_model_agency_desc')} <strong className="text-brand-dark">😎</strong>.
 </p>

 <div className="space-y-2">
 <select
 required
 value={selectedAgency}
 onChange={e => setSelectedAgency(e.target.value)}
 className="w-full bg-brand-card border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_choose_agency')}</option>
 {agenciesList.map((ag, idx) => (
 <option key={ag.id || idx} value={ag.name}>
 {ag.name}
 </option>
 ))}
 <option value="__custom__">{t('onboarding_other_agency')}</option>
 <option value="__freelance__">{t('onboarding_independent')}</option>
 </select>
 </div>

 {selectedAgency === '__custom__' && (
 <div className="space-y-1.5 animate-in fade-in duration-200">
 <label className="text-[11px] uppercase tracking-wider font-bold text-brand-dark">
 {t('onboarding_agency_name')}
 </label>
 <input
 type="text"
 required
 value={customAgencyName}
 onChange={e => setCustomAgencyName(e.target.value)}
 placeholder="Например: Elite Models, Grace Model Agency..."
 className="w-full bg-brand-card border-2 border-brand-dark p-3 text-sm font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
 />
 </div>
 )}
 </div>
 )}

 {/* If Agency or Agency Representative is selected */}
 {(industry === 'agency' || industry === 'agency_rep') && (
 <div className="p-5 bg-[#fff8f8] border-2 border-brand-accent space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-brand-accent/20">
 <label className="text-xs uppercase tracking-widest text-brand-accent font-bold flex items-center gap-1.5">
 <Building2 size={16} className="text-brand-accent" />
 {t('onboarding_register_agency')}
 </label>
 <AgencyBadge size="xs" showLabel agencyName="Model Agency" />
 </div>
 <div className="p-3 bg-brand-card border border-brand-accent/30 text-xs text-brand-dark leading-relaxed font-semibold">
 🏢 <strong>{t('onboarding_agency_review')}</strong> {t('onboarding_agency_review_desc')}
 </div>

 <div className="space-y-2">
 <select
 required
 value={selectedAgency}
 onChange={e => setSelectedAgency(e.target.value)}
 className="w-full bg-brand-card border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_choose_agency')}</option>
 {agenciesList.map((ag, idx) => (
 <option key={ag.id || idx} value={ag.name}>
 🏢 {ag.name}
 </option>
 ))}
 <option value="__custom__">{t('onboarding_other_agency')}</option>
 </select>
 </div>

 {selectedAgency === '__custom__' && (
 <div className="space-y-1.5 animate-in fade-in duration-200">
 <label className="text-[11px] uppercase tracking-wider font-bold text-brand-dark">
 {t('onboarding_agency_name')}
 </label>
 <input
 type="text"
 required
 value={customAgencyName}
 onChange={e => setCustomAgencyName(e.target.value)}
 placeholder="Например: Venera Models, NL Model Management..."
 className="w-full bg-brand-card border-2 border-brand-dark p-3 text-sm font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
 />
 </div>
 )}

 <div className="space-y-1.5">
 <label className="text-[11px] uppercase tracking-wider font-bold text-brand-dark">
 {t('onboarding_agency_role')}
 </label>
 <select
 value={agencyRole}
 onChange={e => setAgencyRole(e.target.value)}
 className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold uppercase tracking-wider"
 >
 <option value="director">{t('onboarding_director')}</option>
 <option value="booker">{t('onboarding_booker')}</option>
 <option value="scout">{t('onboarding_model_scout')}</option>
 <option value="manager">{t('onboarding_manager')}</option>
 </select>
 </div>
 </div>
 )}

 {/* If Fashion Designer is selected */}
 {(industry === 'fashion_design' || industry === 'designer') && (
 <div className="p-5 bg-brand-muted/60 border-2 border-brand-accent space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-brand-accent/20">
 <label className="text-xs uppercase tracking-widest text-brand-accent font-bold flex items-center gap-1.5">
 <Scissors size={16} className="text-brand-accent" />
 {t('onboarding_register_brand')}
 </label>
 <GoldenNeedleBadge size="xs" showLabel />
 </div>
 <div className="p-3 bg-brand-card border border-brand-accent/30 text-xs text-brand-dark leading-relaxed font-semibold">
 🪡 <strong>{t('onboarding_designer_review')}</strong> {t('onboarding_designer_review_desc')}
 </div>

 <div className="space-y-2">
 <select
 required
 value={selectedDesignerBrand}
 onChange={e => setSelectedDesignerBrand(e.target.value)}
 className="w-full bg-brand-card border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_choose_brand')}</option>
 {designersList.map((des, idx) => (
 <option key={des.id || idx} value={des.name}>
 🪡 {des.name} {des.designerName ? `(${des.designerName})` : ''}
 </option>
 ))}
 <option value="__custom__">{t('onboarding_new_brand')}</option>
 </select>
 </div>

 {selectedDesignerBrand === '__custom__' && (
 <div className="space-y-1.5 animate-in fade-in duration-200">
 <label className="text-[11px] uppercase tracking-wider font-bold text-brand-dark">
 {t('onboarding_brand_name')}
 </label>
 <input
 type="text"
 required
 value={customDesignerBrandName}
 onChange={e => setCustomDesignerBrandName(e.target.value)}
 placeholder="Например: Atelier Baku, Maison De Soie..."
 className="w-full bg-brand-card border-2 border-brand-dark p-3 text-sm font-bold text-brand-dark focus:outline-none focus:border-brand-accent"
 />
 </div>
 )}

 <div className="space-y-1.5">
 <label className="text-[11px] uppercase tracking-wider font-bold text-brand-dark">
 {t('onboarding_brand_role')}
 </label>
 <select
 value={designerRole}
 onChange={e => setDesignerRole(e.target.value)}
 className="w-full bg-brand-card border-2 border-brand-dark p-2.5 text-xs font-bold uppercase tracking-wider"
 >
 <option value="Creative Director / Head Designer">{t('onboarding_creative_director')}</option>
 <option value="Founder / Brand Owner">{t('onboarding_founder')}</option>
 <option value="Fashion Designer">{t('onboarding_designer')}</option>
 <option value="Couturier / Master Tailor">{t('onboarding_couturier')}</option>
 </select>
 </div>
 </div>
 )}

 {/* Education Level */}
 <div className="space-y-2">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold">
 {t('onboarding_degree')}
 </label>
 <select
 required
 value={degree}
 onChange={e => setDegree(e.target.value)}
 className="w-full bg-transparent border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent uppercase tracking-widest text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_select_degree')}</option>
 {onboardingQuestions.degree.options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
 </select>
 </div>

 {/* Interest Level */}
 <div className="space-y-2">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold">
 {t('onboarding_interest')}
 </label>
 <select
 required
 value={interestLevel}
 onChange={e => setInterestLevel(e.target.value)}
 className="w-full bg-transparent border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent uppercase tracking-widest text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_select_interest')}</option>
 {onboardingQuestions.interestLevel.options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
 </select>
 </div>

 {/* Age Group */}
 <div className="space-y-2">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold">
 {t('onboarding_age')}
 </label>
 <select
 required
 value={ageGroup}
 onChange={e => setAgeGroup(e.target.value)}
 className="w-full bg-transparent border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent uppercase tracking-widest text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_select_age')}</option>
 {onboardingQuestions.ageGroup.options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
 </select>
 </div>

 {/* Primary Goal */}
 <div className="space-y-2">
 <label className="text-xs uppercase tracking-widest text-brand-dark font-bold">
 {t('onboarding_goal')}
 </label>
 <select
 required
 value={primaryGoal}
 onChange={e => setPrimaryGoal(e.target.value)}
 className="w-full bg-transparent border-2 border-brand-dark p-3 focus:outline-none focus:border-brand-accent uppercase tracking-widest text-sm font-bold cursor-pointer"
 >
 <option value="" disabled>{t('onboarding_select_goal')}</option>
 {onboardingQuestions.primaryGoal.options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
 </select>
 </div>

 <button
 type="submit"
 disabled={submitting}
 className="w-full bg-brand-dark text-brand-light border-2 border-brand-dark px-4 py-5 font-bold uppercase tracking-widest hover:bg-brand-accent hover:border-brand-accent hover:translate-x-1 hover:translate-y-1 transition-all mt-4 disabled:opacity-50 cursor-pointer"
 >
 {submitting ? 'Saving Profile...' : 'Complete Setup'}
 </button>
 </form>
 </div>
 </div>
 );
}
