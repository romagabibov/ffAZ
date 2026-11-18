import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

function FailedSection({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <section role="alert" className="mx-auto my-10 max-w-xl space-y-4 rounded-3xl border border-brand-dark/10 bg-brand-card p-6 text-brand-dark">
      <h1 className="font-serif text-2xl">{t('section_error_title')}</h1>
      <p className="text-sm text-brand-dark/70">{t('section_error_description')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={retry} className="brand-button min-h-11">{t('section_error_retry')}</button>
        <Link to="/" className="brand-button-outline min-h-11">{t('nav_home')}</Link>
      </div>
    </section>
  );
}

export default class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ui] Section render failed', error.name);
  }

  render() {
    return this.state.failed ? <FailedSection retry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
