import { build } from "vite";

await build();
if (process.env.AFW_PREPARE_FIREBASE === "1") {
  if (process.env.VERCEL_ENV === "production") {
    await import("./prepare-deploy");
  } else {
    console.log("Firebase preparation is disabled outside Vercel Production.");
  }
}
