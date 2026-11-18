/** Firebase-compatible reads with bounded queries, shared listeners and a server-only write boundary. */
import * as raw from "firebase/firestore";
import { auth } from "./firebase";
import { apiFetch } from "./apiClient";
import { dataMode } from "./dataMode";
export * from "firebase/firestore";
const metadata = new WeakMap<object, { path: string; limited?: boolean }>();
const entries: Array<{
  ref: any;
  uid: string;
  expires: number;
  promise: Promise<any>;
}> = [];
const watches: Array<{
  ref: any;
  uid: string;
  callbacks: Set<any>;
  last?: any;
  stop?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  error?: any;
}> = [];
const publicCatalogues = new Set([
  "news",
  "designers",
  "agencies",
  "education",
  "sponsors",
  "siteSettings",
  "settings",
  "ffAiKnowledge",
]);
let readBackoffUntil = 0;
function noteQuotaError(error: any) {
  if (String(error?.code || "").endsWith("resource-exhausted")) readBackoffUntil = Date.now() + 60_000;
}
function quotaError() {
  return Object.assign(new Error("Firestore временно ограничил чтения. Попробуй через минуту."), {
    code: "resource-exhausted",
  });
}
const mapPath = (xs: any[]) =>
  xs.map((v, i) =>
    i === 1 && v === "users" && xs.length <= 3 ? "publicProfiles" : v,
  );
export const collection: typeof raw.collection = ((...args: any[]) => {
  const xs = mapPath(args);
  const ref = (raw.collection as any)(...xs);
  metadata.set(ref, { path: ref.path });
  return ref;
}) as any;
export const doc: typeof raw.doc = ((...args: any[]) => {
  const xs = mapPath(args);
  const ref = (raw.doc as any)(...xs);
  metadata.set(ref, { path: ref.path });
  return ref;
}) as any;
export const query: typeof raw.query = ((ref: any, ...constraints: any[]) => {
  const result = (raw.query as any)(ref, ...constraints);
  const m = metadata.get(ref);
  metadata.set(result, {
    path: m?.path || ref.path || "",
    limited:
      m?.limited ||
      constraints.some((c) => c.type === "limit" || c.type === "limitToLast"),
  });
  return result;
}) as any;
function bounded(ref: any) {
  const m = metadata.get(ref);
  if (ref.type === "document" || m?.limited) return ref;
  const path = m?.path || ref.path || "";
  const count = path.endsWith("/messages")
    ? 50
    : path === "feedPosts"
      ? 24
      : path === "notifications" || path === "conversations"
        ? 50
        : 100;
  const result = raw.query(ref, raw.limit(count));
  metadata.set(result, { path, limited: true });
  return result;
}
function same(a: any, b: any) {
  try {
    return a.type === "document" ? raw.refEqual(a, b) : raw.queryEqual(a, b);
  } catch {
    return false;
  }
}
function cached(ref: any, load: () => Promise<any>) {
  const uid = auth.currentUser?.uid || "",
    time = Date.now();
  const hit = entries.find(
    (x) => x.uid === uid && x.expires > time && same(x.ref, ref),
  );
  if (hit) return hit.promise;
  if (readBackoffUntil > time) return Promise.reject(quotaError());
  const col = (metadata.get(ref)?.path || ref.path || "").split("/")[0],
    ttl = publicCatalogues.has(col)
      ? 300000
      : col === "publicProfiles"
        ? 60000
        : 15000;
  const entry = {
    ref,
    uid,
    expires: time + ttl,
    promise: load().catch((e) => {
      noteQuotaError(e);
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      throw e;
    }),
  };
  entries.push(entry);
  if (entries.length > 200) entries.splice(0, entries.length - 200);
  return entry.promise;
}
function emptySnapshot(ref: any) {
  const metadata = { fromCache: true, hasPendingWrites: false };
  if (ref.type === "document") {
    return { id: ref.id, ref, metadata, exists: () => false, data: () => undefined, get: () => undefined };
  }
  return { query: ref, docs: [], empty: true, size: 0, metadata, forEach: () => {}, docChanges: () => [] };
}
export const getDoc: typeof raw.getDoc = ((ref: any) =>
  dataMode === "demo" ? Promise.resolve(emptySnapshot(ref)) : cached(ref, () => raw.getDoc(ref))) as any;
export const getDocs: typeof raw.getDocs = ((ref: any) => {
  if (dataMode === "demo") return Promise.resolve(emptySnapshot(ref));
  const r = bounded(ref);
  return cached(r, () => raw.getDocs(r));
}) as any;
export const getCountFromServer: typeof raw.getCountFromServer = ((ref: any) =>
  dataMode === "demo"
    ? Promise.resolve({ query: ref, data: () => ({ count: 0 }) })
    : raw.getCountFromServer(ref)) as typeof raw.getCountFromServer;
export function clearReadCache(...collections: string[]) {
  if (!collections.length) {
    entries.length = 0;
    return;
  }
  const names = new Set(collections);
  for (let i = entries.length - 1; i >= 0; i--) {
    const path = metadata.get(entries[i].ref)?.path || entries[i].ref.path || "";
    if (names.has(path.split("/")[0])) entries.splice(i, 1);
  }
}
export const onSnapshot: typeof raw.onSnapshot = ((
  ref: any,
  ...args: any[]
) => {
  const observer = args.find(
      (x) => typeof x === "object" && typeof x.next === "function",
    ),
    callbacks = observer || {
      next: args.find((x) => typeof x === "function"),
      error: args.filter((x) => typeof x === "function")[1],
    };
  if (dataMode === "demo") {
    let active = true;
    queueMicrotask(() => { if (active) callbacks.next?.(emptySnapshot(ref)); });
    return () => { active = false; };
  }
  if (readBackoffUntil > Date.now()) {
    let active = true;
    queueMicrotask(() => { if (active) callbacks.error?.(quotaError()); });
    return () => { active = false; };
  }
  const r = bounded(ref),
    uid = auth.currentUser?.uid || "";
  let w = watches.find((x) => x.uid === uid && same(x.ref, r));
  if (!w) {
    w = { ref: r, uid, callbacks: new Set() };
    watches.push(w);
    const current = w;
    w.stop = (raw.onSnapshot as any)(
      r,
      (s: any) => {
        current.last = s;
        for (const c of current.callbacks) c.next?.(s);
      },
      (e: any) => {
        noteQuotaError(e);
        current.error = e;
        for (const c of current.callbacks) c.error?.(e);
      },
    );
  }
  if (w.timer) clearTimeout(w.timer);
  w.callbacks.add(callbacks);
  if (w.last)
    queueMicrotask(() => {
      if (w!.callbacks.has(callbacks)) callbacks.next?.(w!.last);
    });
  if (w.error) queueMicrotask(() => callbacks.error?.(w!.error));
  return () => {
    w!.callbacks.delete(callbacks);
    if (!w!.callbacks.size)
      w!.timer = setTimeout(() => {
        w!.stop?.();
        const i = watches.indexOf(w!);
        if (i >= 0) watches.splice(i, 1);
      }, 1000);
  };
}) as any;
const marker = (type: string, extra: any = {}) =>
  ({ __afwOp: type, ...extra }) as any;
export const serverTimestamp: typeof raw.serverTimestamp = () =>
  marker("timestamp");
export const increment: typeof raw.increment = (value: number) =>
  marker("increment", { value });
export const arrayUnion: typeof raw.arrayUnion = (...values: any[]) =>
  marker("union", { values });
export const arrayRemove: typeof raw.arrayRemove = (...values: any[]) =>
  marker("remove", { values });
export const deleteField: typeof raw.deleteField = () => marker("delete");
function serializable(v: any): any {
  if (v === undefined) return null;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(serializable);
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v))
      if (x !== undefined) o[k] = serializable(x);
    return o;
  }
  return v;
}
async function commit(ops: any[]) {
  const publicForms = ["subscribers", "sponsorships", "businessInquiries"];
  let response: Response;
  if (
    ops.length === 1 &&
    publicForms.includes(ops[0].path.split("/")[0]) &&
    ops[0].kind === "set"
  ) {
    response = await apiFetch("/api/forms", {
      method: "POST",
      body: JSON.stringify({
        collection: ops[0].path.split("/")[0],
        data: serializable(ops[0].data),
      }),
    });
  } else
    response = await apiFetch("/api/data/mutate", {
      method: "POST",
      body: JSON.stringify({ operations: serializable(ops) }),
    });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "Не удалось сохранить. Попробуй ещё раз.");
  clearReadCache(...ops.map((o) => o.path.split("/")[0]));
}
export const setDoc: typeof raw.setDoc = ((
  ref: any,
  data: any,
  options?: any,
) =>
  commit([
    { path: ref.path, kind: "set", data, merge: Boolean(options?.merge) },
  ])) as any;
export const updateDoc: typeof raw.updateDoc = ((
  ref: any,
  data: any,
  ...rest: any[]
) => {
  if (typeof data === "string") {
    const result: any = { [data]: rest[0] };
    for (let i = 1; i < rest.length; i += 2) result[rest[i]] = rest[i + 1];
    data = result;
  }
  return commit([{ path: ref.path, kind: "update", data }]);
}) as any;
export const deleteDoc: typeof raw.deleteDoc = ((ref: any) =>
  commit([{ path: ref.path, kind: "delete" }])) as any;
export const addDoc: typeof raw.addDoc = (async (ref: any, data: any) => {
  let document = raw.doc(ref);
  const uid = auth.currentUser?.uid;
  if (
    uid &&
    [
      "agency_applications",
      "designer_applications",
      "needleApplications",
    ].includes(ref.path)
  )
    document = raw.doc(
      ref,
      ref.path === "needleApplications"
        ? `${uid}_${data.type === "gold" ? "gold" : "silver"}`
        : uid,
    );
  await commit([{ path: document.path, kind: "set", data }]);
  return document;
}) as any;
export const writeBatch: typeof raw.writeBatch = ((_db: any) => {
  const operations: any[] = [];
  const batch: any = {
    set: (ref: any, data: any, options?: any) => {
      operations.push({
        path: ref.path,
        kind: "set",
        data,
        merge: Boolean(options?.merge),
      });
      return batch;
    },
    update: (ref: any, data: any) => {
      operations.push({ path: ref.path, kind: "update", data });
      return batch;
    },
    delete: (ref: any) => {
      operations.push({ path: ref.path, kind: "delete" });
      return batch;
    },
    commit: () => commit(operations),
  };
  return batch;
}) as any;
export const runTransaction: typeof raw.runTransaction = (async () => {
  throw new Error("Для этого действия нужен серверный обработчик");
}) as any;
