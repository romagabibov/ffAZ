import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { v2 as cloudinary } from "cloudinary";
import { identityPhotoFields, isIdentityCollection, isIdentityPhoto, maxIdentityPhotoBytes } from "../lib/identityPolicy.js";
import { fail, hash, millis } from "./security.js";

export type IdentityCipher = ReturnType<typeof createIdentityCipher>;
export type IdentityCloud = typeof cloudinary;
export const draftPhotoLifetime = 24 * 60 * 60 * 1000;
export const identityRecordPath = (path: string) => `identityRecords/${hash(path)}`;
export const identityMediaKey = (value: unknown) =>
  typeof value === "string" && /^\/api\/media\/[a-f0-9]{64}$/.test(value) ? value.slice(-64) : "";
export const identityAssetIds = (fields: Record<string, any>) =>
  [...new Set(identityPhotoFields.map((field) => identityMediaKey(fields[field])).filter(Boolean))];
export const identityMediaContext = (key: string, owner: string, purpose: string) =>
  JSON.stringify(["identity-photo", key, owner, purpose]);
const formContext = (path: string, owner: string) => JSON.stringify(["identity-application", path, owner]);

export function createIdentityCipher(activeKey: string, previousKeys = "") {
  const decode = (value: string) => {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, "base64").length !== 32) {
      throw new Error("Identity keys must be 32 random bytes encoded as base64");
    }
    return Buffer.from(value, "base64");
  };
  const active = decode(activeKey);
  const keyId = (key: Buffer) => hash(key.toString("base64")).slice(0, 16);
  const activeId = keyId(active);
  const keys = new Map([[activeId, active]]);
  for (const value of previousKeys.split(",").map((key) => key.trim()).filter(Boolean)) {
    const key = decode(value);
    keys.set(keyId(key), key);
  }

  return {
    seal(value: Buffer, context: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", active, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([Buffer.from(activeId, "hex"), iv, cipher.getAuthTag(), encrypted]);
    },
    open(value: Buffer, context: string) {
      const key = keys.get(value.subarray(0, 8).toString("hex"));
      if (value.length < 36 || !key) throw new Error("Identity key or encrypted data is invalid");
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(8, 20));
      cipher.setAAD(Buffer.from(context, "utf8"));
      cipher.setAuthTag(value.subarray(20, 36));
      return Buffer.concat([cipher.update(value.subarray(36)), cipher.final()]);
    },
  };
}

export function configuredIdentityCipher() {
  const key = process.env.AFW_IDENTITY_KEY?.trim();
  return key ? createIdentityCipher(key, process.env.AFW_IDENTITY_PREVIOUS_KEYS) : undefined;
}

export function requireIdentityCipher(cipher?: IdentityCipher) {
  return cipher || fail(503, "Защищённая верификация временно недоступна", "identity_unavailable");
}

export function addCalendarMonths(at: number, months: number) {
  const date = new Date(at);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(date.getTime());
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  return date.getTime();
}

export function identityDeadlines(reviewedAt: number) {
  const photoExpiry = addCalendarMonths(reviewedAt, 3);
  return {
    photo: Timestamp.fromMillis(photoExpiry),
    data: Timestamp.fromMillis(addCalendarMonths(photoExpiry, 6)),
  };
}

export function identitySummary(data: Record<string, any>) {
  const allowed = ["userId", "status", "createdAt", "reviewedAt", "reviewedBy", "identitySchema", "identityDataPresent", "identityMediaExpiresAt", "identityDataExpiresAt", "identityPurgedAt", "needsDocumentReupload"];
  return Object.fromEntries(allowed.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]));
}

export function sealIdentityFields(cipher: IdentityCipher, path: string, owner: string, fields: Record<string, any>) {
  return cipher.seal(Buffer.from(JSON.stringify(fields), "utf8"), formContext(path, owner)).toString("base64");
}

export function openIdentityFields(cipher: IdentityCipher, path: string, owner: string, ciphertext: string) {
  return JSON.parse(cipher.open(Buffer.from(ciphertext, "base64"), formContext(path, owner)).toString("utf8")) as Record<string, any>;
}

export function photoType(bytes: Buffer) {
  if (bytes.length < 12 || bytes.length > maxIdentityPhotoBytes) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export async function writeEncryptedPhoto(cloud: IdentityCloud, publicId: string, bytes: Buffer) {
  await new Promise<void>((resolve, reject) => {
    const upload = cloud.uploader.upload_stream({
      public_id: publicId, resource_type: "raw", type: "authenticated", overwrite: false, backup: false, timeout: 12000,
    }, (error, result) => {
      if (error || result?.public_id !== publicId || result.resource_type !== "raw" || result.type !== "authenticated") {
        reject(new Error("Encrypted upload was not confirmed"));
      } else resolve();
    });
    upload.once("error", reject);
    upload.end(bytes);
  });
}

type StoragePhoto = { publicId: string; resourceType: string; deliveryType: string; format?: string };
export class IdentityPhotoUnavailable extends Error {}

export async function readStoragePhoto(cloud: IdentityCloud, asset: StoragePhoto, limit: number) {
  const storageUrl = new URL(cloud.url(asset.publicId, {
    resource_type: asset.resourceType, type: asset.deliveryType, secure: true, sign_url: true,
    ...(asset.resourceType !== "raw" && asset.format ? { format: asset.format } : {}),
  }));
  if (storageUrl.protocol !== "https:" || storageUrl.hostname !== "res.cloudinary.com") {
    throw new Error("Unexpected identity storage host");
  }
  const response = await fetch(storageUrl, { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (response.status === 404) throw new IdentityPhotoUnavailable("Photo is missing from storage");
  if (!response.ok || !response.body) throw new Error("Private photo could not be read");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks, size);
      size += chunk.value.byteLength;
      if (size > limit) throw new IdentityPhotoUnavailable("Private photo is too large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function destroyStoredMedia(cloud: IdentityCloud, asset: Record<string, any>) {
  const options = {
    resource_type: asset.resourceType, type: asset.deliveryType, invalidate: true, timeout: 10000,
  };
  const result = await cloud.uploader.destroy(asset.publicId, options);
  if (result.result !== "ok" && result.result !== "not found") throw new Error("Media deletion was not confirmed");
}

export function photoCleanupAt(at: Timestamp | null) {
  return { identityPurgeAt: at, identityCleanupAfter: at };
}

export async function purgeIdentityRecords(db: Firestore, cloud: IdentityCloud, at = Date.now()) {
  const due = Timestamp.fromMillis(at);
  const stopAt = Date.now() + 45000;
  const [photos, records] = await Promise.all([
    db.collection("mediaAssets").where("identityCleanupAfter", "<=", due).orderBy("identityCleanupAfter").limit(32).get(),
    db.collection("identityRecords").where("expiresAt", "<=", due).orderBy("expiresAt").limit(80).get(),
  ]);
  let photosDeleted = 0, recordsDeleted = 0, failed = 0;
  const purgePhoto = async (document: (typeof photos.docs)[number]) => {
    try {
      const claimed = await db.runTransaction(async (tx) => {
        const asset = (await tx.get(document.ref)).data();
        if (!asset || !isIdentityPhoto(asset.purpose) || !asset.identityPurgeAt ||
            millis(asset.identityPurgeAt) > at || millis(asset.identityCleanupAfter) > at) return undefined;
        // A second invocation skips this item for 90 seconds. The expiry itself remains unchanged.
        tx.update(document.ref, { identityDeleting: true, identityCleanupAfter: Timestamp.fromMillis(at + 90000) });
        return asset;
      });
      if (!claimed) return;
      await destroyStoredMedia(cloud, claimed);
      if (claimed.legacyStorage) await destroyStoredMedia(cloud, claimed.legacyStorage);
      await document.ref.delete();
      photosDeleted++;
    } catch {
      failed++;
    }
  };

  const purgeRecord = async (document: (typeof records.docs)[number]) => {
    try {
      const removed = await db.runTransaction(async (tx) => {
        const record = (await tx.get(document.ref)).data();
        if (!record?.expiresAt || millis(record.expiresAt) > at) return false;
        const path = String(record.applicationPath || "");
        if (!isIdentityCollection(path.split("/")[0]) || identityRecordPath(path) !== document.ref.path) {
          throw new Error("Invalid identity record association");
        }
        const app = db.doc(path);
        const summary = await tx.get(app);
        tx.delete(document.ref);
        if (summary.data()?.userId === record.ownerUid) {
          tx.update(app, { identityDataPresent: false, identityPurgedAt: at, identityDataExpiresAt: FieldValue.delete() });
        }
        return true;
      });
      if (removed) recordsDeleted++;
    } catch {
      failed++;
    }
  };

  async function runBatches<T>(items: T[], action: (item: T) => Promise<void>) {
    for (let offset = 0; offset < items.length && Date.now() < stopAt; offset += 8) {
      await Promise.all(items.slice(offset, offset + 8).map(action));
    }
  }
  await Promise.all([runBatches(photos.docs, purgePhoto), runBatches(records.docs, purgeRecord)]);
  return { photosDeleted, recordsDeleted, failed };
}
