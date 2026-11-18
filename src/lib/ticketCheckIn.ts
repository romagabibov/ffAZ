export const ticketQrPattern = /^[A-Za-z0-9_-]{43}$/;

export type CheckInResult = {
  status: 'checked_in' | 'already_used';
  kind: 'standard' | 'giveaway';
  usedAt: number | null;
};
