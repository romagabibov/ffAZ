// Local development and standalone Node hosting. Vercel uses api/index.ts.
import express from "express";
import path from "node:path";
import { runtimeApp } from "./src/server/runtime";
const app = runtimeApp();
if (process.env.NODE_ENV !== "production") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve("dist")));
  app.get("*", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
}
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const port = Number(option("--port") || process.env.PORT || 3000),
  host = option("--host") || "0.0.0.0";
app.listen(port, host, () => console.log(`Local server listening on ${port}`));
