import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { eventEndMillis, ticketRetention } from "../lib/dateUtils.js";
import { heldTicketCount } from "./tickets.js";

export async function maintainEventRecords(db: Firestore, at = Date.now()) {
  const events = db.collection("events");
  const queries = [
    events.where("date", ">=", 0).where("date", "<=", Math.floor(at / 1000)),
    events.where("date", ">=", 10_000_000_000).where("date", "<=", at),
    events.where("date", ">=", Timestamp.fromMillis(0)).where("date", "<=", Timestamp.fromMillis(at)),
    events.where("date", ">=", "1900").where("date", "<=", new Date(at).toISOString()),
  ];
  const pages = await Promise.all(queries.map((query) => query.limit(24).get()));
  const candidates = pages.flatMap((page) => page.docs)
    .filter((event) => { const end = eventEndMillis(event.data()); return end > 0 && end <= at; })
    .slice(0, 8);

  const archived = await Promise.all(candidates.map((candidate) => db.runTransaction(async (transaction) => {
    const event = (await transaction.get(candidate.ref)).data();
    if (!event) return 0;
    const end = eventEndMillis(event);
    if (!end || end > at || await heldTicketCount(db, transaction, candidate.id, at) > 0) return 0;

    let tickets = db.collection("tickets").where("eventId", "==", candidate.id).orderBy("__name__").limit(80);
    if (typeof event.ticketRetentionCursor === "string") tickets = tickets.startAfter(event.ticketRetentionCursor);
    const page = await transaction.get(tickets);
    const [holdPage, entryPage] = page.size < 80 ? await Promise.all([
      transaction.get(candidate.ref.collection("ticketHolds").limit(60)),
      transaction.get(db.collection("giveaway_entries").where("eventId", "==", candidate.id).limit(60)),
    ]) : [null, null];
    const retention = ticketRetention(end);
    for (const ticket of page.docs) transaction.update(ticket.ref, retention);
    if (page.size === 80) {
      transaction.update(candidate.ref, { ticketRetentionCursor: page.docs.at(-1)!.id });
      return 0;
    }
    for (const hold of holdPage?.docs || []) {
      transaction.delete(hold.ref);
    }
    const expiredOrders = new Set((holdPage?.docs || []).map(hold => hold.get("orderKey") || hold.id));
    for (const key of expiredOrders) transaction.delete(db.doc(`ticketReservations/${key}`));
    for (const entry of entryPage?.docs || []) transaction.delete(entry.ref);
    if (holdPage?.size === 60 || entryPage?.size === 60) return 0;
    transaction.delete(candidate.ref);
    return 1;
  })));

  await backfillLegacyTicketDates(db);
  const dueTickets = await db.collection("tickets").where("expiresAt", "<=", at).limit(100).get();
  const removedTickets = dueTickets.empty ? 0 : await db.runTransaction(async transaction => {
    const rows = await transaction.getAll(...dueTickets.docs.map(row => row.ref));
    const events = [...new Set(rows.map(row => row.get("eventId")).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_@.+:-]{1,180}$/.test(id)))];
    const current = events.length ? await transaction.getAll(...events.map(id => db.doc(`events/${id}`))) : [];
    const ends = new Map(current.map(event => [event.id, eventEndMillis(event.data() || {})]));
    let removed = 0;
    for (const row of rows) {
      const expiry = row.get("expiresAt");
      if (typeof expiry !== "number" || expiry > at) continue;
      const actualEnd = ends.get(row.get("eventId"));
      const retention = ticketRetention(actualEnd || 0);
      if (retention.expiresAt && retention.expiresAt > at) {
        transaction.update(row.ref, retention);
      } else {
        transaction.delete(row.ref);
        removed++;
      }
    }
    return removed;
  });
  return { removedEvents: archived.reduce<number>((total, current) => total + current, 0), removedTickets };
}

async function backfillLegacyTicketDates(db: Firestore) {
  await db.runTransaction(async transaction => {
    const checkpoint = db.doc("_system/ticketRetentionV1");
    const cursor = await transaction.get(checkpoint);
    if (cursor.get("done")) return;
    let query = db.collection("tickets").orderBy("__name__").limit(75);
    if (cursor.get("last")) query = query.startAfter(cursor.get("last"));
    const page = await transaction.get(query);
    const missing = page.docs.filter(row => !row.get("expiresAt"));
    const ids = [...new Set(missing.map(row => row.get("eventId")).filter((value): value is string => typeof value === "string" && /^[A-Za-z0-9_@.+:-]{1,180}$/.test(value)))];
    const current = ids.length ? await transaction.getAll(...ids.map(id => db.doc(`events/${id}`))) : [];
    const byId = new Map(current.map(event => [event.id, eventEndMillis(event.data() || {})]));
    for (const row of missing) {
      const end = byId.get(row.get("eventId")) || eventEndMillis({ date: row.get("eventDate"), endDate: row.get("eventEndedAt") });
      if (end) transaction.update(row.ref, ticketRetention(end));
    }
    transaction.set(checkpoint, page.size < 75 ? { done: true } : { last: page.docs.at(-1)!.id });
  });
}
