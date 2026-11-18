import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EventScheduleItem } from '../../types';
import { eventProgrammeLimits as limits } from '../../lib/eventProgramme';

type Programme = {
  schedule: EventScheduleItem[];
  dressCode: string;
  admissionRules: string;
};

const field = 'min-h-11 w-full rounded-xl border border-brand-dark/15 bg-brand-card px-3 py-2 text-sm text-brand-dark focus:outline-none focus:border-brand-accent';
const caption = 'block mb-1.5 text-xs font-semibold text-brand-dark/75';

export default function EventProgrammeFields({
  value, onChange,
}: {
  value: Programme;
  onChange: (patch: Partial<Programme>) => void;
}) {
  const { t } = useTranslation();
  function updateRow(index: number, patch: Partial<EventScheduleItem>) {
    onChange({ schedule: value.schedule.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) });
  }
  return (
    <div className="grid gap-5">
      <fieldset className="min-w-0 rounded-2xl border border-brand-dark/12 bg-brand-muted/20 p-4 sm:p-5">
        <legend className="px-2 font-display text-sm font-bold text-brand-dark">{t('event_timeline')}</legend>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-xs leading-relaxed text-brand-dark/70">{t('admin_event_schedule_hint')}</p>
          <button type="button" disabled={value.schedule.length >= limits.rows}
            onClick={() => onChange({ schedule: [...value.schedule, { time: '', title: '', description: '' }] })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand-dark/15 px-3.5 text-xs font-semibold hover:border-brand-accent hover:text-brand-accent disabled:opacity-50">
            <Plus size={15} aria-hidden />{t('admin_event_add_schedule')}
          </button>
        </div>
        <div className="space-y-3">
          {value.schedule.map((row, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-end gap-2 rounded-xl border border-brand-dark/10 p-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)_2.75rem]">
              <label className="min-w-0">
                <span className={caption}>{t('admin_event_schedule_time')}</span>
                <input className={field} type="time" required value={row.time}
                  onChange={event => updateRow(index, { time: event.target.value })} />
              </label>
              <label className="row-start-2 col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <span className={caption}>{t('admin_event_schedule_title')}</span>
                <input className={field} type="text" required maxLength={limits.title} value={row.title}
                  onChange={event => updateRow(index, { title: event.target.value })} />
              </label>
              <button type="button" onClick={() => onChange({ schedule: value.schedule.filter((_, rowIndex) => rowIndex !== index) })}
                aria-label={t('admin_event_remove_schedule', { number: index + 1 })}
                className="col-start-2 row-start-1 flex h-11 w-11 items-center justify-center rounded-full border border-brand-dark/10 hover:text-brand-accent sm:col-start-3">
                <Trash2 size={16} aria-hidden />
              </button>
              <label className="col-span-full min-w-0">
                <span className={caption}>{t('admin_event_schedule_note')}</span>
                <input className={field} type="text" maxLength={limits.description} value={row.description || ''}
                  onChange={event => updateRow(index, { description: event.target.value })} />
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 rounded-2xl border border-brand-dark/12 bg-brand-muted/20 p-4 sm:p-5">
        <legend className="px-2 font-display text-sm font-bold text-brand-dark">{t('event_admission_policy')}</legend>
        <label className="block">
          <span className={caption}>{t('event_dress_code')}</span>
          <input className={field} type="text" maxLength={limits.dressCode} value={value.dressCode}
            onChange={event => onChange({ dressCode: event.target.value })} />
        </label>
        <label className="block">
          <span className={caption}>{t('admin_event_entry_rules')}</span>
          <textarea className={field + ' resize-y leading-relaxed'} rows={3} maxLength={limits.admissionRules} value={value.admissionRules}
            onChange={event => onChange({ admissionRules: event.target.value })} />
        </label>
      </fieldset>
    </div>
  );
}
