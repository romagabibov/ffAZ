import { describe, it, expect } from "vitest";
import {
  boundedJson,
  expandTransforms,
  patchData,
  publicProfile,
  validateProfile,
  activeSubscription,
} from "../../src/server/security";
import { extractCloudinaryInfo, createApp } from "../../src/server/app";
import request from "supertest";
describe("Input boundaries", () => {
  it("public projection omits email, entitlements, blocklists and identity media", () => {
    const p = publicProfile({
      name: "Roma",
      email: "private@test.az",
      subscriptionTier: "elite",
      blockedUsers: ["x"],
      role: "user",
      idCardPhotoUrl: "secret",
      profileData: { skills: ["Design"] },
    });
    expect(p.email).toBeUndefined();
    expect(p.subscriptionTier).toBeUndefined();
    expect(p.blockedUsers).toBeUndefined();
    expect(p.idCardPhotoUrl).toBeUndefined();
    expect(p.name).toBe("Roma");
    expect(p.searchName).toBe("roma");
  });
  it("rejects prototype keys and excessive nesting", () => {
    expect(() =>
      boundedJson(JSON.parse('{"__proto__":{"admin":true}}')),
    ).toThrow();
    let x: any = {};
    for (let i = 0; i < 13; i++) x = { next: x };
    expect(() => boundedJson(x)).toThrow();
  });
  it("rejects privileged nested profile payload and javascript links", () => {
    expect(() =>
      validateProfile({
        profileData: {
          generalInfo: { website: "javascript:alert(1)" },
          experience: [],
          education: [],
          skills: [],
        },
      }),
    ).toThrow();
    expect(() => validateProfile({ profileData: { role: "admin" } })).toThrow();
  });
  it("bounded transforms preserve unrelated map entries", () => {
    const x = patchData(
      { counts: { a: 1, b: 2 } },
      { "counts.a": { __afwOp: "increment", value: 1 } },
    );
    expect(x).toEqual({ counts: { a: 2, b: 2 } });
    expect(() =>
      expandTransforms({ __afwOp: "increment", value: Infinity }, 0),
    ).toThrow();
  });
  it("expires paid access even when the tier label is still present", () => {
    expect(
      activeSubscription({
        admin: false,
        private: {
          subscriptionTier: "elite",
          subscriptionExpiresAt: Date.now() - 1000,
        },
      } as any),
    ).toBe(false);
  });
  it("does not accept lookalike Cloudinary hosts", () => {
    expect(
      extractCloudinaryInfo(
        "https://cloudinary.com.attacker.test/image/upload/private.jpg",
      ),
    ).toBeNull();
    expect(
      extractCloudinaryInfo(
        "https://res.cloudinary.com/demo/image/upload/v123/afw/u/file.jpg",
      )?.publicId,
    ).toBe("afw/u/file");
    expect(
      extractCloudinaryInfo(
        "https://res.cloudinary.com/demo/raw/upload/v123/afw/u/file.pdf",
      )?.publicId,
    ).toBe("afw/u/file.pdf");
  });
});
describe("HTTP trust boundary without a database", () => {
  const auth = {
    verifyIdToken: async () => {
      throw new Error("secret-token-provider-failure");
    },
  } as any;
  const app = createApp({ adminDb: {} as any, adminAuth: auth });
  it("rejects an unauthenticated write", async () => {
    expect(
      (await request(app).post("/api/data/mutate").send({ operations: [] }))
        .status,
    ).toBe(401);
  });
  it("rejects invalid tokens without exposing internal failures", async () => {
    const r = await request(app)
      .post("/api/data/mutate")
      .set("Authorization", "Bearer bad")
      .send({ operations: [] });
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("secret-token");
  });
  it("rejects cross-origin calls", async () => {
    expect(
      (
        await request(app)
          .post("/api/data/mutate")
          .set("Origin", "https://attacker.test")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("rejects oversized bodies", async () => {
    expect(
      (
        await request(app)
          .post("/api/forms")
          .send({ message: "x".repeat(400000) })
      ).status,
    ).toBe(413);
  });
  it("returns a plain JSON 400 for invalid JSON", async () => {
    const r = await request(app)
      .post("/api/forms")
      .set("Content-Type", "application/json")
      .send("{broken");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Некорректный JSON");
  });
  it("does not expose the obsolete untrusted upload and webhook handlers", async () => {
    expect((await request(app).post("/api/upload").send({})).status).toBe(404);
    expect(
      (await request(app).post("/api/tickets/webhook").send({})).status,
    ).toBe(404);
  });
});
