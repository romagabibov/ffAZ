import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { selectDataMode } from "../../src/lib/dataMode";
import { mountPublicSite } from "../../src/server/publicSite";

describe("Deployment isolation", () => {
  it("keeps AI Studio, local builds and Vercel Preview away from the live project", () => {
    expect(selectDataMode({ NODE_ENV: "production", FIREBASE_SERVICE_ACCOUNT_JSON: "configured" })).toBe("demo");
    expect(selectDataMode({ VERCEL_ENV: "preview", VITE_USE_EMULATORS: "true" })).toBe("demo");
    expect(selectDataMode({ VITE_USE_EMULATORS: "true" })).toBe("emulator");
    expect(selectDataMode({ VERCEL_ENV: "production" })).toBe("live");
  });
});

describe("Shared public settings", () => {
  it.each([
    ["/api/public/news", "news", { title: "Article", content: "<p>Public</p>", createdAt: "2026-11-18T12:00:00Z", images: ["https://example.com/photo.png"] }],
    ["/api/public/education", "education", { name: "Design School", faculties: ["Fashion"], category: "private_school" }],
  ])("shares %s across visitors and omits internal fields", async (path, collection, fixture) => {
    const get = vi.fn(async () => ({
      docs: [{ id: "fixture", data: () => ({ ...fixture, internalEmail: "private@example.test", updatedBy: "staff-only" }) }],
    }));
    const limit = vi.fn(() => ({ get }));
    const database = { collection: vi.fn(() => ({ limit, orderBy: () => ({ limit }) })) } as unknown as Firestore;
    const app = express();
    mountPublicSite(app, database);
    const visitors = await Promise.all(Array.from({ length: 20 }, () => request(app).get(path)));
    for (const response of visitors) {
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.text).not.toMatch(/private@example|staff-only|internalEmail/);
    }
    expect(database.collection).toHaveBeenCalledWith(collection);
    expect(limit).toHaveBeenCalledWith(100);
    expect(get).toHaveBeenCalledTimes(1);
    if (collection === "news") {
      expect(visitors[0].body[0].createdAt).toBe(Date.parse("2026-11-18T12:00:00Z"));
      expect(visitors[0].body[0].images[0].url).toBe("https://example.com/photo.png");
    }
  });

  it("loads the full designer directory in pages and reuses its public response", async () => {
    const docs = Array.from({ length: 103 }, (_, i) => ({
      id: String(i), data: () => ({
        name: `Brand ${i}`, designerName: `Designer ${i}`, privateNote: "internal fixture",
        ...(i === 0 ? { category: "Ателье ручной работы" } : {}),
        ...(i === 1 ? { designerType: "Əl işi", linkedUserId: "maker-profile" } : {}),
      }),
    }));
    const getFirst = vi.fn(async () => ({ docs: docs.slice(0, 100) }));
    const getNext = vi.fn(async () => ({ docs: docs.slice(100) }));
    const startAfter = vi.fn(() => ({ get: getNext }));
    const database = {
      collection: () => ({ orderBy: () => ({ limit: () => ({ get: getFirst, startAfter }) }) }),
    } as unknown as Firestore;
    const app = express();
    mountPublicSite(app, database);
    await request(app).get("/api/public/designers").expect(200).expect(response => {
      expect(response.body).toHaveLength(103);
      expect(response.body[0]).toMatchObject({ category: "handmade", linkedUserId: "" });
      expect(response.body[1]).toMatchObject({ category: "handmade", linkedUserId: "maker-profile" });
      expect(response.body.at(-1)).toMatchObject({ name: "Brand 102", founder: "Designer 102", category: "fashion" });
      expect(response.text).not.toContain("internal fixture");
    });
    await request(app).get("/api/public/designers").expect(200);
    expect(getFirst).toHaveBeenCalledTimes(1);
    expect(getNext).toHaveBeenCalledTimes(1);
    expect(startAfter).toHaveBeenCalledWith(docs[99]);
  });

  it("shares a single bounded event query across calendar visits and returns public fields only", async () => {
    const now = Date.now();
    const events = {
      new: {
        title: "Runway", date: Timestamp.fromMillis(now + 60_000), price: "52 AZN",
        availableTickets: 4, imageUrl: "/poster.png", updatedBy: "staff-login",
        ticketTiers: [{ name: "Front row", price: 75, internalNote: "hidden" }],
      },
      ongoing: { title: "Fashion exhibition", date: new Date(now - 60_000).toISOString(), endDate: now + 60_000 },
      ended: { title: "Archived show", date: now - 172_800_000, endDate: now - 30_000 },
      cancelled: { title: "Cancelled show", date: now + 60_000, status: "cancelled" },
    };
    const get = vi.fn(async () => ({
      docs: Object.entries(events).map(([id, data]) => ({ id, data: () => data })),
    }));
    const limit = vi.fn(() => ({ get }));
    const orderBy = vi.fn(() => ({ limit }));
    const collection = vi.fn(() => ({ orderBy }));
    const app = express();
    mountPublicSite(app, { collection } as unknown as Firestore);
    const visits = await Promise.all(Array.from({ length: 20 }, () => request(app).get("/api/public/events")));
    for (const result of visits) {
      expect(result.status).toBe(200);
      expect(result.headers["vercel-cdn-cache-control"]).toBe("public, s-maxage=30");
      expect(result.body.map((event: { id: string }) => event.id)).toEqual(["new", "ongoing"]);
      expect(result.body[0]).toMatchObject({
        id: "new", title: "Runway", date: now + 60_000, price: 52,
        imageUrl: "/poster.png", availableTickets: 4, ticketTiers: [{ name: "Front row", price: 75 }],
      });
      expect(result.text).not.toMatch(/staff-login|hidden/);
    }
    expect(collection).toHaveBeenCalledWith("events");
    expect(orderBy).toHaveBeenCalledWith("date", "desc");
    expect(limit).toHaveBeenCalledWith(100);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent visitors and returns only the fields used by the site", async () => {
    const loadDocument = vi.fn(async (path: string) => ({
      data: () => path === "settings/home_content"
        ? { heroTitleLine1: "Fashion", tickerEnabled: false, updatedBy: "private-admin" }
        : path === "siteSettings/features"
          ? { page_home: { enabled: true, updatedBy: "private-admin" } }
          : { links: [{ id: "inst", url: "https://example.com", platform: "instagram", isActive: true }] },
    }));
    const loadSponsors = vi.fn(async () => ({
      docs: [{ id: "one", data: () => ({ name: "Sponsor", imageUrl: "/logo.png", contactEmail: "internal@example.com" }) }],
    }));
    const database = {
      doc: (path: string) => ({ get: () => loadDocument(path) }),
      collection: () => ({ limit: () => ({ get: loadSponsors }) }),
    } as unknown as Firestore;
    const app = express();
    mountPublicSite(app, database);
    const results = await Promise.all([
      request(app).get("/api/public/site"),
      request(app).get("/api/public/site"),
      request(app).get("/api/public/site"),
    ]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        home: { heroTitleLine1: "Fashion", tickerEnabled: false },
        features: { page_home: true },
        sponsors: [{ id: "one", name: "Sponsor", imageUrl: "/logo.png" }],
      });
      expect(result.text).not.toContain("private-admin");
      expect(result.text).not.toContain("internal@example.com");
      expect(result.headers["vercel-cdn-cache-control"]).toContain("s-maxage=600");
    }
    expect(loadDocument).toHaveBeenCalledTimes(3);
    expect(loadSponsors).toHaveBeenCalledTimes(1);
  });
});
