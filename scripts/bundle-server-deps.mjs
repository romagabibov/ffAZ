import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

// The production runtime can disable require(esm). Compile the parser into the
// same CommonJS bundle as sanitize-html while keeping the locked versions.
await build({
  entryPoints: [require.resolve("sanitize-html")],
  outfile: fileURLToPath(new URL("../src/server/generated/sanitize-html.cjs", import.meta.url)),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  legalComments: "eof",
});
