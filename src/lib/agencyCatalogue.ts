import { DEFAULT_AGENCIES } from '../data/defaultAgencies.js';

export const defaultAgencyTargets = DEFAULT_AGENCIES.map(agency => ({
  id: 'default:' + agency.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
  name: agency.name,
}));

export function agencyNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
}
