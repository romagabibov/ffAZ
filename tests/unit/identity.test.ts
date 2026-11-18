import { describe, expect, it } from "vitest";
import { createIdentityCipher, identityDeadlines, openIdentityFields, sealIdentityFields } from "../../src/server/identity";

describe("Identity retention and storage", () => {
  const oldKey = Buffer.alloc(32, 71).toString("base64");
  const newKey = Buffer.alloc(32, 82).toString("base64");

  it("uses new ciphertext for every write and supports controlled key rotation", () => {
    const original = createIdentityCipher(oldKey);
    const rotated = createIdentityCipher(newKey, oldKey);
    const path = "agency_applications/fixture";
    const fields = { applicantFirstName: "Fictional", agencyAddress: "Private fixture" };
    const first = sealIdentityFields(original, path, "fixture", fields);
    const second = sealIdentityFields(original, path, "fixture", fields);
    expect(first).not.toBe(second);
    expect(openIdentityFields(rotated, path, "fixture", first)).toEqual(fields);
    expect(() => openIdentityFields(rotated, path, "another-account", first)).toThrow();
    expect(() => openIdentityFields(createIdentityCipher(newKey), path, "fixture", first)).toThrow();
  });

  it("adds three calendar months, then six from the photo expiry", () => {
    const { photo, data } = identityDeadlines(Date.UTC(2026, 0, 31, 12));
    expect(photo.toMillis()).toBe(Date.UTC(2026, 3, 30, 12));
    expect(data.toMillis()).toBe(Date.UTC(2026, 9, 30, 12));
  });
});
