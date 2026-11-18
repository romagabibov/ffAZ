import i18n from "../i18n";
import { apiFetch } from "./apiClient";
import type { IdentityCollection } from "./identityPolicy";

export async function listIdentityApplications<T>(collection: IdentityCollection, options: { mine?: boolean; cursor?: string } = {}) {
  const query = new URLSearchParams();
  if (options.mine) query.set("mine", "1");
  if (options.cursor) query.set("cursor", options.cursor);
  const response = await apiFetch(`/api/identity/applications/${collection}?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(i18n.t("identity_details_error"));
  return response.json() as Promise<{ items: T[]; nextCursor?: string | null }>;
}

export async function readIdentityApplication<T extends { id: string; identityDataPresent?: boolean }>(
  collection: IdentityCollection, summary: T,
): Promise<T> {
  if (!summary.identityDataPresent) return summary;
  const response = await apiFetch(`/api/identity/details/${collection}/${encodeURIComponent(summary.id)}`, { cache: "no-store" });
  if (response.status === 404) return { ...summary, identityDataPresent: false };
  if (!response.ok) throw new Error(i18n.t("identity_details_error"));
  const { details } = await response.json();
  if (!details || typeof details !== "object") throw new Error(i18n.t("identity_details_error"));
  return { ...details, ...summary };
}
