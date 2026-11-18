import type { PublicEvent, SocialLinkItem } from "../types";
import type { HomeContentSettings } from "../components/admin/HomeMaterialsAdminTab";
import { dataMode } from "./dataMode";

type PublicSiteData = {
  home: Partial<HomeContentSettings>;
  features: Record<string, boolean> | null;
  socialLinks: SocialLinkItem[];
  sponsors: Array<{ id: string; name: string; imageUrl: string }>;
};

const emptySite: PublicSiteData = { home: {}, features: null, socialLinks: [], sponsors: [] };

function publicLoader<T>(path: string, fallback: T, freshFor = 60_000) {
  let value: T | undefined;
  let expiresAt = 0;
  let pending: Promise<T> | undefined;
  return async (): Promise<T> => {
    if (dataMode === "demo") return fallback;
    if (value !== undefined && expiresAt > Date.now()) return value;
    if (pending) return pending;
    pending = fetch(path, { credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Public data unavailable");
        value = (await response.json()) as T;
        expiresAt = Date.now() + freshFor;
        return value;
      }).catch(() => {
        expiresAt = Date.now() + 60_000;
        return (value ??= fallback);
      }).finally(() => { pending = undefined; });
    return pending;
  };
}

export const loadPublicSite = publicLoader("/api/public/site", emptySite);
export const loadPublicLive = publicLoader<Array<Record<string, unknown>>>("/api/public/live", []);
export const loadPublicEvents = publicLoader<PublicEvent[] | null>("/api/public/events", null, 15_000);
export const loadPublicNews = publicLoader<Array<Record<string, any>> | null>("/api/public/news", null);
export const loadPublicEducation = publicLoader<Array<Record<string, any>> | null>("/api/public/education", null);
export interface PublicDesigner {
  id: string;
  name: string;
  founder: string;
  linkedUserId?: string;
  linkedUserName?: string;
  linkedUserHandle?: string;
  hasGoldenNeedle?: boolean;
  category: "fashion" | "handmade";
  socials: { instagram?: string; website?: string };
}
export const loadPublicDesigners = publicLoader<PublicDesigner[] | null>("/api/public/designers", null);
