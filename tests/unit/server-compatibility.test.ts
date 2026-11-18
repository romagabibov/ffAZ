import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";

function runWithCommonJs(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", script, ...args], {
    encoding: "utf8",
  });
  expect(result.status, result.error?.message || result.stderr).toBe(0);
}

it("loads the server HTML sanitizer with require(esm) disabled", () => {
  const modulePath = fileURLToPath(new URL("../../src/server/generated/sanitize-html.cjs", import.meta.url));
  runWithCommonJs(`
    const assert = require("node:assert/strict");
    const sanitize = require(process.argv[1]);
    assert.equal(sanitize("<p>Fashion <em>Week</em></p>"), "<p>Fashion <em>Week</em></p>");
    assert.equal(sanitize("<div><p>Fashion Week</p></div>", { allowedTags: ["p"] }), "<p>Fashion Week</p>");
  `, modulePath);
});

it("loads Firebase Auth and reads a valid JWKS public key with require(esm) disabled", () => {
  runWithCommonJs(`
    const assert = require("node:assert/strict");
    const { generateKeyPairSync } = require("node:crypto");
    const { createRequire } = require("node:module");
    const { getAuth } = require("firebase-admin/auth");
    const { getAppCheck } = require("firebase-admin/app-check");
    const resolveFromFirebase = createRequire(require.resolve("firebase-admin/auth"));
    const { JwksClient } = resolveFromFirebase("jwks-rsa");
    assert.equal(typeof getAuth, "function");
    assert.equal(typeof getAppCheck, "function");
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const client = new JwksClient({ fetcher: async () => ({
      keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", use: "sig", alg: "RS256" }],
    }) });
    client.getSigningKey("fixture").then(key => {
      assert.equal(key.getPublicKey().trim(), publicKey.export({ type: "spki", format: "pem" }).trim());
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `);
});
