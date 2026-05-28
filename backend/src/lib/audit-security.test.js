import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
  hashAuditPayload,
  resetAuditRateLimitStateForTests,
  sanitizeAuditKey,
  sanitizeAuditValue,
  signAuditPayload,
  validateAuditAction,
  verifyAuditSignature,
} from "./audit-security.js";

describe("audit-security", () => {
  beforeEach(() => {
    resetAuditRateLimitStateForTests();
  });

  it("sanitizes object values into deterministic strings", () => {
    const value = sanitizeAuditValue({ b: 2, a: 1 });
    expect(value).toBe('{"a":1,"b":2}');
  });

  it("redacts sensitive audit field names", () => {
    expect(sanitizeAuditKey("api_key")).toBe("[REDACTED]");
    expect(sanitizeAuditKey("notification_email")).toBe("notification_email");
  });

  it("produces deterministic payload hashes", () => {
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    expect(hashAuditPayload(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAuditPayload(payload)).toBe(hashAuditPayload(payload));
  });

  it("creates an HMAC signature when secret is provided", () => {
    const payload = { merchant_id: "m1", action: "update" };
    const signature = signAuditPayload(payload, "audit-secret");

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns null signature when no secret is provided", () => {
    const payload = { merchant_id: "m1", action: "login" };
    const sig = signAuditPayload(payload, undefined);
    expect(sig).toBeNull();
  });

  // ── verifyAuditSignature (issue #769) ──────────────────────────────────────

  it("verifies a valid HMAC signature", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    const signature = signAuditPayload(payload, secret);
    expect(verifyAuditSignature(payload, signature, secret)).toBe(true);
  });

  it("rejects a tampered payload signature", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login", status: "success" };
    const signature = signAuditPayload(payload, secret);
    const tampered = { ...payload, status: "failure" };
    expect(verifyAuditSignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects a tampered signature string", () => {
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login" };
    const signature = signAuditPayload(payload, secret);
    const bad = signature.replace(/.$/, signature.endsWith("a") ? "b" : "a");
    expect(verifyAuditSignature(payload, bad, secret)).toBe(false);
  });

  it("returns false when signature is null", () => {
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, null, "secret")).toBe(false);
  });

  it("returns false when secret is not provided", () => {
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, "a".repeat(64))).toBe(false);
  });

  it("is resistant to length-extension by using timingSafeEqual", () => {
    // Signatures of different length must not throw; they return false
    const secret = "test-secret";
    const payload = { merchant_id: "m1", action: "login" };
    expect(verifyAuditSignature(payload, "short", secret)).toBe(false);
  });

  // ── validateAuditAction (issue #772) ──────────────────────────────────────

  it("accepts known allowed action values", () => {
    expect(validateAuditAction("login")).toBe(true);
    expect(validateAuditAction("update")).toBe(true);
    expect(validateAuditAction("payment_initiated")).toBe(true);
  });

  it("rejects unknown action values", () => {
    expect(validateAuditAction("DROP TABLE audit_logs")).toBe(false);
    expect(validateAuditAction("arbitrary_action")).toBe(false);
    expect(validateAuditAction("")).toBe(false);
  });

  it("is case-insensitive for action validation", () => {
    expect(validateAuditAction("LOGIN")).toBe(true);
    expect(validateAuditAction("Update")).toBe(true);
  });

  it("rejects null and undefined actions", () => {
    expect(validateAuditAction(null)).toBe(false);
    expect(validateAuditAction(undefined)).toBe(false);
  });

  it("enforces per-key rate limiting in a fixed window", () => {
    const key = createAuditLogRateLimitKey({
      merchantId: "m1",
      action: "login",
      ipAddress: "127.0.0.1",
    });

    const first = consumeAuditLogRateLimit(key, {
      now: 1000,
      max: 2,
      windowMs: 60_000,
    });
    const second = consumeAuditLogRateLimit(key, {
      now: 1001,
      max: 2,
      windowMs: 60_000,
    });
    const third = consumeAuditLogRateLimit(key, {
      now: 1002,
      max: 2,
      windowMs: 60_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});
