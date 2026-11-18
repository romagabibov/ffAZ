import crypto from "node:crypto";
import {
  Timestamp,
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "invalid_request",
  ) {
    super(message);
  }
}
export function fail(status: number, message: string, code?: string): never {
  throw new HttpError(status, message, code);
}
export const id = (v: unknown): string =>
  typeof v === "string" && /^[A-Za-z0-9_@.+:-]{1,180}$/.test(v)
    ? v
    : fail(400, "Некорректный идентификатор");
export const hash = (v: string) =>
  crypto.createHash("sha256").update(v).digest("hex");
export const now = () => Date.now();
export const millis = (v: any): number =>
  typeof v === "number" ? v : v?.toMillis?.() || Number(v?.seconds || 0) * 1000;
export const equal = (a: any, b: any) =>
  JSON.stringify(a) === JSON.stringify(b);
export function text(v: unknown, max = 3000, optional = false): string {
  if (v == null && optional) return "";
  if (typeof v !== "string" || v.length > max || (!optional && !v.trim()))
    return fail(400, "Проверь длину и формат текста");
  return v;
}
export function url(v: unknown, optional = true, privateOk = true): string {
  const s = text(v, 3000, optional);
  if (!s) return s;
  if (privateOk && /^\/api\/media\/[a-f0-9]{64}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" && !u.username && !u.password) return s;
  } catch {}
  return fail(400, "Нужна корректная HTTPS-ссылка");
}
export function boundedJson(value: any, maxBytes = 120000): void {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > maxBytes)
    fail(413, "Слишком большой документ");
  const walk = (v: any, depth: number) => {
    if (depth > 10) fail(400, "Слишком сложная структура");
    if (typeof v === "number" && !Number.isFinite(v))
      fail(400, "Некорректное число");
    if (typeof v === "string" && v.length > 100000)
      fail(413, "Слишком длинное поле");
    if (Array.isArray(v)) {
      if (v.length > 500) fail(413, "Слишком большой список");
      v.forEach((x) => walk(x, depth + 1));
    } else if (v && typeof v === "object" && !(v instanceof Timestamp)) {
      if (Object.keys(v).length > 120) fail(413, "Слишком много полей");
      for (const [k, x] of Object.entries(v)) {
        if (
          ["__proto__", "prototype", "constructor"].includes(k) ||
          k.length > 200
        )
          fail(400, "Некорректное поле");
        walk(x, depth + 1);
      }
    }
  };
  walk(value, 0);
}
export const only = (data: any, keys: string[]) => {
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== "object" ||
    Object.keys(data).some((k) => !keys.includes(k))
  )
    fail(400, "Недопустимые поля документа");
};
export const roleList = [
  "user",
  "admin",
  "superadmin",
  "news_editor",
  "content_editor",
  "ticket_editor",
];
export const publicKeys = [
  "name",
  "username",
  "handle",
  "bio",
  "avatarUrl",
  "photoURL",
  "links",
  "profileData",
  "onboardingComplete",
  "industry",
  "degree",
  "interestLevel",
  "ageGroup",
  "primaryGoal",
  "lastProfileUpdate",
  "lastLoginAt",
  "lastActiveAt",
  "feedLanguage",
  "following",
  "followers",
  "createdAt",
  "role",
  "brandName",
  "isModel",
  "hasModelBadge",
  "modelAgencyName",
  "modelAgencyId",
  "modelVerificationStatus",
  "modelVerifiedByAgency",
  "modelVerifiedByUserId",
  "modelVerifiedAt",
  "isAgency",
  "hasAgencyBadge",
  "agencyVerificationStatus",
  "agencyApplicationId",
  "linkedAgencyId",
  "isAgencyRepresentative",
  "representedAgencyId",
  "representedAgencyName",
  "agencyRole",
  "isDesigner",
  "designerBrandName",
  "designerId",
  "designerRole",
  "designerVerificationStatus",
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
  "declaredModelAgencyName",
  "declaredAgencyName",
  "declaredAgencyRole",
  "declaredDesignerId",
  "declaredDesignerRole",
];
export const selfPublicKeys = [
  "name",
  "username",
  "handle",
  "bio",
  "avatarUrl",
  "photoURL",
  "links",
  "profileData",
  "onboardingComplete",
  "industry",
  "degree",
  "interestLevel",
  "ageGroup",
  "primaryGoal",
  "lastProfileUpdate",
  "lastLoginAt",
  "lastActiveAt",
  "feedLanguage",
  "brandName",
  "isModel",
  "isAgency",
  "isDesigner",
  "designerBrandName",
  "declaredModelAgencyName",
  "declaredAgencyName",
  "declaredAgencyRole",
  "declaredDesignerId",
  "declaredDesignerRole",
];
const portfolioFields = {
  generalInfo: ["bio", "location", "headline", "website"],
  experience: ["id", "title", "company", "startDate", "endDate", "current", "description"],
  education: ["id", "school", "degree", "fieldOfStudy", "startDate", "endDate", "description"],
};
function publicPortfolio(data: any) {
  const fields = (value: any, keys: string[]) => Object.fromEntries(keys.flatMap((key) => {
    const item = value?.[key];
    if (key === "website" && (typeof item !== "string" || !item.startsWith("https://"))) return [];
    return (key === "current" ? typeof item === "boolean" : typeof item === "string") ? [[key, item]] : [];
  }));
  return {
    generalInfo: fields(data.generalInfo, portfolioFields.generalInfo),
    experience: Array.isArray(data.experience) ? data.experience.slice(0, 30).map((value: any) => fields(value, portfolioFields.experience)) : [],
    education: Array.isArray(data.education) ? data.education.slice(0, 30).map((value: any) => fields(value, portfolioFields.education)) : [],
    skills: Array.isArray(data.skills) ? data.skills.filter((value: any) => typeof value === "string").slice(0, 100) : [],
  };
}
export function publicDisplayName(value: unknown) {
  return typeof value === "string" && !/\b[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) ? value.trim().slice(0, 120) : "";
}

export function publicProfile(data: any, uid?: string): any {
  const out: any = {};
  for (const k of publicKeys) {
    const value = data?.[k];
    if (k === "name" && typeof value === "string") {
      out[k] = publicDisplayName(value) || "User";
    } else if (k === "profileData" && value && typeof value === "object") {
      out[k] = publicPortfolio(value);
    } else if (["following", "followers"].includes(k) && Array.isArray(value)) {
      out[k] = value.filter((item) => typeof item === "string");
    } else if (value === null || ["string", "boolean", "number"].includes(typeof value) || value instanceof Timestamp) {
      out[k] = value;
    }
  }
  if (!roleList.includes(out.role)) out.role = "user";
  if (uid) out.searchId = uid.toLowerCase();
  out.searchName = String(out.name || "").toLowerCase();
  out.searchHandle = String(out.username || out.handle || "")
    .replace(/^@/, "")
    .toLowerCase();
  return out;
}
export function validateProfile(data: any): void {
  boundedJson(data, 48000);
  for (const k of [
    "name",
    "username",
    "handle",
    "industry",
    "degree",
    "interestLevel",
    "ageGroup",
    "primaryGoal",
    "brandName",
    "designerBrandName",
    "declaredModelAgencyName",
    "declaredAgencyName",
    "declaredAgencyRole",
    "declaredDesignerId",
    "declaredDesignerRole",
  ])
    if (data[k] != null) text(data[k], k === "name" ? 120 : 200, true);
  if (data.bio != null) text(data.bio, 3000, true);
  if (data.links != null) text(data.links, 3000, true);
  for (const k of ["avatarUrl", "photoURL"])
    if (data[k]) url(data[k], true, false);
  for (const k of ["isModel", "isAgency", "isDesigner", "onboardingComplete"])
    if (data[k] != null && typeof data[k] !== "boolean")
      fail(400, "Некорректный переключатель");
  if (data.profileData) {
    only(data.profileData, [
      "generalInfo",
      "experience",
      "education",
      "skills",
    ]);
    const p = data.profileData;
    only(p.generalInfo || {}, portfolioFields.generalInfo);
    for (const [k, v] of Object.entries(p.generalInfo || {}))
      text(v, k === "bio" ? 3000 : 500, true);
    if (p.generalInfo?.website) url(p.generalInfo.website, true, false);
    for (const k of ["experience", "education"] as const) {
      if (p[k] == null) continue;
      if (!Array.isArray(p[k]) || p[k].length > 30)
        fail(400, "Слишком много записей портфолио");
      p[k].forEach((entry: any) => {
        boundedJson(entry, 6000);
        only(entry, portfolioFields[k]);
        for (const [key, value] of Object.entries(entry)) {
          if (key === "current") {
            if (typeof value !== "boolean")
              fail(400, "Некорректная запись опыта");
          } else text(value, 3000, true);
        }
      });
    }
    if (
      p.skills != null &&
      (!Array.isArray(p.skills) ||
        p.skills.length > 100 ||
        p.skills.some((v: any) => typeof v !== "string" || v.length > 120))
    )
      fail(400, "Некорректный список навыков");
  }
}
export interface Actor {
  uid: string;
  token: DecodedIdToken;
  account: any;
  profile: any;
  private: any;
  role: string;
  admin: boolean;
  superadmin: boolean;
  exists: { account: boolean; profile: boolean; private: boolean };
}
export async function actorFor(
  db: Firestore,
  token: DecodedIdToken,
  t?: Transaction,
): Promise<Actor> {
  const ref = db.doc(`users/${id(token.uid)}`),
    priv = db.doc(`users/${token.uid}/private/account`),
    profile = db.doc(`publicProfiles/${token.uid}`);
  const [a, b, c] = await Promise.all([
    t ? t.get(ref) : ref.get(),
    t ? t.get(priv) : priv.get(),
    t ? t.get(profile) : profile.get(),
  ]);
  const account = a.data() || {},
    privateData = b.data() || {},
    profileData = c.data() || publicProfile(account, token.uid);
  const role = roleList.includes(account.role) ? account.role : "user";
  return {
    uid: token.uid,
    token,
    account,
    profile: profileData,
    private: privateData,
    role,
    admin: ["admin", "superadmin"].includes(role),
    superadmin: role === "superadmin",
    exists: { account: a.exists, profile: c.exists, private: b.exists },
  };
}
export const editor = (a: Actor, kind: "content" | "news" | "ticket") =>
  a.admin || a.role === `${kind}_editor`;
export function activeSubscription(a: Actor): boolean {
  if (a.admin) return true;
  const p = a.private,
    tier = String(p.subscriptionTier || "free");
  return (
    ["pro", "elite", "business", "creator", "vip"].includes(tier) &&
    (!p.subscriptionValidUntil || millis(p.subscriptionValidUntil) > now()) &&
    (!p.subscriptionExpiresAt || millis(p.subscriptionExpiresAt) > now())
  );
}
export function communityAccess(a: Actor): boolean {
  return (
    activeSubscription(a) ||
    (a.account.designerVerificationStatus === "approved" &&
      a.account.isDesigner === true &&
      Boolean(a.account.designerId))
  );
}
export function agencyAccess(a: Actor): string {
  if (
    a.account.agencyVerificationStatus === "approved" &&
    a.account.hasAgencyBadge === true &&
    a.account.isAgencyRepresentative === true &&
    a.account.representedAgencyId
  )
    return id(a.account.representedAgencyId);
  return fail(403, "Нужно подтверждённое агентство");
}
export async function canReadPost(
  db: Firestore,
  a: Actor | undefined,
  post: any,
): Promise<boolean> {
  return (
    post &&
    (!post.isClosed ||
      Boolean(a && (post.userId === a.uid || communityAccess(a))))
  );
}

/** Shared distributed minute budgets: reserve small leases, not one counter write per click. */
export class LeaseLimiter {
  private leases = new Map<string, { window: number; remaining: number }>();
  constructor(private db: Firestore) {}
  async consume(
    subject: string,
    action: string,
    capacity = 120,
    leaseSize = 12,
  ): Promise<void> {
    const minute = Math.floor(now() / 60000),
      key = hash(subject + "|" + action),
      cached = this.leases.get(key);
    if (cached?.window === minute && cached.remaining > 0) {
      cached.remaining--;
      return;
    }
    const ref = this.db.doc(`_rateLimits/${key}`),
      size = Math.min(capacity, leaseSize);
    const granted = await this.db.runTransaction(async (t) => {
      const snap = await t.get(ref),
        d = snap.data() || {},
        used = d.window === minute ? Number(d.used || 0) : 0;
      if (used >= capacity)
        fail(
          429,
          "Слишком много действий. Попробуй через минуту.",
          "rate_limited",
        );
      const n = Math.min(size, capacity - used);
      t.set(ref, {
        window: minute,
        used: used + n,
        expiresAt: Timestamp.fromMillis((minute + 120) * 60000),
      });
      return n;
    });
    this.leases.set(key, { window: minute, remaining: granted - 1 });
    if (this.leases.size > 5000)
      for (const [k, v] of this.leases)
        if (v.window !== minute) this.leases.delete(k);
  }
}
export function expandTransforms(value: any, existing: any, at = now()): any {
  if (value && typeof value === "object" && typeof value.__afwOp === "string") {
    if (value.__afwOp === "timestamp") return Timestamp.fromMillis(at);
    if (value.__afwOp === "increment") {
      if (!Number.isFinite(value.value) || Math.abs(value.value) > 1000000)
        fail(400, "Некорректный счётчик");
      return Number(existing || 0) + value.value;
    }
    if (value.__afwOp === "union") {
      const xs = Array.isArray(existing) ? existing : [];
      return [
        ...xs,
        ...value.values.filter((v: any) => !xs.some((x: any) => equal(v, x))),
      ];
    }
    if (value.__afwOp === "remove")
      return (Array.isArray(existing) ? existing : []).filter(
        (v: any) => !value.values.some((x: any) => equal(v, x)),
      );
    if (value.__afwOp === "delete") return undefined;
    fail(400, "Неизвестная операция");
  }
  if (Array.isArray(value))
    return value.map((v) => expandTransforms(v, undefined, at));
  if (value && typeof value === "object" && !(value instanceof Timestamp)) {
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      const x = expandTransforms(v, existing?.[k], at);
      if (x !== undefined) result[k] = x;
    }
    return result;
  }
  return value;
}
export function patchData(before: any, patch: any, at = now()): any {
  const out = { ...before };
  for (const [key, value] of Object.entries(patch || {})) {
    const parts = key.split(".");
    if (
      parts.some(
        (k) => !k || ["__proto__", "prototype", "constructor"].includes(k),
      )
    )
      fail(400, "Некорректное поле");
    let target = out;
    for (const k of parts.slice(0, -1)) {
      target[k] = { ...(target[k] || {}) };
      target = target[k];
    }
    const k = parts.at(-1)!;
    const next = expandTransforms(value, target[k], at);
    if (next === undefined) delete target[k];
    else target[k] = next;
  }
  return out;
}
