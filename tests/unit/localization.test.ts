import { describe, expect, it } from 'vitest';
import i18n, { siteLanguages } from '../../src/i18n';

describe('AZ, RU and EN copy', () => {
  it('registers complete translations with identical interpolation arguments for the updated screens', async () => {
    const baseKeys = new Set(Object.keys(i18n.getResourceBundle('en', 'translation')));
    await Promise.all([
      import('../../src/locales/messages'),
      import('../../src/locales/plans'),
      import('../../src/locales/dashboard'),
      import('../../src/locales/agency'),
      import('../../src/locales/designer'),
      import('../../src/locales/model'),
      import('../../src/locales/profile'),
      import('../../src/locales/events'),
      import('../../src/locales/catalogues'),
      import('../../src/locales/inspector'),
      import('../../src/locales/activity'),
    ]);
    const placeholders = (text: string) => Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), match => match[1]).sort();
    const newKeys = Object.keys(i18n.getResourceBundle('en', 'translation')).filter(key => !baseKeys.has(key));
    expect(newKeys.length).toBeGreaterThan(100);
    for (const key of newKeys) {
      const values = siteLanguages.map(language => i18n.getResource(language, 'translation', key));
      expect(values.every(value => typeof value === 'string' && value.trim().length > 0), key).toBe(true);
      expect(values.map(placeholders), key).toEqual([placeholders(values[0]), placeholders(values[0]), placeholders(values[0])]);
    }
    expect(i18n.getFixedT('az')('agency_switch_current', { agency: 'LN Models' })).toBe('Cari agentlik · LN Models');
    expect(i18n.getFixedT('en')('ticket_scan_wrong_event')).toBe('This ticket is for a different event.');
    expect(i18n.getFixedT('ru')('chat_request_named', { name: 'Alex' })).toContain('Alex');
  });
});
