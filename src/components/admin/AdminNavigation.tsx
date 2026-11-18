import { Bell, BarChart3, Building2, CalendarDays, ChevronDown, Gift, Globe, GraduationCap, Handshake, Landmark, LayoutTemplate, Newspaper, ScanLine, Scissors, Sliders, Sparkles, Users, Briefcase } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const groups = [
  { label: 'admin_group_overview', tabs: [
    ['stats', BarChart3], ['users', Users], ['announcements', Bell],
  ] },
  { label: 'admin_group_events', tabs: [
    ['events', CalendarDays], ['ticket_scan', ScanLine], ['giveaways', Gift], ['designer_verifications', Scissors], ['careers', Briefcase],
  ] },
  { label: 'admin_group_catalogues', tabs: [
    ['designers', Scissors], ['agencies', Building2], ['education', GraduationCap], ['sponsors', Handshake], ['sponsorships', Handshake],
  ] },
  { label: 'admin_group_content', tabs: [
    ['homepage_materials', LayoutTemplate], ['news', Newspaper], ['about_us', Landmark], ['socials', Globe], ['site_modules', Sliders], ['ff_ai', Sparkles],
  ] },
] as const;

export default function AdminNavigation({ allowed, selected, onSelect }: {
  allowed: readonly string[];
  selected: string;
  onSelect: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const available = groups.map(group => ({ ...group, tabs: group.tabs.filter(([tab]) => allowed.includes(tab)) }))
    .filter(group => group.tabs.length);

  return (
    <nav aria-label={t('admin_sections')} className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <div className="relative lg:hidden">
        <select value={selected} aria-label={t('admin_sections')} onChange={(event) => onSelect(event.target.value)}
          className="min-h-12 w-full appearance-none rounded-xl border border-brand-border bg-brand-card px-4 pr-12 text-sm font-semibold text-brand-dark focus-visible:outline-brand-accent">
          {available.map(group => (
            <optgroup key={group.label} label={t(group.label)}>
              {group.tabs.map(([tab]) => <option key={tab} value={tab}>{t(`admin_nav_${tab}`)}</option>)}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={17} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-brand-dark/70" />
      </div>
      <div className="hidden max-h-[calc(100dvh-7rem)] space-y-4 overflow-y-auto rounded-2xl border border-brand-border bg-brand-card p-3 lg:block">
        {available.map(group => (
          <section key={group.label}>
            <h2 className="px-2 pb-1 text-[10px] font-mono font-bold uppercase tracking-wider text-brand-dark/60">{t(group.label)}</h2>
            {group.tabs.map(([tab, Icon]) => (
              <button type="button" key={tab} aria-current={selected === tab ? 'page' : undefined} onClick={() => onSelect(tab)}
                className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${selected === tab ? 'bg-brand-action text-white' : 'text-brand-dark/80 hover:bg-brand-muted hover:text-brand-dark'}`}>
                <Icon size={15} aria-hidden="true" className="shrink-0" />
                {t(`admin_nav_${tab}`)}
              </button>
            ))}
          </section>
        ))}
      </div>
    </nav>
  );
}
