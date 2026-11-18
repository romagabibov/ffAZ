import { getToken } from "firebase/app-check";
import { auth, appCheck } from "./firebase";
import { dataMode } from "./dataMode";
import i18n from "../i18n";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

const errorByStatus: Record<number, string> = {
  400: 'api_invalid_input', 401: 'api_sign_in', 402: 'ticket_checkout_unavailable', 403: 'api_access_denied',
  404: 'api_not_found', 409: 'api_conflict', 413: 'api_too_large', 429: 'api_rate_limit', 503: 'api_unavailable',
};

async function localizeError(response: Response) {
  if (response.ok || !response.headers.get('Content-Type')?.includes('json')) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body.error !== 'string') return response;
  const key = typeof body.code === 'string' && i18n.exists(body.code) ? body.code : null;
  if (!key && i18n.resolvedLanguage === 'ru' && /[А-Яа-яЁё]/.test(body.error)) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  return new Response(JSON.stringify({ ...body, error: i18n.t(key || errorByStatus[response.status] || 'api_request_failed') }), {
    status: response.status, statusText: response.statusText, headers,
  });
}

/**
 * Retrieves the current Firebase ID token if user is signed in.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch (err) {
    console.warn("[apiClient] Failed to get Firebase ID token:", err);
    return null;
  }
}

/**
 * Uniform fetch client that prepends VITE_API_BASE_URL and attaches Authorization Bearer token.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (dataMode === "demo") {
    return new Response(JSON.stringify({
      error: i18n.t('api_demo_unavailable'),
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!normalizedPath.startsWith("/api/")) throw new Error("Invalid application API path");
  const url = `${API_BASE_URL}${normalizedPath}`;

  const headers = new Headers(init.headers || {});
  if (appCheck) {
    const result = await getToken(appCheck);
    headers.set("X-Firebase-AppCheck", result.token);
  }

  // Add Authorization header if available and not already set
  if (!headers.has("Authorization")) {
    const token = await getAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  // Ensure JSON Content-Type if body is a string and not already set
  if (
    init.body &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    try {
      JSON.parse(init.body);
      headers.set("Content-Type", "application/json");
    } catch {
      // not a json string, leave headers as is
    }
  }

  let res = await fetch(url, {
    ...init,
    headers,
  }).catch(error => {
    if (init.signal?.aborted) throw error;
    throw new Error(i18n.t('api_network_failed'));
  });

  // Automatically attempt force token refresh & retry once on 401
  if (res.status === 401 && auth.currentUser) {
    try {
      const refreshedToken = await auth.currentUser.getIdToken(true);
      if (refreshedToken) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
        res = await fetch(url, {
          ...init,
          headers: retryHeaders,
        });
      }
    } catch (refreshErr) {
      console.warn(
        "[apiClient] Failed to force refresh token on 401:",
        refreshErr,
      );
    }
  }

  return localizeError(res);
}

// Auth state and the login page can initialize the same account concurrently.
const accountInitialization = new Map<
  string,
  { expires: number; promise: Promise<void> }
>();
export async function ensureAccount() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error(i18n.t('api_sign_in'));
  const cached = accountInitialization.get(uid);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = apiFetch("/api/account/ensure", {
    method: "POST",
    body: "{}",
  })
    .then(async (response) => {
      if (!response.ok)
        throw new Error(
          (await response.json()).error || i18n.t('api_request_failed'),
        );
    })
    .catch((error) => {
      accountInitialization.delete(uid);
      throw error;
    });
  accountInitialization.set(uid, { expires: Date.now() + 60000, promise });
  return promise;
}

export async function readApiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(path, options);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || i18n.t('api_request_failed'));
  return result as T;
}
