export type DataMode = "live" | "demo" | "emulator";
export const DEMO_PROJECT_ID = "demo-afw-local";

export function selectDataMode(env: Record<string, string | undefined>): DataMode {
  if (env.VERCEL_ENV === "production") return "live";
  if (env.VERCEL || env.VERCEL_ENV) return "demo";
  return env.VITE_USE_EMULATORS === "true" ? "emulator" : "demo";
}

declare const __AFW_DATA_MODE__: DataMode;
export const dataMode =
  typeof __AFW_DATA_MODE__ === "undefined" ? "demo" : __AFW_DATA_MODE__;
