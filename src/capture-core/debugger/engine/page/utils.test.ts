import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeCapturedBody } from "./utils";

const SECRET = "synthetic-password-should-never-escape";

describe("sanitizeCapturedBody", () => {
  it("redacts JSON credentials before trimming the capture", () => {
    const body = `${JSON.stringify({ padding: "x".repeat(4_000), password: SECRET })}`;

    const sanitized = sanitizeCapturedBody(body, "application/json");

    expect(sanitized).toBeDefined();
    expect(sanitized).not.toContain(SECRET);
  });

  it("fails closed for oversized malformed JSON", () => {
    const body = `{"padding":"${"x".repeat(4_000)}","password":"${SECRET}`;

    expect(sanitizeCapturedBody(body, "application/json")).toBeUndefined();
  });

  it("never retains a sensitive field value in valid JSON", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (secret) => {
        const sanitized = sanitizeCapturedBody(
          JSON.stringify({ password: secret, nested: { token: secret } }),
          "application/json"
        );
        expect(JSON.parse(sanitized ?? "{}")).toMatchObject({
          password: "[REDACTED]",
          nested: { token: "[REDACTED]" },
        });
      })
    );
  });
});
