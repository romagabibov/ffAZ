import "dotenv/config";
import {
  cert,
  getApps,
  getApp,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { v2 as cloudinary } from "cloudinary";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import config from "../../firebase-applet-config.json" with { type: "json" };
import { createApp } from "./app.js";
import { DEMO_PROJECT_ID, selectDataMode } from "../lib/dataMode.js";
export function initializeRuntime(emulator = false) {
  let credential;
  if (emulator) {
    for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
      if (!/^(localhost|127\.0\.0\.1):[0-9]+$/.test(process.env[name] || ""))
        throw new Error(name + " must point to a local emulator");
    }
  } else if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Remove emulator settings from the live server");
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let parsed: any;
    try {
      parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON");
    }
    if (parsed.project_id !== config.projectId)
      throw new Error(
        "Service account belongs to a different Firebase project",
      );
    credential = cert(parsed);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS)
    credential = applicationDefault();
  else
    throw new Error(
      "Set FIREBASE_SERVICE_ACCOUNT_JSON in the Vercel environment; never put it in a VITE_ variable.",
    );
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({
        projectId: emulator ? DEMO_PROJECT_ID : config.projectId,
        ...(credential ? { credential } : {}),
      });
  const db = emulator ? getFirestore(adminApp) : getFirestore(adminApp, config.firestoreDatabaseId || "(default)");
  db.settings({ ignoreUndefinedProperties: true });
  cloudinary.config({
    cloud_name: emulator ? "" : process.env.CLOUDINARY_CLOUD_NAME,
    api_key: emulator ? "" : process.env.CLOUDINARY_API_KEY,
    api_secret: emulator ? "" : process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return { adminApp, db, auth: getAuth(adminApp), cloudinary };
}
let app: ReturnType<typeof createApp> | undefined;
export function runtimeApp() {
  if (!app) {
    const mode = selectDataMode(process.env);
    if (mode === "demo") {
      app = express();
      app.disable("x-powered-by");
      app.get("/api/health", (_req, res) => res.json({ ok: true, mode: "demo", firestore: false }));
      app.use("/api", (_req, res) => res.status(503).json({ error: "Firebase отключён в предпросмотре", code: "demo_mode" }));
      return app;
    }
    const runtime = initializeRuntime(mode === "emulator");
    let ai: GoogleGenAI | undefined;
    let releaseCheck: { expiresAt: number; promise: Promise<boolean> } | undefined;
    const firebaseReady = () => {
      if (releaseCheck && releaseCheck.expiresAt > Date.now()) return releaseCheck.promise;
      const check = {
        expiresAt: Date.now() + 30_000,
        promise: runtime.db.doc("_system/releaseReadyV3").get().then((snapshot) => {
          const state = snapshot.data();
          const ready = state?.version === 3 && state.project === config.projectId &&
            state.database === config.firestoreDatabaseId;
          if (ready) check.expiresAt = Date.now() + 10 * 60_000;
          return ready;
        }),
      };
      releaseCheck = check;
      return check.promise;
    };
    app = createApp({
      adminDb: runtime.db,
      adminAuth: runtime.auth,
      cloudinaryClient: cloudinary,
      firebaseReady: mode === "live" ? firebaseReady : undefined,
      getGemini: () =>
        mode === "live" && process.env.GEMINI_API_KEY
          ? (ai ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }))
          : null,
    });
  }
  return app;
}
