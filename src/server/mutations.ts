import { eventEndMillis } from "../lib/dateUtils.js";
import { eventProgrammeLimits, eventScheduleRows, isEventScheduleItem } from "../lib/eventProgramme.js";
import { heldTicketCount, ticketStock } from "./tickets.js";
import {
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import sanitizeHtml from "./generated/sanitize-html.cjs";
import { isIdentityCollection, isIdentityPhoto } from "../lib/identityPolicy.js";
import {
  identityAssetIds, identityDeadlines, identityRecordPath, identitySummary,
  openIdentityFields, photoCleanupAt, requireIdentityCipher, sealIdentityFields,
  type IdentityCipher,
} from "./identity.js";
import {
  actorFor,
  activeSubscription,
  agencyAccess,
  boundedJson,
  communityAccess,
  editor,
  equal,
  expandTransforms,
  fail,
  hash,
  id,
  millis,
  now,
  only,
  patchData,
  publicDisplayName,
  publicProfile,
  roleList,
  selfPublicKeys,
  text,
  url,
  validateProfile,
  type Actor,
} from "./security.js";

type Operation = {
  path: string;
  kind: "set" | "update" | "delete";
  data?: any;
  merge?: boolean;
};
const catalogues: Record<string, "content" | "news" | "ticket"> = {
  designers: "content",
  agencies: "content",
  education: "content",
  sponsors: "content",
  settings: "content",
  siteSettings: "content",
  ffAiKnowledge: "content",
  news: "news",
  events: "ticket",
};
const appCollections = [
  "agency_applications",
  "designer_applications",
  "needleApplications",
];
const privateState = [
  "subscriptionTier",
  "subscriptionExpiresAt",
  "subscriptionValidUntil",
  "subscriptionGrantedByAdmin",
  "subscriptionGrantedAt",
  "singleJobCredits",
  "hasJobPostingAccess",
  "warnings",
  "blockedUsers",
];
const editableAdmin = [
  "name",
  "username",
  "handle",
  "bio",
  "avatarUrl",
  "photoURL",
  "links",
  "profileData",
  "isModel",
  "isDesigner",
  "brandName",
  "designerBrandName",
  "hasModelBadge",
  "hasAgencyBadge",
  "modelVerificationStatus",
  "agencyVerificationStatus",
  "designerVerificationStatus",
  "modelAgencyId",
  "modelAgencyName",
  "modelVerifiedByAgency",
  "modelVerifiedByUserId",
  "modelVerifiedAt",
  "isAgency",
  "isAgencyRepresentative",
  "representedAgencyId",
  "representedAgencyName",
  "agencyRole",
  "designerId",
  "designerRole",
  "agencyApplicationId",
  "designerApplicationId",
  "hasGoldenNeedle",
  "hasSilverNeedle",
  "goldenNeedleStatus",
  "silverNeedleStatus",
  "agencyBadgeGrantedAt",
  "hasDirectChat",
  "directChatEnabled",
  "goldenNeedleGrantedAt",
  "silverNeedleGrantedAt",
  "role",
  ...privateState,
];
const clean = (d: any) => JSON.parse(JSON.stringify(d));
const changed = (before: any, after: any) =>
  Object.keys({ ...before, ...after }).filter(
    (k) => !equal(before?.[k], after?.[k]),
  );
const strings = (v: any, max = 100) =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((x) => typeof x === "string" && x.length < 200)
    ? v
    : fail(400, "Некорректный список");
const privateMedia = (v: any) =>
  typeof v === "string" && /^\/api\/media\/[a-f0-9]{64}$/.test(v);

/** All reads are planned before the first transaction write. Clients cannot choose an Admin SDK path. */
export class MutationPlan {
  private before = new Map<string, any>();
  private after = new Map<string, any>();
  constructor(
    public db: Firestore,
    public t: Transaction,
    public actor: Actor,
    public at = now(),
    public identity?: IdentityCipher,
  ) {
    this.before.set(
      `users/${actor.uid}`,
      actor.exists.account ? actor.account : null,
    );
    this.before.set(
      `publicProfiles/${actor.uid}`,
      actor.exists.profile ? actor.profile : null,
    );
    this.before.set(
      `users/${actor.uid}/private/account`,
      actor.exists.private ? actor.private : null,
    );
  }
  async get(path: string) {
    if (this.after.has(path)) return this.after.get(path);
    if (!this.before.has(path)) {
      const s = await this.t.get(this.db.doc(path));
      this.before.set(path, s.exists ? s.data() : null);
    }
    return this.before.get(path);
  }
  async put(path: string, data: any) {
    await this.get(path);
    boundedJson(data, 350000);
    this.after.set(path, data);
  }
  async patch(path: string, data: any) {
    const d = await this.get(path);
    await this.put(path, patchData(d || {}, data, this.at));
  }
  async remove(path: string) {
    await this.get(path);
    this.after.set(path, null);
  }
  async profile(uid: string, patch: any) {
    const prev =
      (await this.get(`publicProfiles/${uid}`)) ||
      publicProfile(await this.get(`users/${uid}`), uid);
    await this.patch(`users/${uid}`, patch);
    await this.put(
      `publicProfiles/${uid}`,
      publicProfile(patchData(prev, patch, this.at), uid),
    );
  }
  async notification(uid: string, key: string, data: any) {
    if (uid === this.actor.uid) return;
    const path = `notifications/${hash(key)}`;
    if (await this.get(path)) return;
    await this.put(path, {
      ...data,
      userId: uid,
      fromUserId: this.actor.uid,
      fromUserName: this.actor.profile.name || "User",
      fromUserAvatar: this.actor.profile.avatarUrl || "",
      read: false,
      createdAt: this.at,
    });
  }
  flush() {
    for (const [path, data] of this.after) {
      const old = this.before.get(path);
      if (equal(old, data)) continue;
      const ref = this.db.doc(path);
      if (data === null) {
        if (old) this.t.delete(ref);
      } else this.t.set(ref, data);
    }
  }
  async allowedPost(postId: string) {
    const p = await this.get(`feedPosts/${id(postId)}`);
    if (!p) fail(404, "Публикация не найдена");
    if (p.isClosed && p.userId !== this.actor.uid && !(await this.premium()))
      fail(403, "Публикация недоступна");
    return p;
  }
  async premium() {
    if (activeSubscription(this.actor)) return true;
    const a = this.actor.account;
    if (a.designerVerificationStatus !== "approved" || !a.designerId)
      return false;
    const d = await this.get(`designers/${id(a.designerId)}`);
    return d?.linkedUserId === this.actor.uid;
  }
  async privateAsset(
    v: any,
    purpose: "id_document" | "verification_photo" | "cv" | "chat",
    allowedUserIds: string[] = [],
    applicationPath?: string,
  ) {
    if (!privateMedia(v))
      fail(400, "Сначала загрузи документ через защищённую загрузку");
    const m = await this.get(`mediaAssets/${v.split("/").pop()}`);
    if (
      !m ||
      m.ownerUid !== this.actor.uid ||
      m.deliveryType !== "authenticated"
    )
      fail(403, "Документ не принадлежит тебе");
    if (m.purpose !== purpose)
      fail(400, "Загрузи файл через поле, для которого он предназначен");
    if (isIdentityPhoto(purpose)) {
      if (!applicationPath || !m.identityEncrypted || m.identityReady !== true || m.identityDeleting ||
          (m.identityPurgeAt && millis(m.identityPurgeAt) <= this.at) ||
          (m.identityApplicationPath && (m.identityApplicationPath !== applicationPath || m.identityPurgeAt))) {
        fail(400, "Загрузи новое фото через форму верификации", "identity_reupload");
      }
      await this.patch(`mediaAssets/${v.split("/").pop()}`, { identityApplicationPath: applicationPath, ...photoCleanupAt(null) });
    }
    if (allowedUserIds.length)
      await this.patch(`mediaAssets/${v.split("/").pop()}`, {
        allowedUserIds: [
          ...new Set([...(m.allowedUserIds || []), ...allowedUserIds]),
        ],
      });
    return v;
  }
}

async function reviewIdentityApplication(p: MutationPlan, path: string, old: any, next: any, data: any) {
  const recordPath = identityRecordPath(path);
  const record = await p.get(recordPath);
  const available = record?.ciphertext && (!record.expiresAt || millis(record.expiresAt) > p.at);
  if (!next) {
    for (const key of record?.assetIds || []) {
      const assetPath = `mediaAssets/${id(key)}`;
      const asset = await p.get(assetPath);
      if (asset?.identityApplicationPath === path) await p.patch(assetPath, photoCleanupAt(Timestamp.fromMillis(p.at)));
    }
    await p.remove(recordPath);
    await p.remove(path);
    return;
  }

  only(data, ["status", "reviewedAt", "reviewedBy", "rejectionReason", "adminComment", "comment"]);
  if (data.status !== undefined && !["approved", "rejected"].includes(data.status)) fail(400, "Некорректный статус");
  const summary = identitySummary(old);
  if (data.status && data.status !== old.status) {
    if (old.status !== "pending") fail(409, "По заявке уже принято решение");
    if (data.status === "approved") {
      if (old.needsDocumentReupload || !available || !Array.isArray(record.assetIds) || record.assetIds.length !== 2) {
        fail(409, "Сначала запроси повторную загрузку документа", "identity_reupload");
      }
      for (const key of record.assetIds) {
        const asset = await p.get(`mediaAssets/${id(key)}`);
        if (!asset?.identityEncrypted || asset.identityReady !== true || asset.identityDeleting || asset.identityApplicationPath !== path ||
            (asset.identityPurgeAt && millis(asset.identityPurgeAt) <= p.at)) {
          fail(409, "Сначала запроси повторную загрузку документа", "identity_reupload");
        }
      }
    }
    summary.status = data.status;
    summary.reviewedAt = p.at;
    summary.reviewedBy = p.actor.uid;
    if (record) {
      const deadlines = identityDeadlines(p.at);
      summary.identityMediaExpiresAt = deadlines.photo;
      summary.identityDataExpiresAt = deadlines.data;
      await p.patch(recordPath, { expiresAt: deadlines.data });
      for (const key of record.assetIds || []) {
        const assetPath = `mediaAssets/${id(key)}`;
        const asset = await p.get(assetPath);
        if (asset?.identityApplicationPath === path) await p.patch(assetPath, photoCleanupAt(deadlines.photo));
      }
    }
  }
  const notes = Object.fromEntries(["comment", "adminComment", "rejectionReason"]
    .filter((field) => data[field] !== undefined).map((field) => [field, text(data[field], 5000, true)]));
  if (Object.keys(notes).length && available) {
    const cipher = requireIdentityCipher(p.identity);
    const fields = openIdentityFields(cipher, path, old.userId, record.ciphertext);
    await p.patch(recordPath, { ciphertext: sealIdentityFields(cipher, path, old.userId, { ...fields, ...notes }) });
  }
  await p.put(path, summary);
}

async function userWrite(
  p: MutationPlan,
  op: Operation,
  uid: string,
  old: any,
) {
  const a = p.actor;
  if (op.kind === "delete") fail(400, "Используй удаление аккаунта");
  const data = op.data || {},
    keys = Object.keys(data);
  boundedJson(data, 60000);
  if (uid !== a.uid && !a.admin) {
    if (keys.length === 1 && keys[0] === "followers") {
      const users = strings(
          expandTransforms(data.followers, old?.followers, p.at),
          3000,
        ),
        prev = old?.followers || [];
      if (
        !equal(
          users.filter((x) => x !== a.uid),
          prev.filter((x: string) => x !== a.uid),
        )
      )
        fail(403, "Можно изменить только свою подписку");
      await p.patch(`publicProfiles/${uid}`, { followers: users });
      if (users.includes(a.uid) && !prev.includes(a.uid))
        await p.notification(uid, `follow_${a.uid}_${uid}`, {
          type: "follow",
          title: "Новый подписчик",
          message: a.profile.name || "User",
          link: `/u/${a.uid}`,
        });
      return;
    }
    fail(403, "Нельзя изменять чужой профиль");
  }
  if (
    (a.admin && uid !== a.uid) ||
    (a.admin &&
      keys
        .filter((k) => k !== "role" || data.role !== "user")
        .some((k) => editableAdmin.includes(k) && !selfPublicKeys.includes(k)))
  ) {
    only(data, [...editableAdmin, ...selfPublicKeys]);
    if (
      data.role !== undefined &&
      (!a.superadmin || !roleList.includes(data.role) || uid === a.uid)
    )
      fail(403, "Роли назначает суперадминистратор другому пользователю");
    const publicPatch: any = {},
      secret: any = {};
    for (const [k, v] of Object.entries(data))
      (privateState.includes(k) ? secret : publicPatch)[k] = v;
    if (
      secret.subscriptionTier &&
      !["free", "pro", "elite", "business", "creator", "vip"].includes(
        secret.subscriptionTier,
      )
    )
      fail(400, "Некорректный тариф");
    if (
      secret.singleJobCredits !== undefined &&
      (!Number.isInteger(secret.singleJobCredits) ||
        secret.singleJobCredits < 0 ||
        secret.singleJobCredits > 1000)
    )
      fail(400, "Некорректные кредиты");
    if (Object.keys(secret).length)
      await p.patch(`users/${uid}/private/account`, secret);
    if (Object.keys(publicPatch).length) await p.profile(uid, publicPatch);
    return;
  }
  // Last-seen is deliberately sampled; pending application flags are set with the application itself.
  const legacyPending = [
    "agencyVerificationStatus",
    "designerVerificationStatus",
    "agencyApplicationId",
    "designerApplicationId",
    "silverNeedleStatus",
    "goldenNeedleStatus",
  ];
  const pendingPatch = Object.fromEntries(
    Object.entries(data).filter(([k]) => legacyPending.includes(k)),
  );
  if (Object.keys(pendingPatch).length) {
    for (const [k, v] of Object.entries(pendingPatch)) {
      const current = (await p.get(`users/${uid}`))?.[k];
      if (!equal(v, current)) fail(403, "Статус меняется вместе с заявкой");
    }
  }
  const publicPatch = Object.fromEntries(
    Object.entries(data).filter(
      ([k]) =>
        !legacyPending.includes(k) &&
        ![
          "email",
          "blockedUsers",
          "singleJobCredits",
          "hasJobPostingAccess",
        ].includes(k),
    ),
  );
  only(publicPatch, [...selfPublicKeys, "following", "createdAt", "role"]);
  if (publicPatch.role !== undefined && publicPatch.role !== "user")
    fail(403, "Нельзя назначить себе роль");
  delete publicPatch.role;
  delete publicPatch.createdAt;
  if (
    data.singleJobCredits !== undefined ||
    data.hasJobPostingAccess !== undefined
  )
    fail(403, "Кредиты списывает сервер");
  if (publicPatch.following) {
    const targetIds = strings(
      expandTransforms(publicPatch.following, old?.following, p.at),
      3000,
    );
    publicPatch.following = targetIds;
  }
  if (publicPatch.username !== undefined || publicPatch.handle !== undefined) {
    const username = String(publicPatch.username ?? publicPatch.handle)
      .replace(/^@/, "")
      .toLowerCase()
      .trim();
    if (
      !/^[a-z0-9_.]{3,40}$/.test(username) ||
      [
        "admin",
        "api",
        "login",
        "onboarding",
        "dashboard",
        "events",
        "feed",
        "messages",
        "plans",
        "news",
        "privacy",
        "terms",
        "cookies",
        "about",
        "more",
        "u",
        "designers",
        "agencies",
        "education",
      ].includes(username)
    )
      fail(
        400,
        "Выбери другой username: 3–40 латинских букв, цифр, точек или подчёркиваний",
      );
    const claim = await p.get(`_handles/${username}`);
    if (claim && claim.uid !== uid) fail(409, "Этот username уже занят");
    if (old?.username && old.username !== username) {
      const prevClaim = await p.get(`_handles/${old.username}`);
      if (prevClaim?.uid === uid) await p.remove(`_handles/${old.username}`);
    }
    await p.put(`_handles/${username}`, { uid });
    publicPatch.username = username;
    publicPatch.handle = "@" + username;
  }
  const next = patchData(old || {}, publicPatch, p.at);
  validateProfile(next);
  for (const k of ["lastLoginAt", "lastActiveAt"])
    if (k in publicPatch) {
      if (p.at - millis(old?.[k]) < 600000) delete publicPatch[k];
      else publicPatch[k] = Timestamp.fromMillis(p.at);
    }
  if (!(await p.get(`users/${uid}`)))
    await p.put(`users/${uid}`, {
      role: a.role,
      createdAt: Timestamp.fromMillis(p.at),
    });
  await p.put(
    `publicProfiles/${uid}`,
    publicProfile(patchData(old || {}, publicPatch, p.at), uid),
  );
  const priv = await p.get(`users/${uid}/private/account`);
  if (!priv)
    await p.put(`users/${uid}/private/account`, {
      email: a.token.email || "",
      blockedUsers: [],
      createdAt: Timestamp.fromMillis(p.at),
      subscriptionTier: "free",
    });
}

export async function applyOperation(
  p: MutationPlan,
  op: Operation,
): Promise<void> {
  if (!op || !["set", "update", "delete"].includes(op.kind))
    fail(400, "Некорректная операция");
  if (
    op.kind !== "delete" &&
    (!op.data || typeof op.data !== "object" || Array.isArray(op.data))
  )
    fail(400, "Некорректное содержимое операции");
  const parts = String(op.path || "").split("/");
  if (parts.length % 2 || parts.length > 4) fail(400, "Некорректный путь");
  parts.forEach(id);
  let [col, key, sub, subid] = parts;
  if (col === "publicProfiles") col = "users";
  const a = p.actor;
  const path =
    col === "users" && !sub
      ? `publicProfiles/${key}`
      : [col, key, sub, subid].filter(Boolean).join("/");
  const old = await p.get(path),
    data = op.data || {};
  boundedJson(data, 350000);
  const next =
    op.kind === "delete"
      ? null
      : op.kind === "update" || op.merge
        ? patchData(old || {}, data, p.at)
        : expandTransforms(data, old, p.at);
  if (col === "users") {
    if (sub) {
      if (
        sub !== "private" ||
        subid !== "account" ||
        (key !== a.uid && !a.admin)
      )
        fail(403, "Нет доступа");
      if (op.kind === "delete") fail(403, "Нельзя удалить настройки");
      if (!a.admin)
        only(data, ["email", "blockedUsers", "feedLanguage", "createdAt"]);
      const d: any = { ...data };
      delete d.createdAt;
      if (d.email !== undefined) d.email = a.token.email || "";
      if (d.blockedUsers)
        d.blockedUsers = strings(
          expandTransforms(d.blockedUsers, old?.blockedUsers, p.at),
          1000,
        );
      await p.patch(path, d);
      return;
    }
    return userWrite(p, op, key, old);
  }
  if (sub && col !== "conversations") fail(403, "Путь запрещён");
  if (Object.hasOwn(catalogues, col)) {
    if (col === "ffAiKnowledge" && !a.superadmin)
      fail(403, "Только суперадминистратор");
    if (col === "siteSettings" && key === "features" && !a.admin)
      fail(403, "Только администратор");
    if (!editor(a, catalogues[col])) fail(403, "Нет прав редактора");
    if (["agencies", "designers"].includes(col) && !a.admin &&
        ["linkedUserId", "linkedUserName", "linkedUserHandle", "hasAgencyBadge", "hasGoldenNeedle", "hasDirectChat"]
          .some((key) => !equal(old?.[key] || null, next?.[key] || null))) {
      fail(403, "Связь с аккаунтом и статус подтверждает администратор");
    }
    if (col === "events" && (data.ticketsSold !== undefined || data.ticketInventoryRevision !== undefined || data.ticketRetentionCursor !== undefined)) {
      fail(400, "Состояние билетов обновляется сервером");
    }
    if (col === "events" && old?.ticketRetentionCursor && next) fail(409, "Обработка завершённого мероприятия уже началась");
    if (col === "events" && next) {
      if (next.schedule !== undefined && !equal(old?.schedule, next.schedule)) {
        if (!Array.isArray(next.schedule) || next.schedule.length > eventProgrammeLimits.rows ||
            !next.schedule.every(isEventScheduleItem)) {
          fail(400, "Проверь время и названия пунктов расписания", "invalid_event_schedule");
        }
        next.schedule = eventScheduleRows(next.schedule);
      }
      for (const field of ["dressCode", "admissionRules"] as const) {
        if (next[field] !== undefined && !equal(old?.[field], next[field])) {
          next[field] = text(next[field], eventProgrammeLimits[field], true).trim();
        }
      }
    }
    if (col === "events" && old && (!next || data.totalTickets !== undefined || data.availableTickets !== undefined)) {
      const held = await heldTicketCount(p.db, p.t, key, p.at);
      if (!next && held) fail(409, "Сначала дождись завершения активных броней");
      if (next) {
        const capacity = next.totalTickets;
        const sold = ticketStock(old).sold;
        if (!Number.isSafeInteger(capacity) || capacity < sold + held) fail(409, "Лимит меньше числа проданных и забронированных билетов");
        next.availableTickets = capacity - sold;
        next.ticketsSold = sold;
      }
    }
    if (next) {
      boundedJson(next, col === "news" ? 300000 : 120000);
      if (col === "news" && next.content)
        next.content = sanitizeHtml(text(next.content, 250000, true), {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            "img",
            "h1",
            "h2",
            "figure",
            "figcaption",
          ]),
          allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            img: ["src", "alt", "width", "height"],
            a: ["href", "target", "rel"],
          },
          allowedSchemes: ["https", "mailto"],
          transformTags: {
            a: sanitizeHtml.simpleTransform("a", {
              rel: "noopener noreferrer",
            }),
          },
        });
      if (["agencies", "designers"].includes(col)) {
        const changedLink = ["linkedUserId", "linkedUserName", "linkedUserHandle"]
          .some((field) => !equal(old?.[field] ?? null, next[field] ?? null));
        if (changedLink && next.linkedUserId) {
          const uid = id(next.linkedUserId);
          if (old?.linkedUserId && old.linkedUserId !== uid) {
            fail(409, "Карточка уже связана с другим владельцем. Сначала отвяжи её вручную");
          }
          if (!(await p.get(`users/${uid}`))) fail(404, "Связанный аккаунт не найден");
          const profile = await p.get(`publicProfiles/${uid}`);
          const handle = String(profile?.username || profile?.handle || "").replace(/^@/, "");
          next.linkedUserName = publicDisplayName(profile?.name);
          next.linkedUserHandle = /^[a-z0-9_.]{3,40}$/i.test(handle) ? `@${handle}` : "";
        } else if (changedLink) {
          next.linkedUserName = null;
          next.linkedUserHandle = null;
        }
      }
      if (col === "siteSettings" && key === "socialLinks") delete next.updatedBy;
      await p.put(path, next);
    } else await p.remove(path);
    return;
  }
  if (col === "feedPosts") {
    if (old && old.userId !== a.uid && !a.admin) fail(403, "Чужая публикация");
    if (!next) {
      await p.remove(path);
      return;
    }
    only(next, [
      "userId",
      "content",
      "imageUrl",
      "images",
      "videoUrl",
      "likesCount",
      "commentsCount",
      "createdAt",
      "isClosed",
      "tag",
      "topic",
      "isTop",
      "isPinned",
    ]);
    text(next.content, 3000, true);
    for (const key of ["tag", "topic"])
      if (next[key] != null) text(next[key], 50, true);
    for (const key of ["isClosed", "isTop", "isPinned"])
      if (next[key] != null && typeof next[key] !== "boolean")
        fail(400, "Некорректный переключатель публикации");
    if (!old && next.userId !== a.uid) fail(403, "Чужой автор");
    for (const k of ["imageUrl", "videoUrl"])
      if (next[k]) url(next[k], true, false);
    if (next.images && (!Array.isArray(next.images) || next.images.length > 10))
      fail(400, "Не более 10 изображений");
    next.images?.forEach((x: any) => url(x, true, false));
    if (old) {
      for (const k of ["userId", "createdAt", "likesCount", "commentsCount"])
        if (!equal(next[k], old[k])) fail(403, "Служебные поля");
      if (
        !a.admin &&
        ["isTop", "isPinned"].some((k) => Boolean(next[k]) !== Boolean(old[k]))
      )
        fail(403, "Нет прав закреплять");
    } else
      Object.assign(next, {
        userId: a.uid,
        likesCount: 0,
        commentsCount: 0,
        createdAt: Timestamp.fromMillis(p.at),
        isTop: false,
        isPinned: false,
      });
    next.isClosed = Boolean(next.isClosed);
    if (next.isClosed && !(await p.premium()))
      fail(403, "Нужен активный доступ в сообщество");
    await p.put(path, next);
    return;
  }
  if (col === "feedLikes" || col === "feedComments")
    fail(400, "Используй атомарное действие публикации");
  if (col === "feedLiveMessages") {
    if (old) {
      if (!a.admin && old.userId !== a.uid) fail(403, "Чужое сообщение");
      if (next) fail(403, "Редактирование недоступно");
      await p.remove(path);
      return;
    }
    only(data, [
      "userId",
      "userName",
      "userAvatar",
      "channel",
      "text",
      "audioUrl",
      "audioDuration",
      "waveform",
      "createdAt",
      "badge",
      "isDesigner",
    ]);
    if (data.userId !== a.uid || !["public", "pro"].includes(data.channel))
      fail(403, "Некорректный канал");
    if (data.channel === "pro" && !(await p.premium()))
      fail(403, "Нужен доступ в сообщество");
    text(data.text, 500, true);
    if (!data.text?.trim() && !data.audioUrl) fail(400, "Пустое сообщение");
    if (data.audioUrl) url(data.audioUrl, true, false);
    const usagePath = `_usage/live_${a.uid}`,
      usage = await p.get(usagePath),
      sentAt = (usage?.sentAt || []).filter((n: number) => n > p.at - 86400000);
    const tier = a.private.subscriptionTier,
      limit =
        a.admin ||
        (activeSubscription(a) && ["elite", "vip", "business"].includes(tier))
          ? 300
          : activeSubscription(a)
            ? 5
            : 1;
    if (sentAt.length >= limit)
      fail(429, "Лимит сообщений за 24 часа исчерпан");
    sentAt.push(p.at);
    await p.put(usagePath, {
      sentAt,
      expiresAt: Timestamp.fromMillis(p.at + 172800000),
    });
    const badge = a.admin
      ? "Admin"
      : a.account.hasGoldenNeedle
        ? "Golden Needle"
        : activeSubscription(a)
          ? tier === "pro"
            ? "Pro"
            : "Elite VIP"
          : "";
    await p.put(path, {
      ...next,
      userId: a.uid,
      userName: a.profile.name || "User",
      userAvatar: a.profile.avatarUrl || "",
      badge,
      isDesigner: a.account.designerVerificationStatus === "approved",
      createdAt: Timestamp.fromMillis(p.at),
    });
    return;
  }
  if (col === "posts") {
    if (old && old.userId !== a.uid && !a.admin) fail(403, "Чужое портфолио");
    if (!next) {
      await p.remove(path);
      return;
    }
    if (next.userId !== a.uid && !a.admin) fail(403, "Чужой автор");
    only(next, [
      "userId",
      "imageUrl",
      "videoUrl",
      "description",
      "title",
      "content",
      "likes",
      "comments",
      "createdAt",
    ]);
    for (const key of ["description", "title", "content"])
      if (next[key] != null) text(next[key], 3000, true);
    if (!old) {
      next.likes = 0;
      next.comments = 0;
    } else
      for (const key of ["likes", "comments"])
        if (!equal(next[key], old[key]))
          fail(403, "Счётчики портфолио меняет сервер");
    boundedJson(next, 50000);
    for (const [k, v] of Object.entries(next))
      if (/url|image|video/i.test(k) && typeof v === "string" && v)
        url(v, true, false);
    await p.put(path, {
      ...next,
      userId: old?.userId || a.uid,
      createdAt: old?.createdAt || Timestamp.fromMillis(p.at),
    });
    return;
  }
  if (col === "notifications") {
    if (!old) {
      if (!a.admin)
        fail(403, "Уведомления создаёт соответствующее действие сервера");
      text(next.title, 100);
      text(next.message, 2000, true);
      id(next.userId);
      await p.notification(next.userId, key, { ...next });
      return;
    }
    if (!a.admin && old.userId !== a.uid) fail(403, "Чужое уведомление");
    if (!next) {
      await p.remove(path);
      return;
    }
    if (!a.admin) only(data, ["read"]);
    if (data.read !== undefined && typeof data.read !== "boolean")
      fail(400, "Некорректная отметка");
    await p.put(path, next);
    return;
  }
  if (col === "conversations")
    return conversationWrite(p, op, key, subid, old, next);
  if (col === "agency_invitations")
    return invitationWrite(p, op, key, old, next);
  if (col === "agency_broadcasts") {
    if (old) {
      if (!a.admin && old.senderUserId !== a.uid) fail(403, "Чужая рассылка");
      if (next) fail(403, "Создай новую рассылку");
      await p.remove(path);
      return;
    }
    const agency = agencyAccess(a);
    if ((await p.get(`agencies/${agency}`))?.linkedUserId !== a.uid)
      fail(403, "Агентство не связано с твоим аккаунтом");
    only(data, [
      "agencyId",
      "agencyName",
      "senderUserId",
      "senderName",
      "title",
      "message",
      "link",
      "category",
      "deadline",
      "recipientUserIds",
      "recipientCount",
      "createdAt",
      "audience",
      "isBroadcastToAll",
      "senderAvatar",
    ]);
    const recipients = [...new Set(strings(data.recipientUserIds, 200))];
    if (!recipients.length) fail(400, "Выбери получателей");
    text(data.title, 100);
    text(data.message, 2000);
    if (data.link && !String(data.link).startsWith("/"))
      url(data.link, true, false);
    for (const uid of recipients) {
      const target = await p.get(`users/${id(uid)}`);
      if (
        target?.modelAgencyId !== agency ||
        !target.hasModelBadge ||
        !["approved", "verified"].includes(target.modelVerificationStatus)
      )
        fail(403, "В рассылке есть неподтверждённый участник");
    }
    await p.put(path, {
      ...data,
      agencyId: agency,
      agencyName: a.account.representedAgencyName || "",
      senderUserId: a.uid,
      senderName: a.profile.name || "",
      recipientUserIds: recipients,
      recipientCount: recipients.length,
      createdAt: p.at,
    });
    for (const uid of recipients)
      await p.notification(uid, `${key}_${uid}`, {
        type: "agency_broadcast",
        title: data.title,
        message: data.message,
        link: data.link || "/dashboard?tab=model",
      });
    return;
  }
  if (appCollections.includes(col)) {
    const identityApplication = isIdentityCollection(col);
    const resubmission = old?.userId === a.uid && op.kind === "set" &&
      (old.status === "rejected" || (identityApplication && old.status === "pending" && old.needsDocumentReupload));
    if (
      old &&
      !resubmission
    ) {
      if (!a.admin) fail(409, "Заявка уже отправлена");
      if (identityApplication) {
        await reviewIdentityApplication(p, path, old, next, data);
        return;
      }
      if (!next) {
        await p.remove(path);
        return;
      }
      only(data, [
        "status",
        "reviewedAt",
        "reviewedBy",
        "rejectionReason",
        "adminComment",
        "comment",
      ]);
      if (
        data.status &&
        !["pending", "approved", "rejected"].includes(data.status)
      )
        fail(400, "Некорректный статус");
      await p.put(path, next);
      return;
    }
    const allowed = [
      "userId",
      "userEmail",
      "userName",
      "userHandle",
      "applicantFirstName",
      "applicantLastName",
      "applicantPatronymic",
      "phoneNumber",
      "agencyName",
      "agencyAddress",
      "foundingYear",
      "idCardPhotoUrl",
      "personalPhotoUrl",
      "idDocumentUrl",
      "agencyRole",
      "status",
      "createdAt",
      "modelCount",
      "location",
      "website",
      "instagram",
      "mediaLinks",
      "modelWorkLinks",
      "comment",
      "brandName",
      "brandAddress",
      "designerRole",
      "collectionsCount",
      "collectionLinks",
      "type",
      "portfolioUrl",
      "fee",
    ];
    only(data, allowed);
    for (const [key, value] of Object.entries(data)) {
      if (
        [
          "createdAt",
          "fee",
          "modelCount",
          "collectionsCount",
          "foundingYear",
        ].includes(key)
      ) {
        if (
          value != null &&
          typeof value !== "string" &&
          typeof value !== "number" &&
          !(value as any)?.__afwOp
        )
          fail(400, "Некорректное поле заявки");
      } else text(value, 5000, true);
    }
    if (col === "needleApplications" && data.type !== "silver")
      fail(400, "Неизвестный тип заявки");
    if (data.userId !== a.uid || data.status !== "pending")
      fail(403, "Некорректная заявка");
    boundedJson(data, 40000);
    const duplicates = await p.t.get(
      p.db
        .collection(col)
        .where("userId", "==", a.uid)
        .where("status", "in", ["pending", "approved"])
        .limit(identityApplication ? 2 : 1),
    );
    if (duplicates.size > 1 || duplicates.docs.some((doc) => !identityApplication || doc.data().status === "approved" || !doc.data().needsDocumentReupload))
      fail(409, "Такая заявка уже отправлена");
    const stable =
      col === "needleApplications"
        ? `${a.uid}_${data.type === "gold" ? "gold" : "silver"}`
        : a.uid;
    const existing = await p.get(`${col}/${stable}`);
    if (existing && (existing.userId !== a.uid || (existing.status !== "rejected" && !(identityApplication && existing.status === "pending" && existing.needsDocumentReupload))))
      fail(409, "Такая заявка уже отправлена");
    const applicationPath = `${col}/${stable}`;
    const application = {
      ...next,
      ...(col === "needleApplications" ? { fee: 40 } : {}),
      userId: a.uid,
      userEmail: a.token.email || "",
      status: "pending",
      createdAt: p.at,
    };
    if (identityApplication) {
      const cipher = requireIdentityCipher(p.identity);
      const document = data.idCardPhotoUrl || data.idDocumentUrl;
      if (!document || !data.personalPhotoUrl || (data.idCardPhotoUrl && data.idDocumentUrl && data.idCardPhotoUrl !== data.idDocumentUrl)) {
        fail(400, "Приложи фото удостоверения и личное фото", "identity_photos_required");
      }
      text(data.applicantFirstName, 150);
      text(data.applicantLastName, 150);
      text(col === "agency_applications" ? data.agencyName : data.brandName, 200);
      await p.privateAsset(document, "id_document", [], applicationPath);
      await p.privateAsset(data.personalPhotoUrl, "verification_photo", [], applicationPath);
      const { userId, status, createdAt, ...fields } = application;
      const recordPath = identityRecordPath(applicationPath);
      const previous = await p.get(recordPath);
      const assetIds = identityAssetIds(fields);
      for (const key of previous?.assetIds || []) {
        if (assetIds.includes(key)) continue;
        const assetPath = `mediaAssets/${id(key)}`;
        const asset = await p.get(assetPath);
        if (asset?.identityApplicationPath === applicationPath && !asset.identityPurgeAt) {
          await p.patch(assetPath, photoCleanupAt(Timestamp.fromMillis(p.at)));
        }
      }
      await p.put(recordPath, {
        ownerUid: userId, applicationPath, assetIds,
        ciphertext: sealIdentityFields(cipher, applicationPath, userId, fields), expiresAt: null,
      });
      await p.put(applicationPath, { userId, status, createdAt, identitySchema: 3, identityDataPresent: true });
      const replaced = duplicates.docs[0];
      if (replaced && replaced.ref.path !== applicationPath) {
        await reviewIdentityApplication(p, replaced.ref.path, replaced.data(), null, {});
      }
    } else {
      if (identityAssetIds(application).length || data.idCardPhotoUrl || data.idDocumentUrl || data.personalPhotoUrl)
        fail(400, "Фото удостоверения принимаются в анкете верификации");
      await p.put(applicationPath, application);
    }
    const patch =
      col === "agency_applications"
        ? {
            agencyVerificationStatus: "pending",
            agencyApplicationId: stable,
            isAgency: true,
            industry: "agency",
          }
        : col === "designer_applications"
          ? {
              designerVerificationStatus: "pending",
              designerApplicationId: stable,
              isDesigner: true,
              industry: "fashion_design",
            }
          : data.type === "gold"
            ? { goldenNeedleStatus: "pending" }
            : { silverNeedleStatus: "pending" };
    await p.profile(a.uid, patch);
    return;
  }
  if (col === "vacancies") {
    if (old && next && data.status !== undefined && Object.keys(data).length === 1) {
      if (!editor(a, "content") && old.employerId !== a.uid) fail(403, "Чужая вакансия");
      if (!["closed", "open"].includes(data.status)) fail(400, "Некорректный статус вакансии");
      await p.patch(path, { status: data.status, closedAt: data.status === "closed" ? p.at : null });
      return;
    }
    if (next) {
      for (const k of ["title", "companyName", "location", "salary"])
        if (next[k] != null) text(next[k], 300, true);
      text(next.description, 15000, true);
      if (
        !["vacancy", "casting", "volunteer", "internship"].includes(next.type)
      )
        fail(400, "Неизвестный вид вакансии");
      if (next.customQuestions != null) {
        if (
          !Array.isArray(next.customQuestions) ||
          next.customQuestions.length > 30
        )
          fail(400, "Слишком много вопросов");
        for (const q of next.customQuestions) {
          only(q, ["id", "question", "type", "required", "options"]);
          text(q.id, 120);
          text(q.question, 1000);
          if (!["text", "yes_no", "number", "textarea"].includes(q.type))
            fail(400, "Неизвестный тип вопроса");
          if (q.required != null && typeof q.required !== "boolean")
            fail(400, "Некорректный вопрос");
          if (q.options != null) strings(q.options, 30);
        }
      }
    }

    if (old) {
      if (!editor(a, "content") && old.employerId !== a.uid)
        fail(403, "Чужая вакансия");
      if (!next) await p.remove(path);
      else {
        only(data, [
          "title",
          "description",
          "companyName",
          "location",
          "type",
          "customQuestions",
          "status",
        ]);
        if (data.status !== undefined) {
          if (!["closed", "open"].includes(data.status)) fail(400, "Некорректный статус вакансии");
          next.closedAt = data.status === "closed" ? p.at : null;
        }
        await p.put(path, next);
      }
      return;
    }
    only(data, [
      "employerId",
      "employerName",
      "companyName",
      "title",
      "description",
      "location",
      "type",
      "customQuestions",
      "salary",
      "isPaid",
      "createdAt",
    ]);
    if (data.employerId !== a.uid && !editor(a, "content"))
      fail(403, "Чужой работодатель");
    text(data.title, 200);
    text(data.description, 15000);
    boundedJson(data, 40000);
    const useCredit = !editor(a, "content") && (!activeSubscription(a) || !["elite", "vip", "pro", "business"].includes(a.private.subscriptionTier));
    if (useCredit) {
      const priv = await p.get(`users/${a.uid}/private/account`);
      if (!(priv?.singleJobCredits > 0))
        fail(402, "Нет доступа к публикации вакансий");
      await p.patch(`users/${a.uid}/private/account`, {
        singleJobCredits: priv.singleJobCredits - 1,
      });
    }
    if (!editor(a, "content")) {
      const posted = p.db.collection("vacancies").where("employerId", "==", a.uid);
      const [all, closed] = await Promise.all([p.t.get(posted.count()), p.t.get(posted.where("status", "==", "closed").count())]);
      const max = a.private.subscriptionTier === "elite" ? 20 : 5;
      if (all.data().count - closed.data().count >= max) fail(409, "Достигнут лимит активных вакансий");
    }
    await p.put(path, {
      ...next,
      employerId: a.uid,
      employerName: a.profile.name || "",
      status: "open",
      ...(useCredit ? { expiresAt: p.at + 30 * 86400000 } : {}),
      createdAt: Timestamp.fromMillis(p.at),
    });
    return;
  }
  if (col === "jobApplications") {
    if (old) {
      const v = await p.get(`vacancies/${id(old.jobId)}`);
      if (!a.admin && v?.employerId !== a.uid)
        fail(403, "Нет доступа к заявке");
      if (!next) {
        await p.remove(path);
      } else {
        only(data, ["status", "updatedAt"]);
        if (
          ![
            "pending",
            "accepted",
            "approved",
            "rejected",
            "reviewed",
            "shortlisted",
            "postponed",
          ].includes(data.status)
        )
          fail(400, "Некорректный статус");
        next.updatedAt = p.at;
        await p.put(path, next);
        if (data.status !== old.status)
          await p.notification(old.userId, `jobstatus_${key}_${data.status}`, {
            type: "job_status",
            title: "Статус заявки обновлён",
            message: data.status,
            link: "/dashboard?tab=employer",
          });
      }
      return;
    }
    only(data, [
      "jobId",
      "jobTitle",
      "employerId",
      "userId",
      "userName",
      "userEmail",
      "userHandle",
      "userAvatar",
      "name",
      "email",
      "profileData",
      "hasGoldenNeedle",
      "phone",
      "phoneNumber",
      "coverLetter",
      "portfolioUrl",
      "cvUrl",
      "answers",
      "customAnswers",
      "status",
      "createdAt",
    ]);
    if (data.userId !== a.uid || data.status !== "pending")
      fail(403, "Некорректная заявка");
    if (data.name != null) text(data.name, 120, true);
    if (data.coverLetter != null) text(data.coverLetter, 10000, true);
    if (data.customAnswers != null) {
      if (!Array.isArray(data.customAnswers) || data.customAnswers.length > 30)
        fail(400, "Некорректные ответы");
      for (const answer of data.customAnswers) {
        only(answer, ["questionId", "question", "answer", "type"]);
        for (const value of Object.values(answer)) text(value, 3000, true);
      }
    }
    const job = await p.get(`vacancies/${id(data.jobId)}`);
    if (!job) fail(404, "Вакансия не найдена");
    if (job.status === "closed" || (job.expiresAt && millis(job.expiresAt) <= p.at)) fail(409, "Приём откликов завершён", "vacancy_closed");
    const employer = typeof job.employerId === "string" && job.employerId ? id(job.employerId) : "";
    if (!employer) fail(409, "У вакансии нет активного владельца. Сообщи организатору.", "vacancy_owner_missing");
    if (employer === a.uid) fail(400, "Нельзя откликнуться на свою вакансию");
    if (data.cvUrl) await p.privateAsset(data.cvUrl, "cv", [employer]);
    const answers = new Map((data.customAnswers || []).map((answer: any) => [answer.questionId, answer.answer]));
    const customAnswers = (Array.isArray(job.customQuestions) ? job.customQuestions : []).map((question: any) => {
      const answer = text(answers.get(question.id), 3000, true).trim();
      if (question.required && !answer) fail(400, `Ответь на вопрос «${String(question.question).slice(0, 200)}»`);
      return { questionId: question.id, question: question.question, type: question.type, answer };
    });
    const previous = await p.t.get(
      p.db
        .collection("jobApplications")
        .where("jobId", "==", data.jobId)
        .where("userId", "==", a.uid)
        .limit(1),
    );
    const existing = previous.docs[0];
    if (existing && !existing.data().needsDocumentReupload)
      fail(409, "Ты уже откликнулся");
    const target =
      existing?.ref.path || `jobApplications/${hash(data.jobId + "|" + a.uid)}`;
    if (!existing && (await p.get(target))) fail(409, "Ты уже откликнулся");
    await p.put(target, {
      ...next,
      userId: a.uid,
      userEmail: a.token.email || "",
      email: a.token.email || "",
      profileData: a.profile.profileData || null,
      hasGoldenNeedle: Boolean(a.account.hasGoldenNeedle),
      employerId: employer,
      jobTitle: String(job.title || ""),
      customAnswers,
      status: "pending",
      needsDocumentReupload: false,
      createdAt: existing?.data().createdAt || p.at,
    });
    await p.notification(employer, `job_application_${target}`, {
      type: "job_application",
      title: "Новый отклик на вакансию",
      message: String(job.title || ""),
      link: "/dashboard?tab=employer",
    });
    return;
  }
  if (col === "giveaway_entries") {
    if (old) {
      if (!editor(a, "ticket") && old.userId !== a.uid)
        fail(403, "Чужая заявка");
      if (next) fail(400, "Награждение выполняет сервер");
      await p.remove(path);
      return;
    }
    const event = await p.get(`events/${id(data.eventId)}`);
    if (!event) fail(404, "Мероприятие не найдено");
    const end = eventEndMillis(event);
    if (end && end <= p.at) fail(409, "Мероприятие завершено");
    if (
      !activeSubscription(a) ||
      (!["elite", "vip"].includes(a.private.subscriptionTier) && !a.admin)
    )
      fail(403, "Нужен активный Elite");
    const target = `giveaway_entries/${data.eventId}_${a.uid}`;
    if (await p.get(target)) fail(409, "Ты уже участвуешь");
    await p.put(target, {
      eventId: data.eventId,
      eventTitle: event.title || "",
      eventDate: event.date || p.at,
      eventLocation: event.location || "",
      eventImageUrl: event.imageUrl || "",
      userId: a.uid,
      userName: a.profile.name || "",
      userEmail: a.token.email || "",
      userHandle: a.profile.handle || "",
      userAvatar: a.profile.avatarUrl || "",
      subscriptionTier: a.private.subscriptionTier || "free",
      enteredAt: p.at,
      isWinner: false,
      status: "entered",
    });
    return;
  }
  if (col === "tickets" || col === "transactions") {
    return fail(403, "Билеты и платежи меняются через специальные операции", "ticket_record_protected");
  }
  if (col === "admin_invites") {
    if (!a.superadmin) fail(403, "Только суперадминистратор");
    if (next) {
      only(data, ["email", "role", "createdAt", "invitedBy"]);
      if (!roleList.includes(data.role) || data.role === "superadmin")
        fail(400, "Некорректная роль");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key))
        fail(400, "Некорректный email");
      await p.put(path, {
        email: key.toLowerCase(),
        role: data.role,
        createdAt: p.at,
        invitedBy: a.uid,
      });
    } else await p.remove(path);
    return;
  }
  if (["subscribers", "sponsorships", "businessInquiries"].includes(col)) {
    if (!editor(a, "content")) fail(403, "Нет доступа");
    if (next) {
      only(data, ["status"]);
      await p.put(path, next);
    } else await p.remove(path);
    return;
  }
  fail(403, "Операция запрещена");
}

async function invitationWrite(
  p: MutationPlan,
  op: Operation,
  key: string,
  old: any,
  next: any,
) {
  const a = p.actor,
    path = `agency_invitations/${key}`;
  if (!old) {
    const agency = agencyAccess(a);
    if ((await p.get(`agencies/${agency}`))?.linkedUserId !== a.uid)
      fail(403, "Агентство не связано с твоим аккаунтом");
    const d = op.data || {};
    only(d, [
      "modelUserId",
      "modelName",
      "modelEmail",
      "modelHandle",
      "agencyId",
      "agencyName",
      "invitedByUserId",
      "invitedByName",
      "invitedByUserName",
      "modelAvatar",
      "status",
      "createdAt",
    ]);
    id(d.modelUserId);
    if (d.modelUserId === a.uid) fail(400, "Нельзя пригласить себя");
    const target = await p.get(`users/${d.modelUserId}`);
    if (!target) fail(404, "Модель не найдена");
    if (target.hasModelBadge) fail(409, "Модель уже подтверждена");
    const stable = hash(agency + "|" + d.modelUserId),
      existing = await p.get(`agency_invitations/${stable}`);
    if (existing?.status === "pending") return;
    await p.put(`agency_invitations/${stable}`, {
      modelUserId: d.modelUserId,
      agencyId: agency,
      agencyName: a.account.representedAgencyName || "",
      invitedByUserId: a.uid,
      invitedByName: a.profile.name || "",
      status: "pending",
      createdAt: p.at,
    });
    await p.notification(d.modelUserId, `invite_${stable}_${p.at}`, {
      type: "agency_invitation",
      title: "Приглашение агентства",
      message: `${a.account.representedAgencyName || "Агентство"} приглашает тебя в команду`,
      link: "/dashboard?tab=model",
    });
    return;
  }
  if (op.kind === "delete") {
    if (!a.admin && old.invitedByUserId !== a.uid)
      fail(403, "Чужое приглашение");
    if (old.status === "pending")
      await p.patch(path, { status: "rejected", updatedAt: p.at });
    return;
  }
  only(op.data, [
    "status",
    "acceptedAt",
    "declinedAt",
    "rejectedAt",
    "updatedAt",
  ]);
  if (old.status !== "pending") fail(409, "Приглашение уже обработано");
  const status = next.status;
  if (a.uid === old.modelUserId && ["accepted", "declined"].includes(status)) {
    const rep = await p.get(`users/${id(old.invitedByUserId)}`),
      agency = await p.get(`agencies/${id(old.agencyId)}`);
    if (status === "accepted") {
      if (
        !rep ||
        rep.agencyVerificationStatus !== "approved" ||
        rep.representedAgencyId !== old.agencyId ||
        !agency ||
        agency.linkedUserId !== old.invitedByUserId
      )
        fail(403, "Агентство больше не подтверждено");
      const me = await p.get(`users/${a.uid}`);
      if (me?.hasModelBadge && me.modelAgencyId !== old.agencyId)
        fail(409, "Сначала покинь текущее агентство");
      await p.profile(a.uid, {
        isModel: true,
        hasModelBadge: true,
        modelVerificationStatus: "approved",
        modelAgencyId: old.agencyId,
        modelAgencyName: old.agencyName,
        modelVerifiedByAgency: old.agencyName,
        modelVerifiedByUserId: old.invitedByUserId,
        modelVerifiedAt: p.at,
      });
    }
    await p.patch(path, {
      status,
      [status === "accepted" ? "acceptedAt" : "declinedAt"]: p.at,
    });
    return;
  }
  if ((a.uid === old.invitedByUserId || a.admin) && status === "rejected") {
    await p.patch(path, { status: "rejected", updatedAt: p.at });
    return;
  }
  fail(403, "Нельзя принять чужое приглашение");
}

async function conversationWrite(
  p: MutationPlan,
  op: Operation,
  key: string,
  messageId: string | undefined,
  old: any,
  next: any,
) {
  const a = p.actor,
    root = `conversations/${key}`,
    conv = messageId ? await p.get(root) : old;
  if (!conv) fail(400, "Сначала создай диалог через сервер");
  if (!conv.participants?.includes(a.uid) && !a.admin)
    fail(403, "Ты не участник диалога");
  if (messageId) {
    const path = `${root}/messages/${messageId}`;
    if (!old) {
      if (conv.status !== "accepted" || conv.blockedBy?.length)
        fail(403, "Диалог не принят или заблокирован");
      const other = conv.participants.find((uid: string) => uid !== a.uid),
        otherPriv = await p.get(`users/${other}/private/account`);
      if (
        otherPriv?.blockedUsers?.includes(a.uid) ||
        a.private.blockedUsers?.includes(other)
      )
        fail(403, "Диалог заблокирован");
      only(op.data, [
        "conversationId",
        "senderId",
        "senderName",
        "senderAvatarUrl",
        "text",
        "imageUrl",
        "createdAt",
        "read",
        "readBy",
        "reactions",
        "audioUrl",
        "audioDuration",
        "waveform",
      ]);
      text(next.text, 5000, true);
      for (const k of ["imageUrl", "audioUrl"])
        if (next[k]) await p.privateAsset(next[k], "chat", conv.participants);
      if (!next.text?.trim() && !next.imageUrl && !next.audioUrl)
        fail(400, "Пустое сообщение");
      const d = {
        ...next,
        conversationId: key,
        senderId: a.uid,
        senderName: a.profile.name || "",
        senderAvatarUrl: a.profile.avatarUrl || "",
        createdAt: p.at,
        read: false,
        readBy: [a.uid],
        reactions: {},
      };
      if (
        d.waveform &&
        (!Array.isArray(d.waveform) ||
          d.waveform.length > 50 ||
          d.waveform.some((n: any) => typeof n !== "number" || n < 0 || n > 1))
      )
        fail(400, "Некорректная аудиодорожка");
      if (d.audioDuration && (d.audioDuration < 0 || d.audioDuration > 600))
        fail(400, "Запись слишком длинная");
      await p.put(path, d);
      await p.patch(root, {
        lastMessage: {
          text: d.text || (d.audioUrl ? "🎤 Voice message" : "📷 Photo"),
          senderId: a.uid,
          senderName: d.senderName,
          createdAt: p.at,
          readBy: [a.uid],
        },
        updatedAt: p.at,
        unreadCounts: {
          ...conv.unreadCounts,
          [other]: Number(conv.unreadCounts?.[other] || 0) + 1,
        },
        unreadFor: [...new Set([...(conv.unreadFor || []), other])].filter(
          (uid) => conv.participants.includes(uid),
        ),
      });
      return;
    }
    if (!next) {
      if (old.senderId !== a.uid && !a.admin) fail(403, "Чужое сообщение");
      await p.patch(path, {
        deletedForEveryone: true,
        text: "",
        imageUrl: "",
        audioUrl: "",
      });
      return;
    }
    only(op.data, [
      "text",
      "read",
      "readBy",
      "reactions",
      "deletedFor",
      "deletedForEveryone",
    ]);
    if ("text" in op.data || "deletedForEveryone" in op.data) {
      if (old.senderId !== a.uid && !a.admin) fail(403, "Чужое сообщение");
      text(next.text, 5000, true);
    }
    if ("reactions" in op.data) {
      boundedJson(next.reactions, 6000);
      for (const emoji of new Set([
        ...Object.keys(old.reactions || {}),
        ...Object.keys(next.reactions || {}),
      ])) {
        text(emoji, 24);
        const b = old.reactions?.[emoji] || [],
          n = next.reactions?.[emoji] || [];
        strings(n, 10);
        if (
          !equal(
            b.filter((x: string) => x !== a.uid),
            n.filter((x: string) => x !== a.uid),
          )
        )
          fail(403, "Чужая реакция");
      }
    }
    for (const k of ["readBy", "deletedFor"])
      if (k in op.data) {
        strings(next[k], 10);
        if (
          !equal(
            (old[k] || []).filter((x: string) => x !== a.uid),
            next[k].filter((x: string) => x !== a.uid),
          )
        )
          fail(403, "Чужая отметка");
      }
    if ("read" in op.data && next.read !== true)
      fail(403, "Некорректная отметка");
    await p.put(path, next);
    return;
  }
  if (op.kind === "delete") fail(400, "Диалог можно скрыть только для себя");
  only(op.data, [
    "status",
    "updatedAt",
    "unreadCounts",
    "deletedBy",
    "blockedBy",
    "clearedAt",
    `unreadCounts.${a.uid}`,
    `clearedAt.${a.uid}`,
  ]);
  if ("status" in op.data) {
    if (
      conv.status !== "pending" ||
      conv.recipientId !== a.uid ||
      !["accepted", "declined"].includes(next.status)
    )
      fail(403, "Только получатель может ответить на запрос");
    next.serverVerifiedAcceptance = next.status === "accepted";
    next.respondedAt = p.at;
  }
  for (const k of ["deletedBy", "blockedBy"])
    if (k in op.data) {
      strings(next[k], 10);
      if (
        !equal(
          (conv[k] || []).filter((x: string) => x !== a.uid),
          next[k].filter((x: string) => x !== a.uid),
        )
      )
        fail(403, "Чужая отметка");
    }
  for (const key of ["unreadCounts", "clearedAt"])
    if (op.data[key]) next[key] = { ...(conv[key] || {}), ...next[key] };
  for (const k of ["unreadCounts", "clearedAt"])
    if (k in op.data || `${k}.${a.uid}` in op.data) {
      for (const uid of Object.keys({ ...conv[k], ...next[k] }))
        if (uid !== a.uid && !equal(conv[k]?.[uid], next[k]?.[uid]))
          fail(403, "Чужая отметка");
      if (k === "unreadCounts" && next[k]?.[a.uid] !== 0)
        fail(403, "Можно только прочитать свои сообщения");
      if (k === "clearedAt") next[k][a.uid] = p.at;
    }
  next.unreadFor = conv.participants.filter(
    (uid: string) => Number(next.unreadCounts?.[uid] || 0) > 0,
  );
  await p.put(root, next);
}

export async function mutate(
  db: Firestore,
  token: DecodedIdToken,
  operations: Operation[],
  identity?: IdentityCipher,
) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 100
  )
    fail(400, "Некорректный пакет");
  boundedJson(operations, 380000);
  return db.runTransaction(async (t) => {
    const actor = await actorFor(db, token, t),
      plan = new MutationPlan(db, t, actor, now(), identity);
    for (const op of operations) await applyOperation(plan, op);
    plan.flush();
    return { ok: true };
  });
}

export async function publicForm(
  db: Firestore,
  col: string,
  data: any,
  sender?: { uid: string; email?: string },
) {
  const schemas: Record<string, string[]> = {
    subscribers: ["email", "whatsapp", "createdAt"],
    sponsorships: ["brandName", "email", "message", "createdAt", "status"],
    businessInquiries: [
      "name",
      "company",
      "phone",
      "email",
      "message",
      "userId",
      "userEmail",
      "createdAt",
    ],
  };
  if (!Object.hasOwn(schemas, col)) fail(400, "Неизвестная форма");
  only(data, schemas[col]);
  boundedJson(data, 12000);
  const email = text(data.email, 200).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Проверь email");
  for (const v of Object.values(data))
    if (typeof v === "string") text(v, 5000, true);
  const key = hash(
    col +
      "|" +
      email +
      "|" +
      (col === "subscribers"
        ? ""
        : hash(
            JSON.stringify({
              message: data.message || "",
              brandName: data.brandName || "",
              company: data.company || "",
              name: data.name || "",
            }),
          ) + new Date().toISOString().slice(0, 10)),
  );
  await db.runTransaction(async (t) => {
    const ref = db.doc(`${col}/${key}`),
      old = await t.get(ref);
    if (!old.exists)
      t.set(ref, {
        ...data,
        ...(col === "businessInquiries"
          ? { userId: sender?.uid || null, userEmail: sender?.email || null }
          : {}),
        email,
        ...(col === "sponsorships" ? { status: "pending" } : {}),
        createdAt: Timestamp.now(),
      });
  });
  return { ok: true };
}
