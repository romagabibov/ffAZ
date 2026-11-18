import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  getCountFromServer,
  collection,
  query,
  where,
  limit,
  orderBy,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import request from "supertest";
import { Writable } from "node:stream";
import { createApp } from "../../src/server/app";
import { DEFAULT_DESIGNERS } from "../../src/data/defaultDesigners";
import { hash } from "../../src/server/security";
import { eventEndMillis, monthsAfterBaku } from "../../src/lib/dateUtils";
import { ticketHoldMs } from "../../src/lib/ticketCheckout";
import { maintainEventRecords } from "../../src/server/eventMaintenance";
import type { PaymentGateway as TicketGateway } from "../../src/server/paymentGateway";
import { createIdentityCipher, identityDeadlines, identityRecordPath, photoCleanupAt, purgeIdentityRecords } from "../../src/server/identity";
const identityCipher = createIdentityCipher(Buffer.alloc(32, 45).toString("base64"));
const testPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0, 1, 2, 3, 4, 0xff, 0xd9]);

async function identityApplicationInput() {
  const document = hash("sample-id");
  const selfie = hash("sample-personal");
  for (const [key, purpose] of [[document, "id_document"], [selfie, "verification_photo"]]) {
    await seed(`mediaAssets/${key}`, {
      ownerUid: "alice", publicId: key + ".bin", resourceType: "raw", deliveryType: "authenticated",
      purpose, identityEncrypted: true, identityReady: true, ...photoCleanupAt(Timestamp.fromMillis(Date.now() + 600000)),
    });
  }
  return {
    userId: "alice", agencyName: "Test Agency", brandName: "Test Brand",
    applicantFirstName: "Fictional", applicantLastName: "Applicant",
    phoneNumber: "+0001234567", agencyAddress: "Example test address",
    status: "pending", idCardPhotoUrl: "/api/media/" + document, personalPhotoUrl: "/api/media/" + selfie,
  };
}
let env: RulesTestEnvironment,
  db: ReturnType<typeof getFirestore>,
  app: ReturnType<typeof createApp>,
  adminApp: any;
const project = "demo-afw-secure";
const token = (uid: string) => ({
  uid,
  email: uid + "@example.az",
  email_verified: true,
  auth_time: Math.floor(Date.now() / 1000),
  ...(uid === "super" ? { role: "superadmin" } : {}),
});
const auth = {
  verifyIdToken: vi.fn(async (value: string, revoked: boolean) => {
    if (value === "bad" || !revoked) throw new Error("Invalid");
    return token(value);
  }),
  getUserByEmail: vi.fn(async (email: string) => {
    const match = /^(super|bob)@example\.az$/.exec(email);
    if (!match) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
    return { uid: match[1], email, emailVerified: true, disabled: false };
  }),
  getUsers: vi.fn(async (ids: { uid: string }[]) => ({
    users: ids.map(({ uid }) => ({ uid, email: uid + "@example.az", emailVerified: true, disabled: false })),
  })),
  getUser: vi.fn(async (uid: string) => ({ uid, email: uid + "@example.az", emailVerified: true, disabled: false })),
} as any;
const call = (uid: string, path: string, data: any = {}) =>
  request(app)
    .post(path)
    .set("Authorization", "Bearer " + uid)
    .send(data);
const write = (uid: string, path: string, data: any, kind = "update") =>
  call(uid, "/api/data/mutate", { operations: [{ path, kind, data }] });
async function seed(path: string, data: any) {
  await db.doc(path).set(data);
}
async function data(path: string) {
  return (await db.doc(path).get()).data();
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Run npm run test:emulator; live Firebase is never used");
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  env = await initializeTestEnvironment({
    projectId: project,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  adminApp = initializeApp({ projectId: project }, "integration");
  db = getFirestore(adminApp);
  db.settings({ ignoreUndefinedProperties: true });
  app = createApp({ adminDb: db, adminAuth: auth, identityCipher });
});
afterAll(async () => {
  await env?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});
beforeEach(async () => {
  await env.clearFirestore();
  for (const uid of ["alice", "bob", "mallory", "rep", "super", "editor"]) {
    await seed("users/" + uid, {
      role:
        uid === "super"
          ? "superadmin"
          : uid === "editor"
            ? "content_editor"
            : "user",
      createdAt: Timestamp.now(),
    });
    await seed("publicProfiles/" + uid, {
      name: uid,
      username: uid,
      searchName: uid,
      searchHandle: uid,
      role:
        uid === "super"
          ? "superadmin"
          : uid === "editor"
            ? "content_editor"
            : "user",
    });
    await seed(`users/${uid}/private/account`, {
      email: uid + "@example.az",
      blockedUsers: [],
      subscriptionTier: "free",
    });
  }
});
const browser = (uid?: string) =>
  uid
    ? env.authenticatedContext(uid).firestore()
    : env.unauthenticatedContext().firestore();
async function agency() {
  await seed("agencies/agency1", { name: "Agency", linkedUserId: "rep" });
  await db.doc("users/rep").update({
    hasAgencyBadge: true,
    agencyVerificationStatus: "approved",
    isAgencyRepresentative: true,
    representedAgencyId: "agency1",
    representedAgencyName: "Agency",
  });
}
async function paid(uid = "alice") {
  await db.doc(`users/${uid}/private/account`).update({
    subscriptionTier: "elite",
    subscriptionExpiresAt: Date.now() + 86400000,
  });
}
async function conversation(status = "accepted") {
  await seed("conversations/alice_bob", {
    participants: ["alice", "bob"],
    requestedBy: "alice",
    recipientId: "bob",
    status,
    createdAt: 1,
    updatedAt: 1,
    unreadCounts: { alice: 0, bob: 0 },
    participantDetails: { alice: { name: "Alice" }, bob: { name: "Bob" } },
  });
}
describe("Real emulator: direct client access rules", () => {
  it("public profiles remain readable while legacy PII stays closed", async () => {
    await db
      .doc("users/alice")
      .update({ email: "secret", subscriptionTier: "elite" });
    expect(
      (
        await assertSucceeds(getDoc(doc(browser(), "publicProfiles/alice")))
      ).data()?.name,
    ).toBe("alice");
    await assertFails(getDoc(doc(browser(), "users/alice")));
    await assertFails(
      getDoc(doc(browser("bob"), "users/alice/private/account")),
    );
    await assertSucceeds(
      getDoc(doc(browser("alice"), "users/alice/private/account")),
    );
  });
  it("denies all browser writes, including a trusted admin browser", async () => {
    for (const uid of ["alice", "super"])
      for (const path of [
        "users/alice",
        "publicProfiles/alice",
        "feedPosts/post",
        "tickets/t",
        "agency_invitations/i",
        "users/alice/private/account",
      ])
        await assertFails(
          setDoc(doc(browser(uid), path), { role: "superadmin" }),
        );
  });
  it("requires an explicit bounded query", async () => {
    await assertFails(getDocs(collection(browser(), "publicProfiles")));
    await assertSucceeds(
      getDocs(query(collection(browser(), "publicProfiles"), limit(50))),
    );
    await assertFails(
      getDocs(query(collection(browser(), "publicProfiles"), limit(101))),
    );
  });
  it("closed post comments and media metadata do not leak", async () => {
    await seed("feedPosts/closed", { userId: "bob", isClosed: true });
    await seed("feedComments/comment", {
      userId: "bob",
      postId: "closed",
      content: "private",
    });
    await seed("mediaAssets/private", { ownerUid: "bob", secureUrl: "secret" });
    await assertFails(getDoc(doc(browser(), "feedComments/comment")));
    await assertFails(getDoc(doc(browser("alice"), "feedComments/comment")));
    await assertFails(getDoc(doc(browser("alice"), "mediaAssets/private")));
    await paid();
    await assertSucceeds(getDoc(doc(browser("alice"), "feedComments/comment")));
  });
  it("queries only the accessible feed realm", async () => {
    await seed("feedPosts/public", {
      userId: "bob",
      isClosed: false,
      createdAt: 1,
    });
    await seed("feedPosts/closed", {
      userId: "bob",
      isClosed: true,
      createdAt: 2,
    });
    await assertFails(
      getDocs(query(collection(browser(), "feedPosts"), limit(24))),
    );
    const result = await assertSucceeds(
      getDocs(
        query(
          collection(browser(), "feedPosts"),
          where("isClosed", "==", false),
          orderBy("createdAt", "desc"),
          limit(24),
        ),
      ),
    );
    expect(result.size).toBe(1);
  });
  it("does not treat self-declared designer identity as a subscription", async () => {
    await db.doc("users/alice").update({
      isDesigner: true,
      designerVerificationStatus: "approved",
      designerId: "other",
    });
    await seed("designers/other", { linkedUserId: "bob" });
    await seed("feedPosts/closed", { userId: "bob", isClosed: true });
    await assertFails(getDoc(doc(browser("alice"), "feedPosts/closed")));
    await seed("designers/other", { linkedUserId: "alice" });
    await assertSucceeds(getDoc(doc(browser("alice"), "feedPosts/closed")));
  });
  it("does not reveal broadcasts to unselected same-agency members", async () => {
    await agency();
    await seed("agency_broadcasts/b", {
      senderUserId: "rep",
      agencyId: "agency1",
      recipientUserIds: ["alice"],
      message: "private",
    });
    await db.doc("users/bob").update({ modelAgencyId: "agency1" });
    await assertFails(getDoc(doc(browser("bob"), "agency_broadcasts/b")));
    await assertSucceeds(getDoc(doc(browser("alice"), "agency_broadcasts/b")));
    await assertSucceeds(
      getDocs(
        query(
          collection(browser("alice"), "agency_broadcasts"),
          where("recipientUserIds", "array-contains", "alice"),
          limit(50),
        ),
      ),
    );
  });
  it("counts an account's addressed broadcasts with the model cabinet query", async () => {
    await seed("agency_broadcasts/own", {
      senderUserId: "rep", recipientUserIds: ["alice"], createdAt: Timestamp.now(),
    });
    await seed("agency_broadcasts/other", {
      senderUserId: "rep", recipientUserIds: ["bob"], createdAt: Timestamp.now(),
    });
    const result = await assertSucceeds(getCountFromServer(query(
      collection(browser("alice"), "agency_broadcasts"),
      where("recipientUserIds", "array-contains", "alice"),
      orderBy("createdAt", "desc"),
      limit(100),
    )));
    expect(result.data().count).toBe(1);
  });
  it("nonmembers cannot read conversations or messages", async () => {
    await conversation();
    await seed("conversations/alice_bob/messages/m", {
      senderId: "alice",
      text: "private",
    });
    await assertFails(
      getDoc(doc(browser("mallory"), "conversations/alice_bob/messages/m")),
    );
    await assertSucceeds(
      getDoc(doc(browser("bob"), "conversations/alice_bob/messages/m")),
    );
  });
  it("ticket readers are the ticket owner or ticket editors", async () => {
    await seed("tickets/t", { userId: "alice" });
    await assertFails(getDoc(doc(browser("bob"), "tickets/t")));
    await assertFails(getDoc(doc(browser("editor"), "tickets/t")));
    await assertSucceeds(getDoc(doc(browser("super"), "tickets/t")));
  });
});

describe("Event programme editing", () => {
  it("stores the programme and admission policy, checks schedule format and lets staff clear optional fields", async () => {
    const path = "events/programme-show";
    const date = Date.now() + 86_400_000;
    const programme = {
      schedule: [
        { time: "23:30", title: " Opening ", description: " Welcome " },
        { time: "00:15", title: "Finale" },
      ],
      dressCode: " Evening wear ",
      admissionRules: " Doors open at 23:00\nBring the QR code. ",
    };
    await write("super", path, { title: "Runway", date, totalTickets: 20, availableTickets: 20, ...programme }, "set").expect(200);
    expect(await data(path)).toMatchObject({
      schedule: [
        { time: "23:30", title: "Opening", description: "Welcome" },
        { time: "00:15", title: "Finale", description: "" },
      ],
      dressCode: "Evening wear",
      admissionRules: "Doors open at 23:00\nBring the QR code.",
    });
    await write("super", path, { schedule: [{ time: "25:00", title: "After party" }] }).expect(400);
    expect((await data(path))?.schedule).toHaveLength(2);
    await write("super", path, { schedule: [], admissionRules: "", dressCode: "" }).expect(200);
    expect(await data(path)).toMatchObject({ schedule: [], admissionRules: "", dressCode: "", availableTickets: 20 });
  });
});
describe("Real emulator: server mutations and legitimate controls", () => {
  it("accepts a normal profile save but rejects self-granted roles and badges", async () => {
    expect(
      (
        await write("alice", "publicProfiles/alice", {
          name: "Roma",
          bio: "Fashion",
        })
      ).status,
    ).toBe(200);
    expect((await data("publicProfiles/alice"))?.name).toBe("Roma");
    for (const patch of [
      { role: "admin" },
      { hasModelBadge: true },
      { isAgencyRepresentative: true },
      { modelVerificationStatus: "approved", modelAgencyId: "agency1" },
      { subscriptionTier: "elite" },
      { singleJobCredits: 100 },
    ])
      expect([400, 403]).toContain(
        (await write("alice", "publicProfiles/alice", patch)).status,
      );
  });
  it("superadmin grants a subscription privately, not into public profile", async () => {
    const r = await write("super", "publicProfiles/alice", {
      subscriptionTier: "elite",
      subscriptionExpiresAt: Date.now() + 86400000,
    });
    expect(r.status).toBe(200);
    expect((await data("users/alice/private/account"))?.subscriptionTier).toBe(
      "elite",
    );
    expect(
      (await data("publicProfiles/alice"))?.subscriptionTier,
    ).toBeUndefined();
  });
  it("normal users cannot write another profile; own follower changes remain valid", async () => {
    expect(
      (await write("alice", "publicProfiles/bob", { name: "Hacked" })).status,
    ).toBe(403);
    expect(
      (
        await write("alice", "publicProfiles/bob", {
          followers: ["mallory", "alice"],
        })
      ).status,
    ).toBe(403);
    expect(
      (await write("alice", "publicProfiles/bob", { followers: ["alice"] }))
        .status,
    ).toBe(200);
    expect((await db.collection("notifications").get()).size).toBe(1);
  });
  it("normal profile save with a canonical handle preserves existing authority", async () => {
    await agency();
    expect(
      (
        await write("rep", "publicProfiles/rep", {
          name: "Agency Rep",
          username: "agency.rep",
          handle: "@agency.rep",
          declaredAgencyName: "Other",
        })
      ).status,
    ).toBe(200);
    expect((await data("users/rep"))?.representedAgencyId).toBe("agency1");
    expect(
      (await write("bob", "publicProfiles/bob", { username: "agency.rep" }))
        .status,
    ).toBe(409);
  });
  it("blocks arbitrary paths, document traversal and prototype patch keys", async () => {
    for (const path of [
      "_system/config",
      "users/alice/private/else",
      "users/alice/../../secrets",
    ])
      expect(
        (await write("alice", path, { a: 1 })).status,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await write(
          "alice",
          "publicProfiles/alice",
          JSON.parse('{"__proto__.role":"admin"}'),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });
  it("like desired state is idempotent and counters update atomically", async () => {
    await seed("feedPosts/p", {
      userId: "bob",
      isClosed: false,
      likesCount: 0,
      commentsCount: 0,
      createdAt: Timestamp.now(),
    });
    const results = await Promise.all([
      call("alice", "/api/feed/p/like", { liked: true }),
      call("bob", "/api/feed/p/like", { liked: true }),
    ]);
    results.forEach((r) => expect(r.status).toBe(200));
    expect((await data("feedPosts/p"))?.likesCount).toBe(2);
    expect(
      (await call("alice", "/api/feed/p/like", { liked: true })).status,
    ).toBe(200);
    expect((await data("feedPosts/p"))?.likesCount).toBe(2);
    expect(
      (await write("alice", "feedPosts/p", { likesCount: 999 })).status,
    ).toBe(403);
  });
  it("comments use an idempotent ID and guard closed parent access", async () => {
    await seed("feedPosts/p", {
      userId: "bob",
      isClosed: false,
      commentsCount: 0,
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await call("alice", "/api/feed/p/comments", {
            content: "Hello",
            id: "stable",
          })
        ).status,
      ).toBe(200);
    expect((await data("feedPosts/p"))?.commentsCount).toBe(1);
    await db.doc("feedPosts/p").update({ isClosed: true });
    expect(
      (
        await call("mallory", "/api/feed/p/comments", {
          content: "private?",
          id: "bad",
        })
      ).status,
    ).toBe(403);
  });
  it("only an actual author or admin can delete a comment", async () => {
    await seed("feedPosts/p", {
      userId: "bob",
      isClosed: false,
      commentsCount: 1,
    });
    await seed("feedComments/m", {
      userId: "alice",
      postId: "p",
      content: "Hello",
    });
    expect(
      (
        await request(app)
          .delete("/api/feed/p/comments/m")
          .set("Authorization", "Bearer bob")
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete("/api/feed/p/comments/m")
          .set("Authorization", "Bearer alice")
      ).status,
    ).toBe(200);
    expect((await data("feedPosts/p"))?.commentsCount).toBe(0);
  });
  it("a public designer flag never unlocks paid post access", async () => {
    await db
      .doc("publicProfiles/alice")
      .update({ isDesigner: true, designerId: "someone" });
    await seed("feedPosts/p", { userId: "bob", isClosed: true, likesCount: 0 });
    expect(
      (await call("alice", "/api/feed/p/like", { liked: true })).status,
    ).toBe(403);
  });
  it("duplicate verification applications do not create duplicate records", async () => {
    const input = await identityApplicationInput();
    expect(
      (await write("alice", "agency_applications/random", input, "set")).status,
    ).toBe(200);
    expect(
      (await write("alice", "agency_applications/another", input, "set"))
        .status,
    ).toBe(409);
    expect((await db.collection("agency_applications").get()).size).toBe(1);
    expect((await data("users/alice"))?.agencyApplicationId).toBe("alice");
  });
  it("keeps ordinary applicant records in the server-only read flow", async () => {
    const input = await identityApplicationInput();
    expect((await write("alice", "designer_applications/alice", input, "set")).status).toBe(200);
    const path = "designer_applications/alice";
    const summary = await data(path);
    expect(summary).toMatchObject({ userId: "alice", identitySchema: 3, status: "pending" });
    expect(summary).not.toHaveProperty("applicantFirstName");
    expect(summary).not.toHaveProperty("phoneNumber");
    const record = await data(identityRecordPath(path));
    expect(JSON.stringify(record)).not.toContain(input.phoneNumber);
    expect(JSON.stringify(record)).not.toContain(input.applicantFirstName);
    for (const uid of ["alice", "super"]) {
      await assertFails(getDoc(doc(browser(uid), path)));
      await assertFails(getDoc(doc(browser(uid), identityRecordPath(path))));
      const response = await request(app).get("/api/identity/details/" + path).set("Authorization", "Bearer " + uid);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body.details.phoneNumber).toBe(input.phoneNumber);
    }
    const list = await request(app).get("/api/identity/applications/designer_applications?mine=1").set("Authorization", "Bearer alice");
    expect(list.body.items[0]).toMatchObject({ id: "alice", status: "pending" });
    expect(JSON.stringify(list.body)).not.toContain(input.phoneNumber);
  });
  it("approved agency invitation grants the badge only when its model accepts", async () => {
    await agency();
    const invite = {
      modelUserId: "alice",
      agencyId: "agency1",
      agencyName: "Agency",
      invitedByUserId: "rep",
      status: "pending",
    };
    expect(
      (await write("rep", "agency_invitations/random", invite, "set")).status,
    ).toBe(200);
    const key = hash("agency1|alice");
    expect(
      (await write("rep", `agency_invitations/${key}`, { status: "accepted" }))
        .status,
    ).toBe(403);
    expect(
      (
        await write("alice", `agency_invitations/${key}`, {
          status: "accepted",
        })
      ).status,
    ).toBe(200);
    expect((await data("users/alice"))?.hasModelBadge).toBe(true);
    expect((await data("publicProfiles/alice"))?.modelAgencyId).toBe("agency1");
  });
  it("self-declared agency cannot invite models", async () => {
    await db.doc("publicProfiles/mallory").update({
      isAgencyRepresentative: true,
      hasAgencyBadge: true,
      agencyVerificationStatus: "approved",
      representedAgencyId: "agency1",
    });
    expect(
      (
        await write(
          "mallory",
          "agency_invitations/i",
          { modelUserId: "alice", status: "pending" },
          "set",
        )
      ).status,
    ).toBe(403);
  });
  it("agency membership is revalidated at acceptance", async () => {
    await agency();
    await seed("agency_invitations/i", {
      modelUserId: "alice",
      agencyId: "agency1",
      agencyName: "Agency",
      invitedByUserId: "rep",
      status: "pending",
    });
    await db.doc("agencies/agency1").update({ linkedUserId: "mallory" });
    expect(
      (await write("alice", "agency_invitations/i", { status: "accepted" }))
        .status,
    ).toBe(403);
    expect((await data("users/alice"))?.hasModelBadge).toBeUndefined();
  });
  it("broadcast recipient membership is checked and other agencies are rejected", async () => {
    await agency();
    await db.doc("users/alice").update({
      hasModelBadge: true,
      modelVerificationStatus: "approved",
      modelAgencyId: "agency1",
    });
    expect(
      (
        await write(
          "rep",
          "agency_broadcasts/b",
          {
            title: "Casting",
            message: "Tomorrow",
            recipientUserIds: ["alice"],
            senderUserId: "mallory",
          },
          "set",
        )
      ).status,
    ).toBe(200);
    expect((await data("agency_broadcasts/b"))?.senderUserId).toBe("rep");
    expect(
      (
        await write(
          "rep",
          "agency_broadcasts/b2",
          { title: "Casting", message: "Tomorrow", recipientUserIds: ["bob"] },
          "set",
        )
      ).status,
    ).toBe(403);
  });
  it("the server creates a pending direct request with trusted identities", async () => {
    const result = await call("alice", "/api/conversations/open", {
      targetUserId: "bob",
      status: "accepted",
      participantDetails: { bob: { role: "admin" } },
    });
    expect(result.status).toBe(200);
    const c = await data("conversations/alice_bob");
    expect(c?.status).toBe("pending");
    expect(c?.participantDetails.bob.role).toBe("user");
    expect(c?.participantDetails.bob.email).toBeUndefined();
    expect(
      (
        await write(
          "alice",
          "conversations/fake",
          { participants: ["alice", "bob"], status: "accepted" },
          "set",
        )
      ).status,
    ).toBe(400);
  });
  it("only the request recipient can accept; messages wait for acceptance", async () => {
    await conversation("pending");
    expect(
      (await write("alice", "conversations/alice_bob", { status: "accepted" }))
        .status,
    ).toBe(403);
    expect(
      (
        await write(
          "alice",
          "conversations/alice_bob/messages/m",
          { senderId: "alice", text: "Hello" },
          "set",
        )
      ).status,
    ).toBe(403);
    expect(
      (await write("bob", "conversations/alice_bob", { status: "accepted" }))
        .status,
    ).toBe(200);
    expect(
      (
        await write(
          "alice",
          "conversations/alice_bob/messages/m",
          { senderId: "mallory", text: "Hello" },
          "set",
        )
      ).status,
    ).toBe(200);
    expect((await data("conversations/alice_bob/messages/m"))?.senderId).toBe(
      "alice",
    );
    expect((await data("conversations/alice_bob"))?.unreadCounts.bob).toBe(1);
  });
  it("message participants cannot rewrite other identities, unread counts or reactions", async () => {
    await conversation();
    await seed("conversations/alice_bob/messages/m", {
      senderId: "bob",
      text: "Hello",
      reactions: { "❤️": ["bob"] },
    });
    for (const patch of [
      { participants: ["alice", "mallory"] },
      { recipientId: "mallory" },
      { "unreadCounts.bob": 0 },
    ])
      expect(
        (await write("alice", "conversations/alice_bob", patch)).status,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await write("alice", "conversations/alice_bob/messages/m", {
          reactions: { "❤️": ["mallory"] },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("alice", "/api/conversations/reaction", {
          conversationId: "alice_bob",
          messageId: "m",
          emoji: "❤️",
        })
      ).status,
    ).toBe(200);
    expect(
      (await data("conversations/alice_bob/messages/m"))?.reactions["❤️"],
    ).toEqual(["bob", "alice"]);
  });
  it("conversation deletion stays local to the caller", async () => {
    await conversation();
    expect(
      (await write("alice", "conversations/alice_bob", {}, "delete")).status,
    ).toBe(400);
    expect(
      (
        await write("alice", "conversations/alice_bob", {
          deletedBy: ["alice"],
          "clearedAt.alice": Date.now(),
        })
      ).status,
    ).toBe(200);
    expect((await data("conversations/alice_bob"))?.participants).toEqual([
      "alice",
      "bob",
    ]);
  });
  it("blocked chat refuses messages even if the browser still shows an input", async () => {
    await conversation();
    await db
      .doc("users/bob/private/account")
      .update({ blockedUsers: ["alice"] });
    expect(
      (
        await write(
          "alice",
          "conversations/alice_bob/messages/m",
          { senderId: "alice", text: "Hello" },
          "set",
        )
      ).status,
    ).toBe(403);
  });
  it("job credits are spent once, atomically with a vacancy", async () => {
    await db.doc("users/alice/private/account").update({ singleJobCredits: 1 });
    const payload = {
      employerId: "alice",
      title: "Casting",
      description: "Description",
      type: "casting",
    };
    const result = await Promise.all([
      write("alice", "vacancies/v1", payload, "set"),
      write("alice", "vacancies/v2", payload, "set"),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 402]);
    expect((await data("users/alice/private/account"))?.singleJobCredits).toBe(
      0,
    );
  });
  it("job application employer identity is resolved from the vacancy", async () => {
    await seed("vacancies/v", { employerId: "bob", title: "Casting" });
    expect(
      (
        await write(
          "alice",
          "jobApplications/random",
          {
            jobId: "v",
            employerId: "mallory",
            userId: "alice",
            name: "Alice",
            email: "other@example.az",
            status: "pending",
          },
          "set",
        )
      ).status,
    ).toBe(200);
    const apps = await db.collection("jobApplications").get();
    expect(apps.docs[0].data().employerId).toBe("bob");
    expect(apps.docs[0].data().email).toBe("alice@example.az");
    expect(
      (await write("mallory", apps.docs[0].ref.path, { status: "approved" }))
        .status,
    ).toBe(403);
    expect(
      (
        await write("bob", apps.docs[0].ref.path, {
          status: "approved",
          updatedAt: 1,
        })
      ).status,
    ).toBe(200);
  });
  it("paid ticket amounts and browser payment claims cannot mint a ticket", async () => {
    await seed("events/e", { title: "Runway", price: 20 });
    expect(
      (
        await call("alice", "/api/tickets/purchase", {
          eventId: "e",
          price: 0,
          amount: 0,
          paymentStatus: "paid",
        })
      ).status,
    ).toBe(402);
    expect((await db.collection("tickets").get()).size).toBe(0);
    expect(
      (
        await call("alice", "/api/subscriptions/purchase", {
          planId: "elite",
          amount: 0,
          paymentStatus: "paid",
        })
      ).status,
    ).toBe(402);
  });
  it("free booking is idempotent and checks capacity", async () => {
    await seed("events/e", {
      title: "Runway",
      price: 0,
      totalTickets: 1,
      ticketsSold: 0,
    });
    const a = await call("alice", "/api/tickets/purchase", { eventId: "e" });
    expect(a.status).toBe(200);
    expect(a.body.qrCodeData.length).toBeGreaterThan(30);
    expect(
      (await call("alice", "/api/tickets/purchase", { eventId: "e" })).status,
    ).toBe(200);
    expect(
      (await call("bob", "/api/tickets/purchase", { eventId: "e" })).status,
    ).toBe(409);
    expect((await data("events/e"))?.ticketsSold).toBe(1);
  });
  it("paid ticket tiers cannot inherit a zero base price", async () => {
    await seed("events/e", {
      title: "Runway",
      price: 0,
      ticketTiers: [{ name: "VIP", price: 30 }],
    });
    expect(
      (
        await call("alice", "/api/tickets/purchase", {
          eventId: "e",
          tierName: "VIP",
        })
      ).status,
    ).toBe(402);
    expect(
      (await call("alice", "/api/tickets/purchase", { eventId: "e" })).status,
    ).toBe(400);
  });
  it("giveaway winner receives only one unpredictable ticket on retry", async () => {
    await seed("events/e", { title: "Runway", price: 20 });
    await seed("giveaway_entries/g", {
      eventId: "e",
      userId: "alice",
      status: "entered",
    });
    for (let i = 0; i < 2; i++)
      expect(
        (await call("super", "/api/admin/giveaway-award", { entryId: "g" }))
          .status,
      ).toBe(200);
    expect((await db.collection("tickets").get()).size).toBe(1);
    expect(
      (await call("alice", "/api/admin/giveaway-award", { entryId: "g" }))
        .status,
    ).toBe(403);
  });
  it("rolls back an invalid batch instead of committing a partial privilege change", async () => {
    const r = await call("alice", "/api/data/mutate", {
      operations: [
        {
          path: "publicProfiles/alice",
          kind: "update",
          data: { name: "Changed" },
        },
        { path: "users/bob", kind: "update", data: { role: "admin" } },
      ],
    });
    expect(r.status).toBe(403);
    expect((await data("publicProfiles/alice"))?.name).toBe("alice");
  });
  it("server-enforced community quota cannot be bypassed with a new message ID", async () => {
    const message = { userId: "alice", channel: "public", text: "Hello" };
    expect(
      (await write("alice", "feedLiveMessages/one", message, "set")).status,
    ).toBe(200);
    expect(
      (await write("alice", "feedLiveMessages/two", message, "set")).status,
    ).toBe(429);
    expect((await db.collection("feedLiveMessages").get()).size).toBe(1);
  });
  it("mark-all-read changes one private cursor and preserves notification documents", async () => {
    await seed("notifications/n1", {
      userId: "alice",
      createdAt: Date.now() - 1000,
      read: false,
    });
    await seed("notifications/n2", {
      userId: "alice",
      createdAt: Date.now() - 500,
      read: false,
    });
    expect((await call("alice", "/api/notifications/read-all")).status).toBe(
      200,
    );
    const cursor = (await data("users/alice/private/account"))
      ?.notificationsReadAt;
    expect(cursor).toBeGreaterThan(0);
    expect((await data("notifications/n1"))?.read).toBe(false);
    expect((await call("alice", "/api/notifications/read-all")).status).toBe(
      200,
    );
    expect(
      (await data("users/alice/private/account"))?.notificationsReadAt,
    ).toBe(cursor);
  });
  it("nonadmins cannot call the private user directory", async () => {
    expect(
      (
        await request(app)
          .get("/api/admin/users")
          .set("Authorization", "Bearer alice")
      ).status,
    ).toBe(403);
    const r = await request(app)
      .get("/api/admin/users?limit=2")
      .set("Authorization", "Bearer super");
    expect(r.status).toBe(200);
    expect(r.body.users).toHaveLength(2);
    expect(r.body.nextCursor).toBeTruthy();
  });
  it("content editors do not acquire ticket or role privileges", async () => {
    expect(
      (
        await write(
          "editor",
          "news/n",
          { title: "News", content: "Hello" },
          "set",
        )
      ).status,
    ).toBe(403);
    expect(
      (await write("editor", "agencies/new", { name: "Agency" }, "set")).status,
    ).toBe(200);
    expect(
      (await write("editor", "publicProfiles/alice", { role: "admin" })).status,
    ).toBe(403);
    expect(
      (await write("editor", "tickets/t", { userId: "alice" }, "set")).status,
    ).toBe(403);
  });
  it("restores only missing designers and preserves the existing Sameera record", async () => {
    const existing = { name: "Sameera", designerName: "Samira Ismayilova", instagram: "https://example.test/sameera" };
    await seed("designers/sameera-existing", existing);
    await call("alice", "/api/admin/designers/restore").expect(403);
    await call("editor", "/api/admin/designers/restore").expect(200, { added: DEFAULT_DESIGNERS.length - 1 });
    await call("editor", "/api/admin/designers/restore").expect(200, { added: 0 });
    expect(await data("designers/sameera-existing")).toEqual(existing);
    expect((await db.collection("designers").get()).size).toBe(DEFAULT_DESIGNERS.length);
  });
  it("counts selected registration options across completed profiles", async () => {
    await db.doc("publicProfiles/alice").update({ onboardingComplete: true, industry: "model", ageGroup: "18_24" });
    await db.doc("publicProfiles/bob").update({ onboardingComplete: true, industry: "designer", ageGroup: "18_24" });
    await db.doc("publicProfiles/mallory").update({ onboardingComplete: false, industry: "model", ageGroup: "18_24" });
    const api = "/api/admin/onboarding-stats";
    await request(app).get(api).set("Authorization", "Bearer alice").expect(403);
    const result = await request(app).get(api).set("Authorization", "Bearer super").expect(200);
    expect(result.body).toMatchObject({ completed: 2, counts: { industry: { model: 1, fashion_design: 1 }, ageGroup: { "18_24": 2 } } });
    expect(result.body).not.toHaveProperty("profiles");
  });
  it("lists and demotes selected elevated accounts while retaining the acting account", async () => {
    await db.doc("users/bob").update({ role: "superadmin" });
    await db.doc("publicProfiles/bob").update({ role: "superadmin" });
    const list = "/api/admin/superadmins";
    const revoke = list + "/revoke";
    await request(app).get(list).set("Authorization", "Bearer alice").expect(403);
    const staff = await request(app).get(list).set("Authorization", "Bearer super").expect(200);
    expect(staff.body.members.map(row => row.id)).toEqual(["bob", "super"]);
    const users = await request(app).get("/api/admin/users").set("Authorization", "Bearer super").expect(200);
    expect(users.body.users.filter(row => row.role === "superadmin")).toHaveLength(2);
    await call("alice", revoke, { userIds: ["bob"] }).expect(403);
    await call("super", revoke, { userIds: ["super", "bob"] }).expect(403);
    await call("super", revoke, { userIds: ["bob"] }).expect(200, { changed: 1 });
    expect(await data("users/bob")).toMatchObject({ role: "user" });
    expect(await data("publicProfiles/bob")).toMatchObject({ role: "user" });
    expect((await data("users/bob/private/account"))?.email).toBe("bob@example.az");
    expect(await data("users/super")).toMatchObject({ role: "superadmin" });
  });
  it("news HTML is sanitized before persistence", async () => {
    const r = await write(
      "super",
      "news/n",
      {
        title: "News",
        content:
          '<p>Hello</p><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
      },
      "set",
    );
    expect(r.status).toBe(200);
    const html = (await data("news/n"))?.content;
    expect(html).toContain("<p>Hello</p>");
    expect(html).not.toMatch(/<script|onerror|javascript:/);
  });
});

describe("Media upload and private review boundary", () => {
  const key = "afw/alice/12345678-1234-1234-1234-123456789abc";
  const cloud: any = {
    config: () => ({
      cloud_name: "test-cloud",
      api_key: "public",
      api_secret: "private",
    }),
    utils: { api_sign_request: () => "signed" },
    api: {
      resource: vi.fn(async (publicId: string, options: any) => ({
        public_id: publicId,
        context: {
          custom: {
            owner: "alice",
            purpose: options.type === "authenticated" ? "cv" : "other",
          },
        },
        format: "jpg",
        bytes: 1000,
        secure_url:
          "https://res.cloudinary.com/test-cloud/image/upload/" +
          publicId +
          ".jpg",
      })),
    },
    url: () =>
      "https://res.cloudinary.com/test-cloud/image/authenticated/file.jpg",
    uploader: { destroy: vi.fn(async () => ({ result: "ok" })) },
  };
  it("the signature binds owner, private delivery type and overwrite=false", async () => {
    const mediaApp = createApp({
      adminDb: db,
      adminAuth: auth,
      cloudinaryClient: cloud,
    });
    const r = await request(mediaApp)
      .post("/api/media/prepare")
      .set("Authorization", "Bearer alice")
      .send({ purpose: "chat", resourceType: "image" });
    expect(r.status).toBe(200);
    expect(r.body.fields.type).toBe("authenticated");
    expect(r.body.fields.overwrite).toBe(false);
    expect(r.body.publicId).toMatch(/^afw\/alice\//);
    expect(r.body.fields.context).toBe("owner=alice|purpose=chat");
  });
  it("complete verifies ownership with Cloudinary rather than trusting a browser URL", async () => {
    const mediaApp = createApp({
      adminDb: db,
      adminAuth: auth,
      cloudinaryClient: cloud,
    });
    expect(
      (
        await request(mediaApp)
          .post("/api/media/complete")
          .set("Authorization", "Bearer bob")
          .send({
            publicId: key,
            resourceType: "image",
            deliveryType: "authenticated",
          })
      ).status,
    ).toBe(403);
    const r = await request(mediaApp)
      .post("/api/media/complete")
      .set("Authorization", "Bearer alice")
      .send({
        publicId: key,
        resourceType: "image",
        deliveryType: "authenticated",
        url: "https://attacker.test/file.jpg",
      });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("/api/media/" + hash(key));
    expect((await data("mediaAssets/" + hash(key)))?.ownerUid).toBe("alice");
    expect(
      (
        await request(mediaApp)
          .get(r.body.url)
          .set("Authorization", "Bearer bob")
      ).status,
    ).toBe(403);
    expect((await request(mediaApp).get(r.body.url)).status).toBe(401);
  });
  it("encrypts uploaded photos before Cloudinary and serves the original only on authorized reads", async () => {
    let stored = Buffer.alloc(0);
    const storage = {
      ...cloud,
      uploader: {
        ...cloud.uploader,
        upload_stream: (options: any, done: any) => new Writable({
          write(chunk, _encoding, callback) { stored = Buffer.from(chunk); callback(); },
          final(callback) {
            expect(options).toMatchObject({ type: "authenticated", resource_type: "raw", backup: false });
            done(undefined, { public_id: options.public_id, resource_type: "raw", type: "authenticated" });
            callback();
          },
        }),
      },
    };
    const mediaApp = createApp({ adminDb: db, adminAuth: auth, cloudinaryClient: storage, identityCipher });
    const upload = await request(mediaApp).post("/api/media/identity")
      .set("Authorization", "Bearer alice").send({ purpose: "id_document", photo: testPhoto.toString("base64") });
    expect(upload.status).toBe(200);
    expect(stored.length).toBe(testPhoto.length + 36);
    expect(stored.includes(testPhoto)).toBe(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(stored)));
    try {
      for (const uid of ["alice", "super"]) {
        const response = await request(mediaApp).get(upload.body.url).set("Authorization", `Bearer ${uid}`);
        expect(response.status).toBe(200);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.headers.location).toBeUndefined();
        expect(response.body).toEqual(testPhoto);
      }
      expect((await request(mediaApp).get(upload.body.url).set("Authorization", "Bearer bob")).status).toBe(403);
    } finally {
      fetchMock.mockRestore();
    }
  });
  it("uses a public profile for a linked catalogue entry", async () => {
    await seed("designers/catalogue", { name: "Fictional brand" });
    await db.doc("publicProfiles/alice").update({ name: "Alias", username: "public.alias" });
    const response = await write("super", "designers/catalogue", { linkedUserId: "alice" });
    expect(response.status).toBe(200);
    const card = (await getDoc(doc(browser(), "designers/catalogue"))).data();
    expect(card).toMatchObject({ linkedUserId: "alice", linkedUserName: "Alias", linkedUserHandle: "@public.alias" });
    expect(JSON.stringify(card)).not.toContain("alice@example.az");
  });
  it("replaces a legacy pending identity application when documents must be reuploaded", async () => {
    const input = await identityApplicationInput();
    const oldPath = "agency_applications/legacy";
    await seed(oldPath, { userId: "alice", status: "pending", identitySchema: 3, needsDocumentReupload: true });
    expect((await write("alice", "agency_applications/alice", input, "set")).status).toBe(200);
    expect(await data(oldPath)).toBeUndefined();
    expect(await data("agency_applications/alice")).toMatchObject({ userId: "alice", status: "pending" });
  });
  it("removes photos, then private fields, and preserves the decision and profile badge", async () => {
    const input = await identityApplicationInput();
    const path = "agency_applications/alice";
    expect((await write("alice", path, input, "set")).status).toBe(200);
    const started = Date.now();
    const approval = await write("super", path, { status: "approved", reviewedAt: 1, reviewedBy: "ignored" });
    expect(approval.status).toBe(200);
    const before = await data(path);
    expect(before?.reviewedAt).toBeGreaterThanOrEqual(started);
    expect(before?.reviewedBy).toBe("super");
    await seed("users/alice", { role: "user", agencyVerificationStatus: "approved", hasAgencyBadge: true });
    const expiry = identityDeadlines(before!.reviewedAt);
    expect(await purgeIdentityRecords(db, cloud, expiry.photo.toMillis() - 1)).toEqual({ photosDeleted: 0, recordsDeleted: 0, failed: 0 });
    expect(await purgeIdentityRecords(db, cloud, expiry.photo.toMillis())).toEqual({ photosDeleted: 2, recordsDeleted: 0, failed: 0 });
    expect(await data(identityRecordPath(path))).toBeDefined();
    expect(await purgeIdentityRecords(db, cloud, expiry.data.toMillis())).toEqual({ photosDeleted: 0, recordsDeleted: 1, failed: 0 });
    expect(await data(identityRecordPath(path))).toBeUndefined();
    expect(await data(path)).toMatchObject({ status: "approved", identityDataPresent: false });
    expect(await data("users/alice")).toMatchObject({ agencyVerificationStatus: "approved", hasAgencyBadge: true });
    expect(await purgeIdentityRecords(db, cloud, expiry.data.toMillis())).toEqual({ photosDeleted: 0, recordsDeleted: 0, failed: 0 });
    cloud.uploader.destroy.mockClear();
  });
  it("runs retention only with the configured cron credential and safely repeats", async () => {
    const cronSecret = "local-test-cron-authorization-key";
    vi.stubEnv("CRON_SECRET", cronSecret);
    try {
      const cron = createApp({ adminDb: db, adminAuth: auth, cloudinaryClient: cloud, identityCipher });
      const route = "/api/internal/identity-retention";
      await request(cron).get(route).expect(401);
      await request(cron).get(route).set("Authorization", `Bearer ${cronSecret}`)
        .expect(200, { photosDeleted: 0, recordsDeleted: 0, failed: 0 });
      await request(cron).get(route).set("Authorization", `Bearer ${cronSecret}`)
        .expect(200, { photosDeleted: 0, recordsDeleted: 0, failed: 0 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("a valid job application grants CV access to the actual employer only", async () => {
    await seed("vacancies/v", { employerId: "bob", title: "Casting" });
    const mediaKey = hash(key);
    await seed("mediaAssets/" + mediaKey, {
      ownerUid: "alice",
      deliveryType: "authenticated",
      purpose: "cv",
    });
    expect(
      (
        await write(
          "alice",
          "jobApplications/a",
          {
            jobId: "v",
            employerId: "mallory",
            userId: "alice",
            cvUrl: "/api/media/" + mediaKey,
            status: "pending",
          },
          "set",
        )
      ).status,
    ).toBe(200);
    expect((await data("mediaAssets/" + mediaKey))?.allowedUserIds).toEqual([
      "bob",
    ]);
  });
  it("public URL deletion fails closed when ownership metadata is missing", async () => {
    const mediaApp = createApp({
      adminDb: db,
      adminAuth: auth,
      cloudinaryClient: cloud,
    });
    expect(
      (
        await request(mediaApp)
          .post("/api/delete-media")
          .set("Authorization", "Bearer alice")
          .send({
            url: "https://res.cloudinary.com/test-cloud/image/upload/v123/other-user-photo.jpg",
          })
      ).status,
    ).toBe(403);
    expect(cloud.uploader.destroy).not.toHaveBeenCalled();
  });
});

describe("Compatibility of approvals, unread indexes and input validation", () => {
  it("an atomic agency approval accepts the original admin fields", async () => {
    const input = await identityApplicationInput();
    expect((await write("alice", "agency_applications/alice", input, "set")).status).toBe(200);
    const r = await call("super", "/api/data/mutate", {
      operations: [
        {
          path: "agency_applications/alice",
          kind: "update",
          data: { status: "approved", reviewedAt: 1, reviewedBy: "super" },
        },
        {
          path: "agencies/agency1",
          kind: "set",
          data: { name: "Agency", linkedUserId: "alice", hasAgencyBadge: true },
        },
        {
          path: "users/alice",
          kind: "update",
          data: {
            isAgency: true,
            isAgencyRepresentative: true,
            hasAgencyBadge: true,
            agencyBadgeGrantedAt: 1,
            agencyVerificationStatus: "approved",
            representedAgencyName: "Agency",
            representedAgencyId: "agency1",
            industry: "agency",
          },
        },
      ],
    });
    expect(r.status).toBe(200);
    expect((await data("users/alice"))?.hasAgencyBadge).toBe(true);
    expect((await data("publicProfiles/alice"))?.agencyBadgeGrantedAt).toBe(1);
  });
  it("designer approval preserves its original Direct Chat fields", async () => {
    const r = await call("super", "/api/data/mutate", {
      operations: [
        {
          path: "designers/brand",
          kind: "set",
          data: { name: "Brand", linkedUserId: "alice" },
        },
        {
          path: "users/alice",
          kind: "update",
          data: {
            isDesigner: true,
            hasGoldenNeedle: true,
            goldenNeedleStatus: "approved",
            goldenNeedleGrantedAt: 1,
            hasDirectChat: true,
            directChatEnabled: true,
            designerVerificationStatus: "approved",
            designerBrandName: "Brand",
            brandName: "Brand",
            designerId: "brand",
            industry: "fashion_design",
          },
        },
      ],
    });
    expect(r.status).toBe(200);
    expect((await data("publicProfiles/alice"))?.hasDirectChat).toBe(true);
  });
  it("the unread query is usable only after trusted legacy migration is complete", async () => {
    await conversation();
    await db
      .doc("conversations/alice_bob")
      .update({ unreadFor: ["bob"], unreadCounts: { alice: 0, bob: 2 } });
    const q = query(
      collection(browser("bob"), "conversations"),
      where("unreadFor", "array-contains", "bob"),
      orderBy("updatedAt", "desc"),
      limit(20),
    );
    await assertFails(getDocs(q));
    await seed("_system/profileSeparationV1", { completedAt: Timestamp.now() });
    expect((await assertSucceeds(getDocs(q))).size).toBe(1);
    expect(
      (
        await write("alice", "conversations/alice_bob", {
          unreadFor: ["mallory"],
        })
      ).status,
    ).toBe(400);
  });
  it("reading a conversation removes its derived unread index without another document write", async () => {
    await conversation();
    await db
      .doc("conversations/alice_bob")
      .update({ unreadFor: ["bob"], unreadCounts: { alice: 0, bob: 2 } });
    expect(
      (await write("bob", "conversations/alice_bob", { "unreadCounts.bob": 0 }))
        .status,
    ).toBe(200);
    expect((await data("conversations/alice_bob"))?.unreadFor).toEqual([]);
  });
  it("rejects render-breaking object fields in public posts and private applications", async () => {
    expect(
      (
        await write(
          "alice",
          "feedPosts/bad",
          { userId: "alice", content: "Hello", tag: { bad: true } },
          "set",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await write(
          "alice",
          "agency_applications/bad",
          { userId: "alice", agencyName: { bad: true }, status: "pending" },
          "set",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await write(
          "alice",
          "posts/bad",
          { userId: "alice", description: { bad: true } },
          "set",
        )
      ).status,
    ).toBe(400);
  });
  it("a profile rename refreshes indexed aliases and preserves protected account fields", async () => {
    await db.doc("users/alice").update({ hasGoldenNeedle: true });
    expect(
      (
        await write("alice", "publicProfiles/alice", {
          name: "Roma",
          username: "roma.test",
        })
      ).status,
    ).toBe(200);
    const p = await data("publicProfiles/alice");
    expect(p?.searchName).toBe("roma");
    expect(p?.searchHandle).toBe("roma.test");
    expect(p?.searchId).toBe("alice");
    expect((await data("users/alice"))?.hasGoldenNeedle).toBe(true);
  });
  it("read-all notifications can actually be cleared through the cursor", async () => {
    await seed("notifications/n", {
      userId: "alice",
      createdAt: Date.now() - 1000,
      read: false,
    });
    await call("alice", "/api/notifications/read-all");
    expect((await call("alice", "/api/notifications/clear-read")).status).toBe(
      200,
    );
    expect(await data("notifications/n")).toBeUndefined();
  });
});

describe("Capacity and legacy reapplication controls", () => {
  it("honors the original availableTickets counter", async () => {
    await seed("events/e", {
      title: "Runway",
      price: 0,
      totalTickets: 100,
      availableTickets: 1,
    });
    expect(
      (await call("alice", "/api/tickets/purchase", { eventId: "e" })).status,
    ).toBe(200);
    expect((await data("events/e"))?.availableTickets).toBe(0);
    expect((await data("events/e"))?.ticketsSold).toBe(100);
    expect(
      (await call("bob", "/api/tickets/purchase", { eventId: "e" })).status,
    ).toBe(409);
  });
  it("blocks a duplicate legacy job application and allows a quarantined CV to be resubmitted", async () => {
    await seed("vacancies/v", { employerId: "bob", title: "Casting" });
    await seed("jobApplications/old-random-id", {
      jobId: "v",
      userId: "alice",
      employerId: "bob",
      status: "pending",
      createdAt: 1,
    });
    const body = {
      jobId: "v",
      userId: "alice",
      status: "pending",
      name: "Alice",
    };
    expect(
      (await write("alice", "jobApplications/new-random", body, "set")).status,
    ).toBe(409);
    await db
      .doc("jobApplications/old-random-id")
      .update({ needsDocumentReupload: true });
    expect(
      (await write("alice", "jobApplications/new-random", body, "set")).status,
    ).toBe(200);
    expect((await db.collection("jobApplications").get()).size).toBe(1);
    expect(
      (await data("jobApplications/old-random-id"))?.needsDocumentReupload,
    ).toBe(false);
  });
});

describe("Release 1.3.3 workflows", () => {
  it("changes both sides of a follow atomically and creates one server notification", async () => {
    const operations = [
      { path: "publicProfiles/alice", kind: "update", data: { following: { __afwOp: "union", values: ["bob"] } } },
      { path: "publicProfiles/bob", kind: "update", data: { followers: { __afwOp: "union", values: ["alice"] } } },
    ];
    await call("alice", "/api/data/mutate", { operations }).expect(200);
    await call("alice", "/api/data/mutate", { operations }).expect(200);
    expect(await data("publicProfiles/alice")).toHaveProperty("following", ["bob"]);
    expect(await data("publicProfiles/bob")).toHaveProperty("followers", ["alice"]);
    expect((await db.collection("notifications").where("userId", "==", "bob").get()).size).toBe(1);
    const bad = [
      { ...operations[0], data: { following: { __afwOp: "remove", values: ["bob"] } } },
      { ...operations[1], data: { followers: ["mallory"] } },
    ];
    await call("alice", "/api/data/mutate", { operations: bad }).expect(403);
    expect(await data("publicProfiles/alice")).toHaveProperty("following", ["bob"]);
  });

  it("sanitizes HTML from the rich text editor before publishing news", async () => {
    await write("super", "news/fixture-html", {
      title: "News fixture", createdAt: Date.now(),
      content: '<p>Public article</p><img src="https://example.com/photo.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Link</a>',
    }, "set").expect(200);
    const article = await data("news/fixture-html");
    expect(article?.content).toContain("Public article");
    expect(article?.content).not.toMatch(/onerror|<script|javascript:/);
  });

  it("restores a missing built-in agency when selected and applies the change after review", async () => {
    await agency();
    const target = { agencyId: "default:big-model-agency" };
    const pending = await call("rep", "/api/agency/affiliation", target);
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body).toMatchObject({ toId: target.agencyId, toName: "Big Model Agency", status: "pending" });
    expect(await data("agencies/" + target.agencyId)).toMatchObject({ name: "Big Model Agency" });
    expect(await data("agencies/" + target.agencyId)).not.toHaveProperty("linkedUserId");
    const approved = await call("super", "/api/admin/agency-transfers/rep", { approved: true, requestedAt: pending.body.requestedAt });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await data("publicProfiles/rep")).toMatchObject({ representedAgencyId: target.agencyId, representedAgencyName: "Big Model Agency" });
    expect(await data("agencies/" + target.agencyId)).toHaveProperty("linkedUserId", "rep");
  });

  it("resolves a built-in selection to its existing listing and keeps occupied agencies protected", async () => {
    await agency();
    await seed("agencies/existing_big", { name: "Big Model Agency", linkedUserId: "bob" });
    const move = await call("rep", "/api/agency/affiliation", { agencyId: "default:big-model-agency" });
    expect(move.status).toBe(409);
    expect(move.body.code).toBe("agency_target_occupied");
    expect(await data("agencies/default:big-model-agency")).toBeUndefined();
    await db.doc("agencies/existing_big").update({ linkedUserId: null });
    const allowed = await call("rep", "/api/agency/affiliation", { agencyId: "default:big-model-agency" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.toId).toBe("existing_big");
    expect(await data("agencies/default:big-model-agency")).toBeUndefined();
  });

  it("uses a confirmed server account with a missing reverse catalogue link and requires review", async () => {
    await agency();
    await db.doc("agencies/agency1").update({ linkedUserId: null });
    const pending = await call("rep", "/api/agency/affiliation", { agencyId: "default:big-model-agency" });
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.status).toBe("pending");
    const approved = await call("super", "/api/admin/agency-transfers/rep", { approved: true, requestedAt: pending.body.requestedAt });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await data("users/rep")).toHaveProperty("representedAgencyName", "Big Model Agency");
  });

  it("preserves a model's declared agency across profile saves without granting verification", async () => {
    await write("alice", "users/alice", { isModel: true, declaredModelAgencyName: "Big Model Agency" }).expect(200);
    expect(await data("publicProfiles/alice")).toMatchObject({ isModel: true, declaredModelAgencyName: "Big Model Agency" });
    expect(await data("users/alice")).not.toHaveProperty("hasModelBadge", true);
    expect(await data("users/alice")).not.toHaveProperty("modelAgencyId");
  });

  it("supports a confirmed server account with only the original agency name after admin review", async () => {
    await agency();
    const current = await data("users/rep");
    delete current!.representedAgencyId;
    await seed("users/rep", current);
    await db.doc("agencies/agency1").update({ linkedUserId: null });
    const pending = await call("rep", "/api/agency/affiliation", { agencyId: "default:big-model-agency" });
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body).toMatchObject({ fromId: "agency1", status: "pending" });
    const approved = await call("super", "/api/admin/agency-transfers/rep", { approved: true, requestedAt: pending.body.requestedAt });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await data("users/rep")).toHaveProperty("representedAgencyName", "Big Model Agency");
  });

  it("returns all 13 accounts, tolerates a missing public profile and keeps the confirmed primary owner", async () => {
    for (let i = 0; i < 7; i++) await seed(`users/member_${i}`, { role: "superadmin", createdAt: Timestamp.now() });
    const get = (path: string, uid = "super") => request(app).get(path).set("Authorization", "Bearer " + uid);
    const first = await get("/api/admin/users?limit=6");
    expect(first.body.users).toHaveLength(6);
    const second = await get("/api/admin/users?cursor=" + first.body.nextCursor);
    expect(second.body.users).toHaveLength(7);
    expect(second.body.users.some((user: any) => user.email === "super@example.az")).toBe(true);
    expect(second.body.users.every((user: any) => Number.isFinite(user.createdAt))).toBe(true);
    expect((await get("/api/admin/superadmins")).body.members).toContainEqual(expect.objectContaining({ email: "super@example.az" }));
    expect((await call("super", "/api/admin/superadmins/retain", { email: "bob@example.az" })).status).toBe(403);
    expect((await call("super", "/api/admin/superadmins/retain", { email: "super@example.az" })).body.changed).toBe(7);
    expect(await data("users/member_0")).toMatchObject({ role: "user" });
    expect(await data("users/super")).toMatchObject({ role: "superadmin" });
  });

  it("moves a representative to an approved agency and leaves the previous agency's models in place", async () => {
    await agency();
    await db.doc("publicProfiles/alice").update({ modelAgencyId: "agency1", hasModelBadge: true });
    await seed("agencies/next_agency", { name: "New Agency" });
    await seed("agencies/claimed", { name: "Already Assigned", linkedUserId: "bob" });
    const move = (uid: string, agencyId: string) => call(uid, "/api/agency/affiliation", { agencyId });
    expect((await move("mallory", "next_agency")).status).toBe(403);
    expect((await move("rep", "claimed")).status).toBe(409);
    expect((await write("rep", "agencies/agency1", { linkedUserId: "bob" })).status).toBe(403);
    const roster = await request(app).get("/api/agency/roster").set("Authorization", "Bearer rep");
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    expect(roster.body.users).toEqual([expect.objectContaining({ id: "alice" })]);
    expect(roster.body.users[0].email).toBeUndefined();

    const pending = await move("rep", "next_agency");
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body).toMatchObject({ status: "pending", fromId: "agency1", toId: "next_agency" });
    expect(await data("users/rep")).toHaveProperty("representedAgencyId", "agency1");
    const review = { approved: true, requestedAt: pending.body.requestedAt };
    expect((await call("rep", "/api/admin/agency-transfers/rep", review)).status).toBe(403);
    const approved = await call("super", "/api/admin/agency-transfers/rep", review);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await data("users/rep")).toMatchObject({ representedAgencyId: "next_agency", representedAgencyName: "New Agency" });
    expect(await data("publicProfiles/rep")).toHaveProperty("representedAgencyId", "next_agency");
    expect(await data("agencies/agency1")).toMatchObject({ name: "Agency", linkedUserId: null });
    expect(await data("agencies/next_agency")).toHaveProperty("linkedUserId", "rep");
    expect(await data("publicProfiles/alice")).toHaveProperty("modelAgencyId", "agency1");
    expect((await request(app).get("/api/agency/roster").set("Authorization", "Bearer rep")).body.users).toEqual([]);
  });

  it("recognizes an older catalogue link even when the agency flags are outside the main account", async () => {
    await seed('agencies/ln_models', { name: 'LN Models', linkedUserId: 'rep' });
    await seed('agencies/big_model', { name: 'Big Model Agency' });
    const legacy = { representedAgencyId: 'ln_models', representedAgencyName: 'LN Models',
      agencyVerificationStatus: 'approved', isAgencyRepresentative: true, hasAgencyBadge: true };
    await db.doc('users/rep/private/account').update(legacy);
    await db.doc('publicProfiles/rep').update(legacy);
    const status = await request(app).get('/api/agency/affiliation').set('Authorization', 'Bearer rep');
    expect(status.body).toMatchObject({ agencyId: 'ln_models', agencyName: 'LN Models' });

    await db.doc('publicProfiles/bob').update(legacy);
    const next = { agencyId: 'big_model' };
    expect((await call('bob', '/api/agency/affiliation', next)).body.code).toBe('agency_source_missing');
    const pending = await call('rep', '/api/agency/affiliation', next);
    expect(pending.body).toMatchObject({ status: 'pending', fromId: 'ln_models', toId: 'big_model' });
    expect((await call('rep', '/api/agency/affiliation', next)).body.requestedAt).toBe(pending.body.requestedAt);
    expect(await data('users/rep')).not.toHaveProperty('representedAgencyId');
    const approved = await call('super', '/api/admin/agency-transfers/rep', { approved: true, requestedAt: pending.body.requestedAt });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await data('users/rep')).toMatchObject({ ...legacy, representedAgencyId: 'big_model', representedAgencyName: 'Big Model Agency' });
    expect(await data('publicProfiles/rep')).toHaveProperty('representedAgencyId', 'big_model');
    expect(await data('users/rep/private/account')).not.toHaveProperty('representedAgencyId');
    expect(await data('agencies/ln_models')).toHaveProperty('linkedUserId', null);
  });

  it("accepts an application with questions, then decides new applications using the vacancy's closed state", async () => {
    await seed("vacancies/open_call", {
      employerId: "bob", title: "Casting", type: "casting",
      customQuestions: [{ id: "availability", question: "Available?", required: true, type: "yes_no" }],
    });
    const apply = (uid: string) => write(uid, "jobApplications/new_" + uid, {
      jobId: "open_call", userId: uid, name: uid, status: "pending",
      customAnswers: [{ questionId: "availability", question: "Available?", type: "yes_no", answer: "Yes" }],
    }, "set");
    const sent = await apply("alice");
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect((await db.collection("notifications").where("userId", "==", "bob").get()).size).toBe(1);
    expect((await write("rep", "vacancies/open_call", { status: "closed" })).status).toBe(403);
    expect((await write("bob", "vacancies/open_call", { status: "closed" })).status).toBe(200);
    const rejected = await apply("mallory");
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("vacancy_closed");
    expect((await db.collection("jobApplications").get()).size).toBe(1);
  });

  it("publishes one announcement for all authenticated users and updates read state per recipient", async () => {
    const publication = { requestId: "public-announcement", title: "Runway schedule", message: "The show starts at six", link: "/events" };
    expect((await call("alice", "/api/admin/announcements", publication)).status).toBe(403);
    expect((await call("super", "/api/admin/announcements", publication)).status).toBe(200);
    expect((await call("super", "/api/admin/announcements", publication)).status).toBe(200);
    const forUser = await request(app).get("/api/notifications/announcements").set("Authorization", "Bearer bob");
    expect(forUser.body.items).toHaveLength(1);
    expect((await db.collection("notifications").get()).empty).toBe(true);
    expect((await call("alice", "/api/notifications/announcements/public-announcement/read")).status).toBe(200);
    expect(await data("users/alice/private/account")).toHaveProperty("announcementReadIds", ["public-announcement"]);
    expect(await data("users/bob/private/account")).not.toHaveProperty("announcementReadIds");
  });

  it("locks the last paid seat for six hours and issues a single QR only after provider confirmation", async () => {
    let status: "paid" | "expired" | "pending" = "pending";
    let sequence = 0;
    const gateway: TicketGateway = {
      create: vi.fn(async () => ({ id: `test_invoice_${++sequence}`, url: "https://mpi.3dsecure.az/redirect/test_invoice" })),
      status: vi.fn(async () => status),
    };
    const checkout = createApp({ adminDb: db, adminAuth: auth, ticketGateway: gateway });
    const post = (uid: string, path: string, input: any) => request(checkout).post(path).set("Authorization", "Bearer " + uid).send(input);
    const event = { title: "Admission Pass", price: 52, totalTickets: 1, availableTickets: 1, date: Date.now() + 86400000 };
    await seed("events/checkout", event);
    const input = { eventId: "checkout", price: 1, paymentConfirmed: true };
    const at = Date.now();
    const holds = await Promise.all(["alice", "bob"].map(uid => post(uid, "/api/tickets/reserve", input)));
    expect(holds.map(x => x.status).sort(), JSON.stringify(holds.map(x => x.body))).toEqual([200, 409]);
    const holder = holds[0].ok ? "alice" : "bob";
    const held = holds.find(response => response.ok)!;
    expect(held.body).toMatchObject({ status: "reserved", price: 52 });
    expect(held.body.expiresAt - at).toBeGreaterThanOrEqual(ticketHoldMs);
    expect(held.body.expiresAt - at).toBeLessThan(ticketHoldMs + 10000);
    expect((await db.collection("tickets").get()).empty).toBe(true);
    expect((await post(holder, "/api/tickets/pay", input)).body.paymentUrl).toMatch(/mpi\.3dsecure\.az/);
    expect((await post(holder, "/api/tickets/check-payment", input)).body.status).toBe("reserved");
    status = "expired";
    expect((await post(holder, "/api/tickets/check-payment", input)).body).toMatchObject({
      status: "reserved", checkoutStarted: false, expiresAt: held.body.expiresAt,
    });
    expect((await post(holder, "/api/tickets/pay", input)).body.checkoutStarted).toBe(true);
    status = "paid";
    const results = await Promise.all([1, 2].map(() => post(holder, "/api/tickets/check-payment", input)));
    expect(results.map(row => row.body.status)).toEqual(["issued", "issued"]);
    expect(results[0].body.qrCodeData).toBe(results[1].body.qrCodeData);
    expect((await db.collection("transactions").get()).size).toBe(1);
    expect(await data("events/checkout")).toMatchObject({ ticketsSold: 1, availableTickets: 0 });
  });

  it("holds up to three seats for free, returns them at expiry and preserves a repeated hold", async () => {
    const eventId = "group_reserve";
    await seed(`events/${eventId}`, { title: "Runway", price: 52, date: Date.now() + 86400000, totalTickets: 4, availableTickets: 4 });
    const reserve = (uid: string, quantity: number) => call(uid, "/api/tickets/reserve", { eventId, quantity });
    const stock = () => request(app).get(`/api/public/ticket-availability/${eventId}`);
    expect((await stock()).body.availableTickets).toBe(4);
    expect((await reserve("bob", 4)).status).toBe(400);
    const competing = await Promise.all([reserve("alice", 3), reserve("bob", 3)]);
    expect(competing.map(result => result.status).sort(), JSON.stringify(competing.map(result => result.body))).toEqual([200, 409]);
    const first = competing.find(result => result.ok)!;
    const holder = competing[0].ok ? "alice" : "bob";
    const other = holder === "alice" ? "bob" : "alice";
    expect(first.body).toMatchObject({ status: "reserved", paymentsEnabled: false, price: 156, quantity: 3 });
    expect((await reserve(holder, 1)).body).toMatchObject({ quantity: 3, expiresAt: first.body.expiresAt });
    expect((await stock()).body).toEqual({ availableTickets: 1, nextReleaseAt: first.body.expiresAt });
    expect(first.body.inventory.availableTickets).toBe(1);
    expect((await db.collection("tickets").get()).empty).toBe(true);
    expect((await db.collection("transactions").get()).empty).toBe(true);
    const order = hash(eventId + "|" + holder + "|free");
    const expiredAt = Date.now() - 10;
    const batch = db.batch();
    batch.update(db.doc(`ticketReservations/${order}`), { expiresAt: expiredAt });
    for (const id of [order, order + "_2", order + "_3"]) batch.update(db.doc(`events/${eventId}/ticketHolds/${id}`), { until: expiredAt });
    await batch.commit();
    expect((await stock()).body).toEqual({ availableTickets: 4, nextReleaseAt: null });
    expect((await reserve(other, 3)).status).toBe(200);
  });

  it("creates three distinct passes when an existing zero-price reservation is claimed explicitly", async () => {
    const eventId = "free_group";
    await seed(`events/${eventId}`, { title: "Open Runway", price: 0, date: Date.now() + 86400000, totalTickets: 3, availableTickets: 3 });
    expect((await call("alice", "/api/tickets/reserve", { eventId, quantity: 3 })).body).toMatchObject({ status: "reserved", quantity: 3 });
    expect((await db.collection("tickets").get()).empty).toBe(true);
    const issued = await call("alice", "/api/tickets/purchase", { eventId });
    expect(issued.body).toMatchObject({ status: "issued", quantity: 3, price: 0 });
    expect(issued.body.ticketIds).toHaveLength(3);
    const passes = await db.collection("tickets").get();
    expect(new Set(passes.docs.map(doc => doc.get("qrCodeData"))).size).toBe(3);
    expect((await request(app).get(`/api/public/ticket-availability/${eventId}`)).body.availableTickets).toBe(0);
  });

  it('checks in server-issued regular and VIP tickets once, with staff role and event validation', async () => {
    const eventId = 'scan_show';
    const future = Date.now() + 86400000;
    await seed('users/staff', { role: 'ticket_editor' });
    await seed('events/' + eventId, { title: 'Runway', price: 0, date: future, totalTickets: 7, availableTickets: 7 });
    await seed('events/other_show', { title: 'Other Runway', date: future });
    const pass = await call('alice', '/api/tickets/purchase', { eventId });
    expect(pass.body.status).toBe('issued');
    const scan = (uid: string, token: string, show = eventId) => call(uid, '/api/admin/tickets/check-in', { eventId: show, token });
    const ticketId = pass.body.ticketId;
    const qr = pass.body.qrCodeData;
    expect((await scan('alice', qr)).status).toBe(403);
    expect((await scan('editor', qr)).status).toBe(403);
    expect((await scan('staff', qr, 'other_show')).body.code).toBe('ticket_scan_wrong_event');
    expect(await data('tickets/' + ticketId)).toHaveProperty('status', 'active');
    const [first, second] = await Promise.all([scan('staff', qr), scan('staff', qr)]);
    expect([first.body.status, second.body.status].sort()).toEqual(['already_used', 'checked_in']);
    expect(first.body.usedAt).toBe(second.body.usedAt);
    expect(await data('tickets/' + ticketId)).toMatchObject({ status: 'used', usedBy: 'staff', usedAt: first.body.usedAt });
    expect((await write('staff', 'tickets/' + ticketId, { status: 'active' })).body.code).toBe('ticket_record_protected');

    await seed('giveaway_entries/gift', { eventId, userId: 'bob', userName: 'Guest', status: 'entered' });
    const award = await call('super', '/api/admin/giveaway-award', { entryId: 'gift' });
    const winningTicket = await data('tickets/' + award.body.ticketId);
    if (!winningTicket) throw new Error('Giveaway fixture ticket was not issued');
    expect((await scan('staff', winningTicket.qrCodeData)).body).toMatchObject({ status: 'checked_in', kind: 'giveaway' });
    expect((await call('super', '/api/admin/giveaway-award', { entryId: 'gift' })).body.ticketId).toBe(award.body.ticketId);
    expect(await data('tickets/' + award.body.ticketId)).toHaveProperty('status', 'used');
    const another = await call('bob', '/api/tickets/purchase', { eventId });
    await db.doc('tickets/' + another.body.ticketId).update({ status: 'revoked' });
    expect((await scan('staff', another.body.qrCodeData)).body.code).toBe('ticket_scan_inactive');
    expect((await scan('staff', 'unrelated')).body.code).toBe('ticket_scan_invalid');
    await db.doc('events/' + eventId).update({ status: 'cancelled' });
    expect((await scan('staff', qr)).body.code).toBe('ticket_scan_event_closed');
  });

  it("opens expired uncharged stock for another user and expires event records while retaining tickets six months", async () => {
    const gateway: TicketGateway = {
      create: vi.fn(async () => ({ id: "invoice", url: "https://mpi.3dsecure.az/redirect/test" })),
      status: vi.fn(async () => "expired" as const),
    };
    const checkout = createApp({ adminDb: db, adminAuth: auth, ticketGateway: gateway });
    const post = (uid: string, eventId: string) => request(checkout).post("/api/tickets/reserve").set("Authorization", "Bearer " + uid).send({ eventId });
    const at = Date.now();
    await seed("events/release", { title: "Runway", price: 52, totalTickets: 1, availableTickets: 1 });
    const first = await post("alice", "release");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const order = hash("release|alice|free");
    await db.doc(`ticketReservations/${order}`).update({ expiresAt: at - 1000 });
    await db.doc(`events/release/ticketHolds/${order}`).update({ until: at - 1000 });
    expect((await post("bob", "release")).status).toBe(200);
    const date = at - 3 * 86400000;
    await seed("events/ended", { date, endDate: date + 3600000 });
    await seed("tickets/keep", { eventId: "ended", userId: "alice", status: "used" });
    await seed("tickets/expired", { eventId: "old", userId: "alice", expiresAt: at - 1000 });
    await maintainEventRecords(db, at);
    expect(await data("events/ended")).toBeUndefined();
    expect(await data("tickets/expired")).toBeUndefined();
    expect(await data("tickets/keep")).toMatchObject({
      eventEndedAt: date + 3600000,
      expiresAt: monthsAfterBaku(eventEndMillis({ date, endDate: date + 3600000 }), 6),
    });
  });

  it("uses one free month for annual billing and grants benefits only after settling the exact invoice", async () => {
    let result: "pending" | "paid" = "pending";
    const create = vi.fn<TicketGateway["create"]>(async () => ({ id: "invoice_annual", url: "https://mpi.3dsecure.az/redirect/subscription" }));
    const checkout = createApp({ adminDb: db, adminAuth: auth, ticketGateway: { create, status: async () => result } });
    const post = (path: string, data: any) => request(checkout).post(path).set("Authorization", "Bearer alice").send(data);
    const order = await post("/api/subscriptions/purchase", { planId: "elite", billingCycle: "yearly", amount: 0, paymentConfirmed: true });
    expect(order.status, JSON.stringify(order.body)).toBe(200);
    expect(create.mock.calls[0][0].amountMinor).toBe(53900);
    expect(await data("users/alice/private/account")).toHaveProperty("subscriptionTier", "free");
    result = "paid";
    expect((await post("/api/subscriptions/check-payment", {})).body).toMatchObject({ status: "applied", plan: "elite" });
    expect(await data("users/alice/private/account")).toMatchObject({ subscriptionTier: "elite", subscriptionValidUntil: expect.any(Number) });
    expect((await db.collection("transactions").get()).size).toBe(1);
  });
});
