import React from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

export default function Legal() {
 const location = useLocation();
 const { t } = useTranslation();
 const privacy = location.pathname === '/privacy';
 const terms = location.pathname === '/terms';
 const title = t(privacy ? 'legal_privacy_title' : terms ? 'nav_terms' : 'nav_cookies');

 return (
 <div className="animate-in fade-in duration-700 bg-brand-light min-h-screen py-8 sm:py-16 px-3 sm:px-6 md:px-8">
 <div className="max-w-4xl mx-auto card-brutal p-6 sm:p-10 md:p-16 border-3 sm:border-4 border-brand-dark bg-brand-light">
 <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold uppercase tracking-tighter text-brand-dark mb-6 sm:mb-12 border-b-2 sm:border-b-4 border-brand-dark pb-4 sm:pb-8 break-words">
 {title}
 </h1>
 <div className="text-brand-dark font-bold leading-relaxed space-y-4 sm:space-y-6 uppercase tracking-wider text-xs sm:text-sm break-words">
 {privacy ? (
   <>
     <p>{t('legal_privacy_use')}</p>
     <p>{t('legal_privacy_storage')}</p>
     <p>{t('identity_retention_notice')}</p>
     <p>{t('legal_privacy_contact')}</p>
   </>
 ) : <p>{t(terms ? 'legal_terms_content' : 'legal_cookies_content')}</p>}
 </div>
 </div>
 </div>
 );
}
