import type { Firestore } from 'firebase-admin/firestore';
import { eventEndMillis, getTimestampMillis } from '../lib/dateUtils.js';
import { ticketQrPattern, type CheckInResult } from '../lib/ticketCheckIn.js';
import { fail, hash, id } from './security.js';

export function checkInTicket(db: Firestore, uid: string, event: unknown, token: unknown): Promise<CheckInResult> {
  const eventId = id(event);
  if (typeof token !== 'string' || !ticketQrPattern.test(token)) {
    return fail(400, 'Этот QR не подходит для прохода по билету', 'ticket_scan_invalid');
  }
  return db.runTransaction(async tx => {
    const staff = await tx.get(db.doc(`users/${uid}`));
    if (!['admin', 'superadmin', 'ticket_editor'].includes(staff.get('role'))) {
      return fail(403, 'У аккаунта нет доступа к проверке билетов', 'ticket_scan_denied');
    }
    const show = (await tx.get(db.doc(`events/${eventId}`))).data();
    if (!show) return fail(404, 'Мероприятие больше недоступно', 'ticket_scan_event_missing');
    const at = Date.now();
    const end = eventEndMillis(show);
    if (show.status === 'cancelled' || (end && end <= at)) {
      return fail(409, 'Проход на это мероприятие закрыт', 'ticket_scan_event_closed');
    }
    const matches = await tx.get(db.collection('tickets').where('qrTokenHash', '==', hash(token)).limit(2));
    if (matches.size !== 1) return fail(404, 'Билет по этому QR не найден', 'ticket_scan_not_found');
    const ticket = matches.docs[0];
    if (ticket.get('eventId') !== eventId) return fail(409, 'Билет на другое мероприятие', 'ticket_scan_wrong_event');
    const expiry = getTimestampMillis(ticket.get('expiresAt'));
    const kind = ticket.get('ticketType') === 'giveaway' ? 'giveaway' : 'standard';
    if (ticket.get('status') === 'used') {
      return { status: 'already_used', kind, usedAt: getTimestampMillis(ticket.get('usedAt')) || null };
    }
    if (ticket.get('status') !== 'active' || (expiry && expiry <= at)) {
      return fail(409, 'Этот билет больше не действует', 'ticket_scan_inactive');
    }
    tx.update(ticket.ref, { status: 'used', usedAt: at, usedBy: uid });
    return { status: 'checked_in', kind, usedAt: at };
  });
}
