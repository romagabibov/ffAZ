import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { MutationPlan } from "./mutations.js";
import { actorFor, fail, id, publicDisplayName } from "./security.js";
import { agencyNameKey, defaultAgencyTargets } from "../lib/agencyCatalogue.js";

interface Transfer {
  uid: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  representative: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: number;
  recordedAgencyId?: string | null;
}

function recordedAgency(account: any): string | null {
  return typeof account?.representedAgencyId === 'string' && account.representedAgencyId ? account.representedAgencyId : null;
}

function hasConfirmedAgency(account: any) {
  return account?.agencyVerificationStatus === 'approved' && account.isAgencyRepresentative === true && account.hasAgencyBadge === true;
}

async function sourceAgency(plan: MutationPlan) {
  const { actor, db, t } = plan;
  const { account, uid } = actor;
  if (!actor.exists.account || account.agencyVerificationStatus === 'rejected') {
    return fail(403, 'Нет действующей привязки к агентству', 'agency_source_missing');
  }
  const stored = recordedAgency(account);
  if (stored && /^[A-Za-z0-9_@.+:-]{1,180}$/.test(stored)) {
    const agency = await plan.get(`agencies/${stored}`);
    if (agency?.linkedUserId === uid || (agency && !agency.linkedUserId && hasConfirmedAgency(account))) {
      return { id: stored, name: String(agency.name || ''), confirmed: hasConfirmedAgency(account) };
    }
  }
  // An older representative can be linked in the catalogue even when their account flags were never migrated.
  const linked = await t.get(db.collection('agencies').where('linkedUserId', '==', uid).limit(2));
  if (linked.size > 1) return fail(409, 'В каталоге несколько привязок. Их должен проверить администратор.', 'agency_source_ambiguous');
  if (linked.empty && !stored && hasConfirmedAgency(account) && typeof account.representedAgencyName === 'string') {
    const matches = await t.get(db.collection('agencies').where('name', '==', account.representedAgencyName.trim()).limit(2));
    if (matches.size > 1) return fail(409, 'В каталоге несколько карточек агентства.', 'agency_source_ambiguous');
    if (matches.size === 1 && !matches.docs[0].get('linkedUserId')) {
      const agency = matches.docs[0];
      return { id: agency.id, name: String(agency.get('name')), confirmed: false };
    }
  }
  if (linked.empty) return fail(403, 'Администратор должен привязать аккаунт к карточке текущего агентства.', 'agency_source_missing');
  const agency = linked.docs[0];
  return { id: agency.id, name: String(agency.get('name') || ''), confirmed: false };
}

async function applyTransfer(plan: MutationPlan, transfer: Transfer) {
  const { uid, fromId, toId } = transfer;
  const account = await plan.get(`users/${uid}`);
  const from = await plan.get(`agencies/${fromId}`);
  const to = await plan.get(`agencies/${toId}`);
  const current = transfer.recordedAgencyId === undefined ?
    recordedAgency(account) === fromId && hasConfirmedAgency(account) : recordedAgency(account) === transfer.recordedAgencyId;
  if (!account || !current || account.agencyVerificationStatus === 'rejected') {
    return fail(409, "Привязка представителя изменилась. Нужна новая заявка.", 'agency_source_changed');
  }
  const recorded = recordedAgency(account);
  const confirmedSource = recorded === fromId || (!recorded &&
    typeof account?.representedAgencyName === 'string' &&
    agencyNameKey(account.representedAgencyName) === agencyNameKey(String(from?.name || '')));
  const confirmedUnlinkedSource = from && !from.linkedUserId && confirmedSource && hasConfirmedAgency(account);
  if (!from || (from.linkedUserId !== uid && !confirmedUnlinkedSource)) return fail(409, "Исходную привязку нужно проверить в админке", 'agency_source_changed');
  if (!to || typeof to.name !== "string" || !to.name.trim()) return fail(404, "Агентство не найдено", 'agency_target_missing');
  if (to.linkedUserId && to.linkedUserId !== uid) return fail(409, "У агентства уже назначен представитель", 'agency_target_occupied');
  const profile = await plan.get(`publicProfiles/${uid}`);
  const handle = String(profile?.username || profile?.handle || "").replace(/^@/, "");
  await plan.patch(`agencies/${fromId}`, { linkedUserId: null, linkedUserName: null, linkedUserHandle: null });
  await plan.patch(`agencies/${toId}`, {
    linkedUserId: uid,
    linkedUserName: publicDisplayName(profile?.name || account.name),
    linkedUserHandle: /^[a-z0-9_.]{3,40}$/i.test(handle) ? "@" + handle : "",
  });
  const binding = { representedAgencyId: toId, representedAgencyName: to.name, isAgency: true,
    hasAgencyBadge: true, isAgencyRepresentative: true, agencyVerificationStatus: 'approved' };
  await plan.profile(uid, binding);
  const privatePath = `users/${uid}/private/account`;
  const legacy = await plan.get(privatePath);
  if (legacy && Object.keys(binding).some(key => Object.hasOwn(legacy, key))) {
    const fields = { ...legacy };
    for (const key of Object.keys(binding)) delete fields[key];
    await plan.put(privatePath, fields);
  }
}

export function createAgencyAffiliation(db: Firestore) {
  const pathFor = (uid: string) => `agencyTransfers/${uid}`;

  async function resolveTarget(plan: MutationPlan, target: string) {
    const fallback = defaultAgencyTargets.find(agency => agency.id === target);
    if (!fallback) return { id: target, data: await plan.get(`agencies/${target}`) };
    const matches = await plan.t.get(db.collection("agencies").where("name", "==", fallback.name).limit(2));
    if (matches.size > 1) return fail(409, "В каталоге несколько карточек агентства. Нужна проверка администратора.", "agency_target_ambiguous");
    if (!matches.empty) {
      const doc = matches.docs[0];
      return { id: doc.id, data: await plan.get(`agencies/${doc.id}`) };
    }
    const existing = await plan.get(`agencies/${target}`);
    if (existing) {
      if (existing.name !== fallback.name) return fail(409, "Карточка агентства изменилась", "agency_target_ambiguous");
      return { id: target, data: existing };
    }
    const data = { name: fallback.name, createdAt: plan.at };
    await plan.put(`agencies/${target}`, data);
    return { id: target, data };
  }

  async function status(token: DecodedIdToken) {
    return db.runTransaction(async transaction => {
      const actor = await actorFor(db, token, transaction);
      const plan = new MutationPlan(db, transaction, actor);
      const agency = await sourceAgency(plan);
      const request = await plan.get(pathFor(actor.uid)) as Transfer | null;
      return { agencyId: agency.id, agencyName: agency.name, request };
    }, { readOnly: true });
  }

  async function request(token: DecodedIdToken, target: string) {
    return db.runTransaction(async transaction => {
      const actor = await actorFor(db, token, transaction);
      const plan = new MutationPlan(db, transaction, actor);
      const from = await sourceAgency(plan);
      const resolved = await resolveTarget(plan, target);
      target = resolved.id;
      if (from.id === target) return fail(400, "Это текущее агентство", 'agency_target_current');
      const to = resolved.data;
      if (!to || typeof to.name !== "string" || !to.name.trim()) return fail(404, "Агентство не найдено", 'agency_target_missing');
      if (to.linkedUserId && to.linkedUserId !== actor.uid) return fail(409, "У агентства уже назначен представитель", 'agency_target_occupied');
      const immediate = actor.admin || (from.confirmed && to.linkedUserId === actor.uid);
      const path = pathFor(actor.uid);
      const previous = await plan.get(path);
      const recordedAgencyId = recordedAgency(actor.account);
      if (!immediate && previous?.status === "pending" && previous.fromId === from.id && previous.toId === target &&
          (previous.recordedAgencyId === undefined ? previous.fromId : previous.recordedAgencyId) === recordedAgencyId) {
        return previous as Transfer;
      }
      const item: Transfer = {
        uid: actor.uid, fromId: from.id, fromName: from.name, toId: target, toName: to.name, recordedAgencyId,
        representative: publicDisplayName(actor.profile.name) || "Представитель",
        status: immediate ? "approved" : "pending", requestedAt: plan.at,
      };
      if (immediate) await applyTransfer(plan, item);
      await plan.put(path, item);
      plan.flush();
      return item;
    });
  }

  async function list(token: DecodedIdToken, cursor?: string) {
    if (!(await actorFor(db, token)).admin) return fail(403, "Нет доступа");
    const base = db.collection("agencyTransfers").where("status", "==", "pending").orderBy("__name__").limit(40);
    const page = await (cursor ? base.startAfter(cursor) : base).get();
    return { items: page.docs.map(row => row.data() as Transfer), nextCursor: page.size === 40 ? page.docs.at(-1)!.id : null };
  }

  async function decide(token: DecodedIdToken, representativeId: string, approved: boolean, reviewedRequest: unknown) {
    return db.runTransaction(async transaction => {
      const actor = await actorFor(db, token, transaction);
      if (!actor.admin) return fail(403, "Нет доступа");
      const plan = new MutationPlan(db, transaction, actor);
      const path = pathFor(id(representativeId));
      const item = await plan.get(path) as Transfer | null;
      if (!item || item.uid !== representativeId || item.status !== "pending") return fail(404, "Заявка уже обработана");
      if (item.requestedAt !== reviewedRequest) return fail(409, "Заявка изменилась. Обнови список.");
      if (approved) await applyTransfer(plan, item);
      await plan.patch(path, { status: approved ? "approved" : "rejected", reviewedAt: plan.at, reviewedBy: actor.uid });
      await plan.notification(item.uid, `agency_transfer_${item.uid}_${item.requestedAt}`, {
        type: "system",
        title: approved ? "Привязка к агентству изменена" : "Заявка на смену агентства отклонена",
        message: item.toName,
        link: "/dashboard?tab=agency-models",
      });
      plan.flush();
      return { ok: true };
    });
  }

  return { status, request, list, decide };
}
