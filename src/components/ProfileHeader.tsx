import '../locales/profile';
import { useState, type ReactNode } from 'react';
import { Building2, Crown, Globe, MapPin, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '../types';
import { onboardingQuestions } from '../lib/onboardingQuestions';
import { SecureImage } from './SecureMedia';
import GoldenNeedleBadge from './GoldenNeedleBadge';
import SilverNeedleBadge from './SilverNeedleBadge';
import ModelVerifiedBadge from './ModelVerifiedBadge';

type ProfileHeaderProps = {
  user: Partial<User>;
  posts: number;
  actions: ReactNode;
  onAvatarClick: () => void;
  avatarLabel: string;
};

function websiteLink(value?: string) {
  if (!value) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

export default function ProfileHeader({ user, posts, actions, onAvatarClick, avatarLabel }: ProfileHeaderProps) {
  const { t } = useTranslation();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const name = user.name || t('profile_member');
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase();
  const handle = (user.handle || user.username || '').replace(/^@+/, '');
  const info = user.profileData?.generalInfo;
  const industryKey = onboardingQuestions.industry.options.find(([value]) => value === user.industry)?.[1];
  const headline = info?.headline || (industryKey ? t(industryKey) : '');
  const bio = info?.bio || user.bio;
  const website = websiteLink(info?.website || user.links);
  const agency = user.representedAgencyName;
  const modelAgency = user.modelVerifiedByAgency || user.modelAgencyName;
  const tier = user.subscriptionTier;
  const subscriptionLabel = tier === 'elite' || tier === 'vip' ? 'FFAZ ELITE VIP'
    : tier && !['free', 'guest'].includes(tier) ? 'FFAZ ' + tier.toUpperCase() : '';
  const hasBadges = user.hasGoldenNeedle || user.hasSilverNeedle || user.silverNeedleStatus === 'approved'
    || user.hasModelBadge || agency || subscriptionLabel || ['admin', 'superadmin'].includes(user.role || '');

  return (
    <section aria-labelledby="profile-display-name" className="overflow-hidden rounded-[28px] border border-brand-dark/[0.08] bg-brand-card shadow-[0_6px_30px_-20px_rgba(0,0,0,0.12)]">
      <div className="grid gap-x-6 gap-y-4 p-5 min-[380px]:grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-7 lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-x-8 lg:p-8">
        <button type="button" onClick={onAvatarClick} aria-label={avatarLabel}
          className="group row-start-1 grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-brand-card bg-brand-muted ring-1 ring-brand-dark/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent sm:row-span-2 sm:h-28 sm:w-28 lg:h-32 lg:w-32">
          {user.avatarUrl && failedAvatar !== user.avatarUrl ? (
            <SecureImage src={user.avatarUrl} alt={name} onError={() => setFailedAvatar(user.avatarUrl || null)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" crossOrigin="anonymous" />
          ) : <span aria-hidden className="font-display text-3xl font-semibold tracking-tight text-brand-dark/65">{initials}</span>}
        </button>

        <div className="min-w-0 min-[380px]:col-start-2 min-[380px]:row-start-1">
          {handle && <p className="mb-2 break-all font-mono text-xs text-brand-dark/65">@{handle}</p>}
          <h1 id="profile-display-name" className="break-words font-display text-[1.75rem] font-semibold leading-[1.12] tracking-[-0.035em] text-brand-dark sm:text-4xl lg:text-[2.5rem]">{name}</h1>
          {headline && <p className="mt-2 break-words text-sm text-brand-dark/75">{headline}</p>}
        </div>

        {hasBadges && (
          <div aria-label={t('profile_statuses')} className="flex min-w-0 flex-wrap items-center gap-2 text-xs [&>span]:rounded-full [&>span]:border [&>span]:border-brand-dark/[0.07] [&>span]:bg-brand-muted/45 [&>span]:px-2.5 [&>span]:py-1.5 min-[380px]:col-span-2 sm:col-span-1 sm:col-start-2">
            {user.hasGoldenNeedle && <span className="inline-flex items-center gap-1.5"><GoldenNeedleBadge size="sm" /><span>{t('profile_golden_needle')}</span></span>}
            {(user.hasSilverNeedle || user.silverNeedleStatus === 'approved') && <span className="inline-flex items-center gap-1.5"><SilverNeedleBadge size="sm" /><span>{t('profile_silver_needle')}</span></span>}
            {user.hasModelBadge && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ModelVerifiedBadge size="sm" />
                <span className="break-words">{modelAgency || t('profile_verified')}</span>
              </span>
            )}
            {agency && <span className="inline-flex min-w-0 items-center gap-1.5"><Building2 size={15} className="shrink-0 text-brand-accent" aria-hidden /><span className="break-words">{agency}</span></span>}
            {subscriptionLabel && <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold"><Crown size={14} className="shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />{subscriptionLabel}</span>}
            {['admin', 'superadmin'].includes(user.role || '') && <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="shrink-0 text-brand-accent" aria-hidden />{t('profile_official')}</span>}
          </div>
        )}

        {(bio || info?.location || website) && (
          <div className="min-w-0 min-[380px]:col-span-2 sm:col-span-1 sm:col-start-2 space-y-2">
            {bio && <p className="max-w-3xl whitespace-pre-line break-words text-sm leading-relaxed text-brand-dark/80">{bio}</p>}
            {(info?.location || website) && (
              <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-xs text-brand-dark/70">
                {info?.location && <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin size={14} className="shrink-0" aria-hidden /><span className="break-words">{info.location}</span></span>}
                {website && <a href={website.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 hover:text-brand-accent">
                  <Globe size={14} className="shrink-0" aria-hidden /><span className="break-all">{website.hostname}{website.pathname === '/' ? '' : website.pathname}</span>
                </a>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-4 border-t border-brand-dark/[0.07] bg-brand-muted/20 p-5 sm:px-7 lg:flex lg:items-center lg:justify-between lg:gap-6 lg:px-8">
        <dl className="grid grid-cols-3 gap-2 sm:w-fit sm:gap-8">
          {[
            [posts, 'posts_stat'],
            [user.followers?.length || 0, 'followers_stat'],
            [user.following?.length || 0, 'following_stat'],
          ].map(([count, key]) => (
            <div key={key} className="min-w-0">
              <dt className="break-words text-[10px] sm:text-[11px] text-brand-dark/65">{t(String(key))}</dt>
              <dd className="mt-0.5 font-mono text-lg font-bold text-brand-dark">{count}</dd>
            </div>
          ))}
        </dl>
        <div className="flex min-w-0 flex-wrap items-stretch gap-2 [&>*]:min-h-11 [&>*]:flex-1 [&>*]:rounded-full [&>*]:border-brand-dark/15 [&>*]:px-4 sm:[&>*]:flex-none">{actions}</div>
      </div>
    </section>
  );
}
