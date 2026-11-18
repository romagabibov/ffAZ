import type { Firestore } from "firebase-admin/firestore";
import { fail, id, text } from "./security.js";

const days = 15 * 86400000;
const within = (list: unknown): string[] => Array.isArray(list) ? list.filter(value => typeof value === "string").slice(-100) : [];

export function createAnnouncements(db: Firestore) {
  const items = () => db.collection("siteAnnouncements");
  const account = (uid: string) => db.doc(`users/${uid}/private/account`);
  let cached: { until: number; rows: Record<string, unknown>[] } | undefined;
  let pending: Promise<Record<string, unknown>[]> | undefined;

  async function list() {
    if (cached && cached.until > Date.now()) return cached.rows;
    if (!pending) pending = items().where("createdAt", ">=", Date.now() - days).orderBy("createdAt", "desc").limit(30).get()
      .then(page => {
        const rows = page.docs.map(row => ({ ...row.data(), id: row.id }));
        cached = { until: Date.now() + 60_000, rows };
        return rows;
      }).finally(() => { pending = undefined; });
    return pending;
  }

  async function publish(data: any) {
    const link = text(data?.link, 500, true).trim();
    if (link && (!link.startsWith("/") || link.startsWith("//") || /[\\\u0000-\u001f]/.test(link))) fail(400, "Укажи путь на сайте, например /events");
    const ref = items().doc(id(data?.requestId));
    const row = {
      title: text(data?.title, 120).trim(),
      message: text(data?.message, 1200).trim(),
      link,
      type: "system",
      fromUserName: "AZ/FSHN",
      createdAt: Date.now(),
    };
    await db.runTransaction(async transaction => {
      if (!(await transaction.get(ref)).exists) transaction.create(ref, row);
    });
    cached = undefined;
    return { id: ref.id };
  }

  async function mark(uid: string, key: string, action: string) {
    if (!["read", "dismiss"].includes(action)) fail(400, "Неизвестное действие");
    const ref = account(uid);
    await db.runTransaction(async transaction => {
      const [announcement, settings] = await transaction.getAll(items().doc(id(key)), ref);
      if (!announcement.exists) fail(404, "Уведомление не найдено");
      const field = action === "dismiss" ? "announcementDismissedIds" : "announcementReadIds";
      const values = within(settings.get(field));
      if (!values.includes(key)) transaction.set(ref, { [field]: [...values, key].slice(-100) }, { merge: true });
    });
  }

  async function clearRead(uid: string) {
    const ref = account(uid);
    await db.runTransaction(async transaction => {
      const record = await transaction.get(ref);
      const readAt = Number(record.get("announcementsReadAt") || 0);
      const hiddenAt = Number(record.get("announcementsHiddenAt") || 0);
      const read = within(record.get("announcementReadIds"));
      const old = within(record.get("announcementDismissedIds"));
      const hidden = [...new Set([...old, ...read])].slice(-100);
      if (readAt > hiddenAt || old.length !== hidden.length) {
        transaction.set(ref, { announcementsHiddenAt: Math.max(readAt, hiddenAt), announcementDismissedIds: hidden }, { merge: true });
      }
    });
  }

  return { list, publish, mark, clearRead };
}
