import { describe, expect, it } from "vitest";
import {
  signApiGatewayRequest,
  verifyApiGatewayRequestSignature,
} from "./api-gateway-signature.js";

// All secrets must be >= 16 characters (MIN_SECRET_LENGTH enforcement, issue #767)
const VALID_SECRET = "test-api-key-secure-32chars-padded";

describe("api-gateway-signature", () => {
  it("signs and verifies request payloads", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestamp,
      body: { amount: 12.5, asset: "USDC" },
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: { amount: 12.5, asset: "USDC" },
      now: timestamp * 1000,
    });

    expect(result).toEqual({ valid: true });
  });

  it("rejects signatures outside timestamp tolerance", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "GET",
      path: "/api/metrics/summary",
      timestamp,
      body: {},
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/api/metrics/summary",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: {},
      now: (timestamp + 900) * 1000,
      toleranceSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the accepted window/i);
  });

  it("rejects malformed signature headers", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "not-a-signature",
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid x-api-signature/i);
  });

  // ── Security audit: minimum secret length (#767) ──────────────────────────

  it("rejects signing with a secret shorter than the minimum length", () => {
    const result = signApiGatewayRequest({
      secret: "short",
      method: "GET",
      path: "/health",
      timestamp: 1713916800,
      body: {},
    });

    expect(result).toBeNull();
  });

  it("rejects verification with a secret shorter than the minimum length", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: "tooshort",
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/insufficient.*secret/i);
  });

  it("rejects verification with a missing secret", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: "",
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/insufficient.*secret/i);
  });

  it("detects a tampered body by producing a different signature", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestamp,
      body: { amount: 10 },
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: { amount: 99 }, // tampered
      now: timestamp * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/verification failed/i);
  });
});
