import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { disableNetwork, getFirestore, initializeFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { dataMode, DEMO_PROJECT_ID } from "./dataMode";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}


const app = initializeApp(dataMode === "live" ? firebaseConfig : {
  projectId: DEMO_PROJECT_ID,
  apiKey: "demo-api-key",
  appId: "1:000000000000:web:afw-local",
});
export const auth = getAuth(app);
export const db = dataMode === "emulator"
  ? initializeFirestore(
      app,
      {
        host: window.location.host,
        ssl: window.location.protocol === "https:",
      },
    )
  : dataMode === "live"
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
if (dataMode !== "live")
  connectAuthEmulator(auth, window.location.origin, { disableWarnings: true });
if (dataMode === "demo") void disableNetwork(db).catch(() => {});
export const appCheck = dataMode === "live" && import.meta.env.VITE_RECAPTCHA_SITE_KEY
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(
        import.meta.env.VITE_RECAPTCHA_SITE_KEY,
      ),
      isTokenAutoRefreshEnabled: true,
    })
  : null;

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const rawCode = (error as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" && /^[a-z0-9_/-]{1,80}$/i.test(rawCode) ? rawCode : "request_failed";
  console.error("Firestore operation failed", { code, operationType, collection: path?.split("/")[0] });
  throw Object.assign(new Error("Не удалось выполнить действие"), { code });
}
