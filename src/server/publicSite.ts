import type { Express, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { PublicEvent } from "../types.js";
import { eventEndMillis, getTimestampMillis, parseEventDate } from "../lib/dateUtils.js";
import { ticketAmountMinor } from "../lib/ticketCheckout.js";
import { readDesignerDocuments } from "./designerCatalogue.js";
import { millis, publicDisplayName } from "./security.js";

const homeFields = [
  "heroBadgeText", "heroTitleLine1", "heroTitleLine2", "heroTitleLine3", "heroTypingWords",
  "heroPrimaryBtnLabel", "heroPrimaryBtnLink", "heroSecondaryBtnLabel", "heroSecondaryBtnLink",
  "heroVideoUrl", "heroPosterUrl", "heroVideoTag", "manifestoTag", "manifestoTitle",
  "manifestoDesc", "manifestoImageUrl", "manifestoImageTag", "manifestoBtnLabel",
  "manifestoBtnLink", "bannerTitle", "bannerSubtitle", "bannerBtnLabel", "bannerBtnLink",
];

function publicUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 3000 || /[\\\s]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/api/")) return value;
  try {
    const link = new URL(value);
    if (link.protocol === "https:" && !link.username && !link.password) return value;
  } catch {}
  return "";
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cached<T>(load: () => Promise<T>, ttl: number) {
  let value: T | undefined;
  let expiresAt = 0;
  let retryAt = 0;
  let pending: Promise<T> | undefined;
  return async function read(): Promise<T> {
    const time = Date.now();
    if (value !== undefined && expiresAt > time) return value;
    if (pending) return pending;
    if (retryAt > time) {
      if (value !== undefined) return value;
      throw new Error("Public content unavailable");
    }
    pending = load().then((result) => {
      value = result;
      expiresAt = Date.now() + ttl;
      return result;
    }).catch((error) => {
      retryAt = Date.now() + 60_000;
      if (value !== undefined) return value;
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

async function siteData(db: Firestore) {
  const [homeDoc, featuresDoc, socialsDoc, sponsors] = await Promise.all([
    db.doc("settings/home_content").get(),
    db.doc("siteSettings/features").get(),
    db.doc("siteSettings/socialLinks").get(),
    db.collection("sponsors").limit(40).get(),
  ]);
  const homeSource = homeDoc.data() || {};
  const home: Record<string, string | boolean> = Object.fromEntries(homeFields.flatMap((key) => {
    const value = homeSource[key];
    if (typeof value !== "string") return [];
    return [[key, /(?:Url|Link)$/.test(key) ? publicUrl(value) : text(value, 2400)]];
  }));
  if (typeof homeSource.tickerEnabled === "boolean") home.tickerEnabled = homeSource.tickerEnabled;

  const features = Object.fromEntries(Object.entries(featuresDoc.data() || {})
    .slice(0, 256)
    .flatMap(([key, value]) => {
      const enabled = typeof value === "boolean" ? value : value?.enabled;
      return /^[a-zA-Z0-9_]{1,80}$/.test(key) && typeof enabled === "boolean" ? [[key, enabled]] : [];
    }));
  const rawLinks = socialsDoc.data()?.links;
  const socialLinks = Array.isArray(rawLinks)
    ? rawLinks.slice(0, 30).flatMap((entry, index) => {
        const url = publicUrl(entry?.url);
        return url ? [{
          id: text(entry?.id, 80) || String(index),
          platform: text(entry?.platform, 40),
          label: text(entry?.label),
          url,
          isActive: entry?.isActive === true,
          order: typeof entry?.order === "number" ? entry.order : index,
        }] : [];
      })
    : [];
  return {
    home,
    features,
    socialLinks,
    sponsors: sponsors.docs.map((doc) => ({
      id: doc.id,
      name: text(doc.data().name),
      imageUrl: publicUrl(doc.data().imageUrl),
    })),
  };
}

async function liveData(db: Firestore) {
  const page = await db.collection("feedLiveMessages")
    .where("channel", "==", "public").orderBy("createdAt", "desc").limit(12).get();
  return page.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: text(data.userId, 128),
      userName: text(data.userName) || "Fashionista",
      userAvatar: publicUrl(data.userAvatar),
      userHandle: text(data.userHandle, 80),
      channel: "public",
      text: text(data.text, 500),
      createdAt: millis(data.createdAt),
      badge: text(data.badge, 120),
      isDesigner: data.isDesigner === true,
      hasGoldenNeedle: data.hasGoldenNeedle === true,
      hasModelBadge: data.hasModelBadge === true,
      hasAgencyBadge: data.hasAgencyBadge === true,
    };
  });
}

async function designersData(db: Firestore) {
  const documents = await readDesignerDocuments(db);
  return documents.map((doc) => {
    const data = doc.data();
    const isHandmade = [data.designerType, data.type, data.category].some(value =>
      /hand[\s-]*made|jewell?ery|украшен|ручн(?:ой|ая|ые)\s+работ|zərgərlik|əl[\s-]*iş/iu.test(text(value, 100)),
    );
    return {
      id: doc.id,
      name: text(data.name).trim() || text(data.brand).trim() || "Brand Name",
      founder: publicDisplayName(data.founder) || publicDisplayName(data.designerName),
      linkedUserId: text(data.linkedUserId, 128),
      linkedUserName: publicDisplayName(data.linkedUserName),
      linkedUserHandle: text(data.linkedUserHandle, 80),
      hasGoldenNeedle: data.hasGoldenNeedle === true,
      category: isHandmade ? "handmade" : "fashion",
      socials: {
        instagram: publicUrl(data.instagram || data.social),
        website: publicUrl(data.website || data.links),
      },
    };
  });
}

async function eventsData(db: Firestore): Promise<PublicEvent[]> {
  const snapshot = await db.collection("events").orderBy("date", "desc").limit(100).get();
  const now = Date.now();
  const price = (value: unknown) => {
    const minor = ticketAmountMinor(value);
    return minor === null ? undefined : minor / 100;
  };
  return snapshot.docs.flatMap(doc => {
    const data = doc.data();
    const date = parseEventDate(data.date);
    if (!date || data.status === "cancelled" || eventEndMillis(data) <= now) return [];
    const ticketTiers = Array.isArray(data.ticketTiers) ? data.ticketTiers.flatMap(tier => {
      const amount = price(tier?.price);
      return amount === undefined ? [] : [{ name: text(tier?.name), price: amount }];
    }) : [];
    return [{
      id: doc.id,
      title: text(data.title, 300),
      description: text(data.description, 3000),
      date: date.getTime(),
      endDate: parseEventDate(data.endDate)?.getTime(),
      location: text(data.location, 300),
      imageUrl: publicUrl(data.imageUrl),
      price: price(data.ticketPrice ?? data.price) ?? 0,
      availableTickets: Number.isSafeInteger(data.availableTickets) && data.availableTickets >= 0 ? data.availableTickets : undefined,
      ticketTiers,
    }];
  });
}

function newsMedia(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap(entry => {
    const url = publicUrl(typeof entry === 'string' ? entry : entry?.url);
    if (!url) return [];
    return [{
      url, id: text(entry?.id, 100), caption: text(entry?.caption, 500),
      alignment: ['full', 'left', 'right', 'center'].includes(entry?.alignment) ? entry.alignment : 'full',
      isCover: entry?.isCover === true,
    }];
  });
}

async function newsData(db: Firestore) {
  const page = await db.collection('news').orderBy('createdAt', 'desc').limit(100).get();
  return page.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id, title: text(data.title, 500), slug: text(data.slug, 500),
      content: text(data.content || data.bio, 250000), imageUrl: publicUrl(data.imageUrl),
      videoUrl: publicUrl(data.videoUrl), sourceUrl: publicUrl(data.sourceUrl),
      images: newsMedia(data.images), videos: newsMedia(data.videos),
      mediaLayout: ['hero_carousel', 'editorial_inline', 'bottom_gallery'].includes(data.mediaLayout) ? data.mediaLayout : 'hero_carousel',
      createdAt: getTimestampMillis(data.createdAt), date: getTimestampMillis(data.date),
    };
  });
}

async function educationData(db: Firestore) {
  const page = await db.collection('education').limit(100).get();
  return page.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id, name: text(data.name, 500), nameRu: text(data.nameRu, 500),
      number: typeof data.number === 'number' ? data.number : undefined,
      category: text(data.category, 50), badge: text(data.badge, 200),
      details: text(data.details || data.description, 10000), note: text(data.note, 3000),
      faculties: Array.isArray(data.faculties) ? data.faculties.filter(value => typeof value === 'string').slice(0, 100) : [],
      website: publicUrl(data.website), image: publicUrl(data.imageUrl || data.image),
    };
  });
}

export function mountPublicSite(app: Express, db: Firestore) {
  const register = (path: string, load: () => Promise<unknown>, seconds: number, browserSeconds = 60, staleSeconds = 120) => {
    const read = cached(load, seconds * 1000);
    app.get(path, async (req: Request, res: Response) => {
      if (Object.keys(req.query).length) {
        res.status(400).json({ error: "Запрос не принимает параметры" });
        return;
      }
      try {
        const data = await read();
        res.setHeader("Cache-Control", "public, max-age=" + browserSeconds);
        res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=" + seconds + (staleSeconds ? ", stale-while-revalidate=" + staleSeconds : ""));
        res.json(data);
      } catch {
        res.setHeader("Retry-After", "60");
        res.status(503).json({ error: "Публичные данные временно недоступны" });
      }
    });
  };
  register("/api/public/site", () => siteData(db), 600);
  register("/api/public/live", () => liveData(db), 120);
  register("/api/public/designers", () => designersData(db), 600);
  register("/api/public/events", () => eventsData(db), 30, 0, 0);
  register("/api/public/news", () => newsData(db), 120, 0, 0);
  register("/api/public/education", () => educationData(db), 300, 0, 0);
}
