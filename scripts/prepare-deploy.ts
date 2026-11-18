/** Runs only in the user's deployment. No cloud credentials are included in this archive. */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { FieldValue, Timestamp, type DocumentReference, type Query, type QuerySnapshot } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { initializeRuntime } from "../src/server/runtime";
import { hash, millis, publicDisplayName, publicProfile } from "../src/server/security";
import { extractCloudinaryInfo } from "../src/server/app";
import { identityCollections, identityPhotoFields, maxIdentityPhotoBytes } from "../src/lib/identityPolicy";
import {
  configuredIdentityCipher, destroyStoredMedia, IdentityPhotoUnavailable, identityAssetIds, identityDeadlines,
  identityMediaContext, identityMediaKey, identityRecordPath, identitySummary,
  photoCleanupAt, photoType, readStoragePhoto, requireIdentityCipher, sealIdentityFields, writeEncryptedPhoto,
} from "../src/server/identity";
import config from "../firebase-applet-config.json";
const project = config.projectId;
const database = config.firestoreDatabaseId || "(default)";
const explicitApply = process.argv.includes("--apply") ||
  (process.env.VERCEL_ENV === "production" && process.env.AFW_PREPARE_FIREBASE === "1");
if (!explicitApply || process.argv.includes("--dry-run") || process.argv.includes("--plan")) {
  console.log("Firebase preparation target: " + project + " / " + database);
  console.log("Plan only. To apply with configured server credentials, run npm run firebase:prepare -- --apply.");
  process.exit(0);
}
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production")
  throw new Error("Firebase preparation is disabled in Preview and Development");
const { db, adminApp, cloudinary: cloud } = initializeRuntime();
const identity = requireIdentityCipher(configuredIdentityCipher());
if ((process.env.CRON_SECRET?.trim() || "").length < 32) throw new Error("Set CRON_SECRET before preparing protected forms");
if (
  !process.env.FIRESTORE_EMULATOR_HOST &&
  ![
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ].every((k) => Boolean(process.env[k]))
)
  throw new Error(
    "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET before deployment",
  );
const credential = adminApp.options.credential!;
const readBudget = Number(process.env.AFW_PREPARE_READ_BUDGET || 8000);
if (!Number.isInteger(readBudget) || readBudget < 200 || readBudget > 20000)
  throw new Error("AFW_PREPARE_READ_BUDGET must be between 200 and 20000");
let documentReads = 0;
const lease = db.doc("_system/preparationLeaseV2");
const leaseId = randomUUID();
let hasLease = false;
async function acquireLease() {
  await db.runTransaction(async (transaction) => {
    reserveReads(1);
    const state = (await transaction.get(lease)).data();
    if (state?.expiresAt > Date.now())
      throw new Error("Another Firebase preparation is running");
    transaction.set(lease, { id: leaseId, expiresAt: Date.now() + 60 * 60_000 });
  });
  hasLease = true;
}
async function releaseLease() {
  if (!hasLease) return;
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(lease)).data()?.id === leaseId) transaction.delete(lease);
  });
}
function reserveReads(count: number) {
  if (documentReads + count > readBudget)
    throw new Error("Firebase preparation reached the read budget. Run preparation again to continue from the saved page.");
  documentReads += count;
}
async function readDoc(ref: DocumentReference) {
  reserveReads(1);
  return ref.get();
}
async function readPage(q: Query, cap: number) {
  reserveReads(cap);
  const page = await q.get();
  documentReads -= cap - Math.max(1, page.size);
  return page;
}
async function scan(
  name: string,
  collection: string,
  pageSize: number,
  apply: (page: QuerySnapshot) => Promise<void>,
  options: { source?: Query; prefix?: string } = {},
) {
  const checkpoint = db.doc("_system/preparationV2_" + name);
  const saved = (await readDoc(checkpoint)).data();
  if (saved?.complete) return;
  let cursor: string | undefined = saved?.cursor;
  while (true) {
    let q = (options.source || db.collection(collection)).orderBy("__name__").limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    else if (options.prefix) q = q.startAt(options.prefix);
    if (options.prefix) q = q.endAt(options.prefix + "\uf8ff");
    const page = await readPage(q, pageSize);
    if (!page.empty) await apply(page);
    cursor = page.docs.at(-1)?.id || cursor;
    const complete = page.size < pageSize;
    await checkpoint.set({ cursor: cursor || null, complete, updatedAt: Timestamp.now() });
    if (complete) return;
  }
}
async function api(path: string, method = "GET", body?: any) {
  const { access_token } = await credential.getAccessToken();
  const response = await fetch(
    `https://firebaserules.googleapis.com/v1/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `Firebase Rules request failed (${response.status}): ${value.error?.status || "unknown"}. Check Firebase Rules Admin permissions.`,
    );
  return value;
}
async function rules() {
  const content = await readFile("firestore.rules", "utf8"),
    stateRef = db.doc("_system/securityRules"),
    state = (await readDoc(stateRef)).data();
  let liveRelease: any = null;
  try {
    liveRelease = await api(
      `projects/${project}/releases/cloud.firestore/${database}`,
    );
  } catch (error: any) {
    if (!error.message.includes("(404)")) throw error;
  }
  if (
    state?.sha256 === hash(content) &&
    state.database === database &&
    liveRelease?.rulesetName === state.rulesetName
  ) {
    console.log("Security rules already prepared for the configured database");
    return;
  }
  const created = await api(`projects/${project}/rulesets`, "POST", {
    source: { files: [{ name: "firestore.rules", content }] },
    attachment_point: `firestore.googleapis.com/projects/${config.messagingSenderId}/databases/${database}`,
  });
  const name = `projects/${project}/releases/cloud.firestore/${database}`;
  const previous = liveRelease;
  if (previous)
    await api(name, "PATCH", {
      release: { name, rulesetName: created.name },
      updateMask: "rulesetName",
    });
  else
    await api(`projects/${project}/releases`, "POST", {
      name,
      rulesetName: created.name,
    });
  await stateRef.set({
    sha256: hash(content),
    database,
    rulesetName: created.name,
    previousRulesetName: previous?.rulesetName || null,
    preparedAt: Timestamp.now(),
  });
  console.log("Deployed rules to the configured named database");
}
async function indexes() {
  const wanted = JSON.parse(await readFile("firestore.indexes.json", "utf8"));
  const { access_token } = await credential.getAccessToken(),
    base = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/collectionGroups`;
  const fingerprint = hash(JSON.stringify(wanted));
  const ref = db.doc("_system/securityIndexes");
  if ((await readDoc(ref)).data()?.sha256 === fingerprint) return;
  for (const index of wanted.indexes) {
    const url = `${base}/${encodeURIComponent(index.collectionGroup)}/indexes`,
      headers = {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      };
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queryScope: index.queryScope,
        fields: index.fields,
      }),
    });
    if (!response.ok && response.status !== 409) {
      const data = await response.json();
      throw new Error(
        `Index ${index.collectionGroup}: ${data.error?.status || response.status}. Check Datastore Index Admin permissions.`,
      );
    }
  }
  for (const field of wanted.fieldOverrides || []) {
    const response = await fetch(
      `${base}/${encodeURIComponent(field.collectionGroup)}/fields/${encodeURIComponent(field.fieldPath)}?updateMask=indexConfig`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `projects/${project}/databases/${database}/collectionGroups/${field.collectionGroup}/fields/${field.fieldPath}`,
          indexConfig: { indexes: field.indexes },
        }),
      },
    );
    if (!response.ok) {
      const body = await response.json();
      throw new Error(
        `Field indexing ${field.collectionGroup}/${field.fieldPath}: ${body.error?.status || response.status}`,
      );
    }
  }
  await ref.set({ sha256: fingerprint, preparedAt: Timestamp.now() });
  console.log(
    "Required indexes submitted; a new index can take several minutes to become ready",
  );
}
const privateFields = [
  "email",
  "blockedUsers",
  "subscriptionTier",
  "subscriptionValidUntil",
  "subscriptionExpiresAt",
  "subscriptionGrantedByAdmin",
  "subscriptionGrantedAt",
  "singleJobCredits",
  "hasJobPostingAccess",
  "warnings",
];
async function profiles() {
  const state = db.doc("_system/profileSeparationV1");
  if ((await readDoc(state)).exists) return;
  let processed = 0, resetModels = 0;
  await scan("profiles", "users", 25, async (page) => {
    for (const user of page.docs) {
      const old = user.data(),
        privRef = db.doc(`users/${user.id}/private/account`),
        publicRef = db.doc(`publicProfiles/${user.id}`),
        [priv, pub] = await Promise.all([readDoc(privRef), readDoc(publicRef)]);
      const privateData: any = { ...priv.data() };
      for (const key of privateFields)
        if (privateData[key] === undefined && old[key] !== undefined)
          privateData[key] = old[key];
      for (const key of ["subscriptionValidUntil", "subscriptionExpiresAt"])
        if (privateData[key]) privateData[key] = millis(privateData[key]);
      if (!privateData.subscriptionTier) privateData.subscriptionTier = "free";
      let authority = { ...old };
      if (old.hasModelBadge) {
        const invitations = await readPage(db.collection("agency_invitations")
          .where("modelUserId", "==", user.id)
          .where("status", "==", "accepted")
          .limit(20), 20);
        let valid = false;
        for (const invite of invitations.docs) {
          const v = invite.data();
          if (
            !v.agencyId ||
            v.agencyId !== old.modelAgencyId ||
            !v.invitedByUserId
          )
            continue;
          const [rep, agency] = await Promise.all([
            readDoc(db.doc(`users/${v.invitedByUserId}`)),
            readDoc(db.doc(`agencies/${v.agencyId}`)),
          ]);
          if (
            rep.data()?.hasAgencyBadge === true &&
            rep.data()?.agencyVerificationStatus === "approved" &&
            rep.data()?.representedAgencyId === v.agencyId &&
            agency.data()?.linkedUserId === v.invitedByUserId
          ) {
            valid = true;
            break;
          }
        }
        if (!valid) {
          authority = {
            ...authority,
            hasModelBadge: false,
            modelVerificationStatus: "none",
            modelAgencyId: "",
            modelAgencyName: "",
            modelVerifiedByAgency: "",
            modelVerifiedByUserId: "",
            modelVerifiedAt: null,
          };
          resetModels++;
        }
      }
      const batch = db.batch();
      if (
        !(await readDoc(db.doc(`_migrationBackups/profilesV1_${user.id}`))).exists
      )
        batch.set(db.doc(`_migrationBackups/profilesV1_${user.id}`), {
          account: old,
          privateAccount: priv.data() || {},
          savedAt: Timestamp.now(),
        });
      if (!pub.exists) batch.set(publicRef, publicProfile(authority, user.id));
      else if (authority.hasModelBadge !== old.hasModelBadge)
        batch.set(
          publicRef,
          {
            hasModelBadge: false,
            modelVerificationStatus: "none",
            modelAgencyId: "",
            modelAgencyName: "",
          },
          { merge: true },
        );
      if (
        !priv.exists ||
        JSON.stringify(priv.data()) !== JSON.stringify(privateData)
      )
        batch.set(privRef, privateData);
      if (authority.hasModelBadge !== old.hasModelBadge)
        batch.set(user.ref, authority);
      const username = String(old.username || old.handle || "")
        .replace(/^@/, "")
        .toLowerCase();
      if (/^[a-z0-9_.]{3,40}$/.test(username)) {
        const claim = db.doc(`_handles/${username}`);
        await db.runTransaction(async (t) => {
          reserveReads(1);
          if (!(await t.get(claim)).exists) t.set(claim, { uid: user.id });
        });
      }
      await batch.commit();
      processed++;
    }
  });
  // Migrate posts missing the explicit visibility discriminator used by the bounded query.
  await scan("feed", "feedPosts", 100, async (page) => {
    const b = db.batch();
    page.docs
      .filter((d) => typeof d.data().isClosed !== "boolean")
      .forEach((d) => b.update(d.ref, { isClosed: false }));
    await b.commit();
  });
  // Historic acceptance was client-writable, so a real recipient must confirm legacy requests once.
  await scan("conversations", "conversations", 100, async (page) => {
    const batch = db.batch();
    for (const d of page.docs) {
      const c = d.data(),
        participants = Array.isArray(c.participants)
          ? [
              ...new Set(
                c.participants.filter((u: any) => typeof u === "string"),
              ),
            ]
          : [],
        patch: any = {
          unreadFor: participants.filter(
            (u) => Number(c.unreadCounts?.[u] || 0) > 0,
          ),
        };
      if (!c.serverVerifiedAcceptance && c.status === "accepted") {
        patch.status = participants.length === 2 ? "pending" : "declined";
        patch.requiresReconfirmation = true;
        if (participants.length === 2) {
          patch.requestedBy = participants.includes(c.requestedBy)
            ? c.requestedBy
            : participants[0];
          patch.recipientId = participants.find((u) => u !== patch.requestedBy);
        }
      }
      if (Object.keys(patch).some(key => JSON.stringify(patch[key]) !== JSON.stringify(c[key])))
        batch.update(d.ref, patch);
    }
    await batch.commit();
  });
  // Notification range queries use one consistent numeric clock, including historic serverTimestamp records.
  await scan("notifications", "notifications", 100, async (page) => {
    const batch = db.batch();
    for (const d of page.docs) {
      const value = d.data().createdAt;
      if (value && typeof value !== "number")
        batch.update(d.ref, { createdAt: millis(value) });
    }
    await batch.commit();
  });
  await state.set({ completedAt: Timestamp.now(), processed, resetModels });
  console.log(
    `Profile migration completed: ${processed} profiles. Model badges requiring a real invitation: ${resetModels}.`,
  );
}
async function media() {
  const state = db.doc("_system/privateMediaV2");
  if ((await readDoc(state)).exists) return;
  let converted = 0,
    quarantined = 0;
  for (const collection of [
    "jobApplications",
    "needleApplications",
  ]) {
    await scan("media_" + collection, collection, 50, async (page) => {
      for (const document of page.docs) {
        const data = document.data(),
          updates: any = {};
        const oldUrls = new Set<string>();
        for (const field of [
          "idCardPhotoUrl",
          "idDocumentUrl",
          "personalPhotoUrl",
          "cvUrl",
          "resumeUrl",
        ]) {
          const value = data[field];
          if (typeof value !== "string" || !value || value.startsWith("/api/media/")) continue;
          const info = extractCloudinaryInfo(value);
          if (!info || !value.includes(`/${cloud.config().cloud_name}/`)) {
            updates[field] = "";
            updates.needsDocumentReupload = true;
            if (collection !== "jobApplications") {
              updates.status = "rejected";
              updates.rejectionReason =
                "Повторно загрузите документ через защищённую загрузку.";
            }
            quarantined++;
            oldUrls.add(value);
            continue;
          }
          if (!cloud.config().api_secret)
            throw new Error(
              "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to protect existing documents",
            );
          const publicId = `afw/${data.userId}/legacy-${hash(value).slice(0, 36)}${info.resourceType === "raw" ? ".pdf" : ""}`,
            key = hash(publicId),
            ref = db.doc(`mediaAssets/${key}`);
          let asset: any;
          if ((await readDoc(ref)).exists) {
            updates[field] = `/api/media/${key}`;
            oldUrls.add(value);
            continue;
          }
          try {
            asset = await cloud.uploader.rename(info.publicId, publicId, {
              resource_type: info.resourceType,
              type: value.includes("/authenticated/")
                ? "authenticated"
                : "upload",
              to_type: "authenticated",
              invalidate: true,
              overwrite: false,
            });
          } catch (error: any) {
            try {
              asset = await cloud.api.resource(publicId, {
                resource_type: info.resourceType,
                type: "authenticated",
              });
            } catch {
              throw new Error(
                `Could not protect a legacy file in ${collection}. No deploy was published. Review the source asset permissions in Cloudinary.`,
              );
            }
          }
          const record = {
            ownerUid: data.userId,
            publicId,
            resourceType: info.resourceType,
            deliveryType: "authenticated",
            purpose:
              (field === "cvUrl" || field === "resumeUrl")
                ? "cv"
                : field === "personalPhotoUrl"
                  ? "verification_photo"
                  : "id_document",
            format:
              asset.format || (info.resourceType === "raw" ? "pdf" : "jpg"),
            secureUrl: asset.secure_url || "",
            allowedUserIds:
              (field === "cvUrl" || field === "resumeUrl") && data.employerId ? [data.employerId] : [],
            createdAt: Timestamp.now(),
          };
          await ref.set(record);
          updates[field] = `/api/media/${key}`;
          oldUrls.add(value);
          converted++;
        }
        if (Object.keys(updates).length) {
          const batch = db.batch();
          batch.set(db.doc(`_migrationBackups/mediaV2_${collection}_${document.id}`),
            { data, savedAt: Timestamp.now() });
          for (const oldUrl of oldUrls) {
            batch.set(db.doc("_migrationMediaLinksV2/" + hash(oldUrl)), { migrated: true });
          }
          batch.update(document.ref, updates);
          await batch.commit();
        }
      }
    });
  }
  // Keep cleanup resumable even when a previous run already replaced the source URLs.
  for (const col of ["agencies", "designers"]) {
    await scan("catalogue_" + col, col, 50, async (page) => {
      const batch = db.batch();
      for (const d of page.docs) {
        const patch: Record<string, string> = {};
        for (const key of ["image", "imageUrl", "photoUrl", "photoURL"]) {
          const value = d.data()[key];
          if (typeof value === "string" && value &&
              (await readDoc(db.doc("_migrationMediaLinksV2/" + hash(value)))).exists) patch[key] = "";
        }
        if (Object.keys(patch).length) batch.update(d.ref, patch);
      }
      await batch.commit();
    });
  }
  await state.set({ completedAt: Timestamp.now(), converted, quarantined });
  console.log(
    `Private files: ${converted} protected; ${quarantined} external/unmanaged links removed and flagged for re-upload. Previously published external files require removal at their original host.`,
  );
}

async function findLegacyPhoto(value: string, purpose: string, owner: string) {
  const existingKey = identityMediaKey(value);
  if (existingKey) {
    const asset = (await readDoc(db.doc(`mediaAssets/${existingKey}`))).data();
    if (!asset || asset.ownerUid !== owner || asset.purpose !== purpose || asset.deliveryType !== "authenticated") return undefined;
    return { key: existingKey, asset };
  }
  const info = extractCloudinaryInfo(value);
  if (!info || new URL(value).pathname.split("/")[1] !== cloud.config().cloud_name) return undefined;
  const key = hash(info.publicId);
  const existing = (await readDoc(db.doc(`mediaAssets/${key}`))).data();
  if (existing?.ownerUid !== owner || existing.purpose !== purpose || existing.resourceType !== info.resourceType) return undefined;
  return { key, asset: existing };
}

async function encryptLegacyPhoto(key: string, asset: Record<string, any>, owner: string, purpose: string) {
  if (asset.identityEncrypted) return asset.identityReady === true;
  if (asset.bytes > maxIdentityPhotoBytes || asset.resourceType !== "image") return false;
  const bytes = await readStoragePhoto(cloud, asset as any, maxIdentityPhotoBytes).catch((error) => {
    if (error instanceof IdentityPhotoUnavailable) return null;
    throw error;
  });
  if (!bytes) return false;
  const mime = photoType(bytes);
  if (!mime) return false;
  const publicId = `afw/identity/migrated-${key}.bin`;
  const context = identityMediaContext(key, owner, purpose);
  const storage = { publicId, resourceType: "raw", deliveryType: "authenticated" };
  try {
    await writeEncryptedPhoto(cloud, publicId, identity.seal(bytes, context));
  } catch {
    // Retries verify the exact encrypted object that a preceding attempt may have written.
  }
  const encrypted = await readStoragePhoto(cloud, storage, maxIdentityPhotoBytes + 36);
  if (!identity.open(encrypted, context).equals(bytes)) throw new Error("Legacy identity copy could not be verified");
  const legacyStorage = { publicId: asset.publicId, resourceType: asset.resourceType, deliveryType: asset.deliveryType };
  await db.doc(`mediaAssets/${key}`).set({ ...storage, ownerUid: owner, purpose, mime, identityEncrypted: true, identityReady: true,
    createdAt: asset.createdAt || Timestamp.now(), legacyStorage });
  return true;
}

async function protectIdentityApplications() {
  let processed = 0, reuploads = 0, externalLinks = 0;
  for (const collection of identityCollections) {
    await scan(`identityV3_${collection}`, collection, 12, async (page) => {
      for (const document of page.docs) {
        const data = document.data();
        if (data.identitySchema === 3) continue;
        const path = document.ref.path;
        const owner = typeof data.userId === "string" && data.userId.length <= 180 ? data.userId : "";
        const summary = identitySummary(data);
        summary.identitySchema = 3;
        if (!Number.isFinite(millis(summary.createdAt)) || millis(summary.createdAt) <= 0) summary.createdAt = 0;
        else summary.createdAt = millis(summary.createdAt);
        const decided = ["approved", "rejected"].includes(summary.status);
        if (decided) {
          const oldReviewedAt = millis(summary.reviewedAt);
          // Unknown review dates get the full retention window starting at migration.
          summary.reviewedAt = oldReviewedAt > 0 && oldReviewedAt <= Date.now() ? oldReviewedAt : Date.now();
        } else {
          summary.status = "pending";
          delete summary.reviewedAt;
          delete summary.reviewedBy;
        }
        const deadlines = decided ? identityDeadlines(summary.reviewedAt) : null;
        const fields: Record<string, any> = { ...data };
        for (const field of Object.keys(summary)) delete fields[field];
        delete fields.reviewedAt;
        delete fields.reviewedBy;
        const batch = db.batch();
        const originalLinks = new Set<string>();
        const seen = new Map<string, string>();
        const photos = new Map<string, string>();
        const legacyToDelete = new Map<string, { publicId: string; resourceType: string; deliveryType: string }>();
        for (const field of identityPhotoFields) {
          const value = data[field];
          delete fields[field];
          if (!owner || typeof value !== "string" || !value) continue;
          const purpose = field === "personalPhotoUrl" ? "verification_photo" : "id_document";
          const marker = `${purpose}:${value}`;
          if (seen.has(marker)) {
            if (seen.get(marker)) fields[field] = seen.get(marker);
            continue;
          }
          seen.set(marker, "");
          if (!identityMediaKey(value)) originalLinks.add(value);
          const found = await findLegacyPhoto(value, purpose, owner);
          if (!found) {
            if (!identityMediaKey(value)) externalLinks++;
            continue;
          }
          const { key, asset } = found;
          if (asset.identityApplicationPath && asset.identityApplicationPath !== path) continue;
          const preservedPhoto = photos.get(purpose);
          if (preservedPhoto === key) {
            fields[field] = `/api/media/${key}`;
            seen.set(marker, fields[field]);
            continue;
          }
          const assetRef = db.doc(`mediaAssets/${key}`);
          const due = deadlines && deadlines.photo.toMillis() <= Date.now();
          if (due || preservedPhoto || !(await encryptLegacyPhoto(key, asset, owner, purpose))) {
            batch.set(assetRef, { ...asset, ownerUid: owner, purpose, identityApplicationPath: path,
              identityDeleting: true, ...photoCleanupAt(due ? deadlines.photo : Timestamp.now()) }, { merge: true });
            continue;
          }
          const original = asset.identityEncrypted ? asset.legacyStorage : asset;
          if (original) legacyToDelete.set(key, original);
          batch.update(assetRef, { identityApplicationPath: path, ...photoCleanupAt(deadlines?.photo || null) });
          fields[field] = `/api/media/${key}`;
          seen.set(marker, fields[field]);
          photos.set(purpose, key);
        }
        if (!decided && (!(fields.idCardPhotoUrl || fields.idDocumentUrl) || !fields.personalPhotoUrl)) {
          summary.needsDocumentReupload = true;
          reuploads++;
        }
        if (!owner || (deadlines && deadlines.data.toMillis() <= Date.now())) {
          summary.identityDataPresent = false;
          summary.identityPurgedAt = Date.now();
        } else {
          summary.identityDataPresent = true;
          if (deadlines) {
            summary.identityMediaExpiresAt = deadlines.photo;
            summary.identityDataExpiresAt = deadlines.data;
          }
          batch.set(db.doc(identityRecordPath(path)), {
            ownerUid: owner, applicationPath: path, assetIds: identityAssetIds(fields),
            ciphertext: sealIdentityFields(identity, path, owner, fields), expiresAt: deadlines?.data || null,
          });
        }
        for (const url of originalLinks) batch.set(db.doc(`_migrationMediaLinksV2/${hash(url)}`), { migrated: true });
        const catalogue = collection === "agency_applications" ? "agencies" : "designers";
        if (owner && (data.agencyAddress || data.brandAddress || data.comment || originalLinks.size)) {
          const entries = await readPage(db.collection(catalogue).where("linkedUserId", "==", owner).limit(10), 10);
          for (const entry of entries.docs) {
            const card = entry.data();
            const patch: Record<string, string> = {};
            if (card.location && [data.agencyAddress, data.brandAddress].includes(card.location)) patch.location = "";
            for (const field of ["description", "details"]) if (data.comment && card[field] === data.comment) patch[field] = "";
            for (const field of ["image", "imageUrl", "photoUrl", "photoURL"]) if (originalLinks.has(card[field])) patch[field] = "";
            if (Object.keys(patch).length) batch.update(entry.ref, patch);
          }
        }
        // The new encrypted objects were read back before retiring the originals.
        for (const [key, original] of legacyToDelete) {
          await destroyStoredMedia(cloud, original);
          batch.update(db.doc(`mediaAssets/${key}`), { legacyStorage: FieldValue.delete() });
        }
        batch.set(document.ref, summary);
        batch.delete(db.doc(`_migrationBackups/mediaV2_${collection}_${document.id}`));
        await batch.commit();
        processed++;
      }
    });
    await scan(`identityV3_backups_${collection}`, "_migrationBackups", 30, async (page) => {
      const batch = db.batch();
      for (const backup of page.docs) batch.delete(backup.ref);
      await batch.commit();
    }, { prefix: `mediaV2_${collection}_` });
  }
  await scan("identityV3_unattached", "mediaAssets", 30, async (page) => {
    const batch = db.batch();
    for (const document of page.docs) {
      const asset = document.data();
      if (!asset.identityApplicationPath && !asset.identityPurgeAt) batch.update(document.ref, photoCleanupAt(Timestamp.now()));
    }
    await batch.commit();
  }, { source: db.collection("mediaAssets").where("purpose", "in", ["id_document", "verification_photo"]) });
  await scan("identityV3_catalogue_agencies", "agencies", 25, clearLegacyCataloguePhotos);
  await scan("identityV3_catalogue_designers", "designers", 25, clearLegacyCataloguePhotos);
  console.log(`Identity applications: ${processed} processed; ${reuploads} need a new upload; ${externalLinks} links outside this storage need review.`);
}

async function clearLegacyCataloguePhotos(page: QuerySnapshot) {
  const batch = db.batch();
  for (const doc of page.docs) {
    const patch: Record<string, string> = {};
    const data = doc.data();
    for (const field of ["linkedUserName", "designerName", "founder"]) {
      const value = data[field];
      if (typeof value === "string" && value.trim() && !publicDisplayName(value)) patch[field] = "";
    }
    if (typeof data.linkedUserHandle === "string" && data.linkedUserHandle &&
        !/^@?[a-z0-9_.]{3,40}$/i.test(data.linkedUserHandle)) patch.linkedUserHandle = "";
    for (const field of ["image", "imageUrl", "photoUrl", "photoURL"]) {
      const value = data[field];
      if (typeof value === "string" && value &&
          (await readDoc(db.doc(`_migrationMediaLinksV2/${hash(value)}`))).exists) patch[field] = "";
    }
    if (Object.keys(patch).length) batch.update(doc.ref, patch);
  }
  await batch.commit();
}

async function retireV2() {
  const old = db.doc("_system/releaseReadyV2");
  const cutover = db.doc("_system/identityV3Cutover");
  const restartAt = await db.runTransaction(async (transaction) => {
    reserveReads(2);
    const [release, state] = await transaction.getAll(old, cutover);
    if (!release.exists) return millis(state.data()?.restartAt);
    // Wait for the longest v2 readiness cache and for outstanding v2 requests.
    const at = Date.now() + 11 * 60_000;
    transaction.delete(old);
    transaction.set(cutover, { restartAt: Timestamp.fromMillis(at) });
    return at;
  });
  if (restartAt > Date.now()) {
    throw new Error(`V2 API was stopped for identity migration. Retry preparation after ${new Date(restartAt).toISOString()}.`);
  }
}

async function initialSuperadmin() {
  const existing = await readPage(db.collection("users").where("role", "==", "superadmin").limit(1), 1);
  if (!existing.empty) return;
  const uid = process.env.AFW_INITIAL_SUPERADMIN_UID?.trim();
  if (!uid || uid.includes("/") || uid.length > 128) {
    throw new Error("No superadmin in Firestore. Set AFW_INITIAL_SUPERADMIN_UID to your Firebase Auth user UID to initialize the role.");
  }
  const user = await getAuth(adminApp).getUser(uid);
  if (user.disabled || !user.emailVerified) throw new Error("Initial superadmin must have an active Firebase Auth account with a verified email");
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), { role: "superadmin" }, { merge: true });
  const profile = db.doc(`publicProfiles/${uid}`);
  if ((await readDoc(profile)).exists) batch.update(profile, { role: "superadmin" });
  await batch.commit();
  console.log("Initialized the configured Firebase Auth account as superadmin.");
}

try {
  console.log(`Preparing Firebase project ${project}, database ${database}`);
  const ready = db.doc("_system/releaseReadyV3");
  if ((await readDoc(ready)).data()?.version === 3) {
    console.log("Firebase is already prepared for this release.");
  } else {
    await acquireLease();
    await initialSuperadmin();
    await retireV2();
    await rules();
    await indexes();
    await profiles();
    await media();
    await protectIdentityApplications();
    const socialRef = db.doc("siteSettings/socialLinks");
    if ((await readDoc(socialRef)).data()?.updatedBy !== undefined) {
      await socialRef.update({ updatedBy: FieldValue.delete() });
    }
    await scan("publicProfilesV3", "publicProfiles", 50, async (page) => {
      const batch = db.batch();
      for (const profile of page.docs) {
        const original = profile.data();
        const projected = publicProfile(original, profile.id);
        if (!isDeepStrictEqual(original, projected)) batch.set(profile.ref, projected);
      }
      await batch.commit();
    });
    await ready.set({ version: 3, project, database, completedAt: Timestamp.now() });
    console.log("Firebase preparation finished. New indexes may need several minutes to propagate.");
  }
  console.log("Estimated document reads in this run: " + documentReads);
} catch (error: any) {
  console.error(error.message || "Firebase preparation failed");
  process.exitCode = 1;
} finally {
  await releaseLease().catch(() => console.warn("Setup lease will expire automatically"));
  await db.terminate();
}
