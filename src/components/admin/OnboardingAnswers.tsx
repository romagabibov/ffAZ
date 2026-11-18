import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/apiClient';
import { onboardingQuestions, type OnboardingStats } from '../../lib/onboardingQuestions';

export default function OnboardingAnswers() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<OnboardingStats>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const format = new Intl.NumberFormat(i18n.resolvedLanguage);

  async function loadAnswers() {
    setLoading(true);
    setFailed(false);
    try {
      const response = await apiFetch('/api/admin/onboarding-stats');
      if (!response.ok) throw new Error('Could not load onboarding statistics');
      setData(await response.json());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-border bg-brand-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-brand-dark sm:text-2xl">{t('admin_onboarding_title')}</h2>
          {data && <p className="mt-1 text-sm text-brand-dark/70">{t('admin_onboarding_completed', { total: format.format(data.completed) })}</p>}
        </div>
        <button type="button" className="brand-button-outline min-h-11" onClick={loadAnswers} disabled={loading}>
          {loading ? t('ui_loading') : data ? t('ui_refresh') : t('admin_onboarding_load')}
        </button>
      </div>
      {failed && <p role="alert" className="mt-3 text-sm text-brand-accent">{t('admin_load_failed')}</p>}
      {data && (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {Object.entries(onboardingQuestions).map(([field, question]) => {
            const counts = data.counts[field as keyof OnboardingStats['counts']];
            const answered = Object.values(counts).reduce((sum, count) => sum + count, 0);
            return (
              <section key={field} className="rounded-xl border border-brand-border bg-brand-muted/30 p-3.5 sm:p-4">
                <header className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
                  <h3 className="text-sm font-semibold text-brand-dark">{t(question.label)}</h3>
                  <span className="text-xs text-brand-dark/65">{t('admin_onboarding_responses', { total: format.format(answered) })}</span>
                </header>
                <ul className="space-y-2.5">
                  {question.options.map(([value, label]) => {
                    const count = counts[value] || 0;
                    return (
                      <li key={value}>
                        <div className="flex items-baseline justify-between gap-2 text-xs text-brand-dark">
                          <span>{t(label)}</span><span className="font-mono tabular-nums">{format.format(count)}</span>
                        </div>
                        <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-dark/10">
                          <div className="h-full rounded-full bg-brand-accent" style={{ width: `${answered ? 100 * count / answered : 0}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.completed > answered && <p className="mt-3 text-xs text-brand-dark/60">{t('admin_onboarding_unrecorded', { total: format.format(data.completed - answered) })}</p>}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
