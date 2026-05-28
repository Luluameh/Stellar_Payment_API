import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const { mockQuery, mockIsRetryablePoolError, mockConsumeRateLimit, mockHashPayload, mockSignPayload, mockValidateAuditAction } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIsRetryablePoolError: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockHashPayload: vi.fn(),
  mockSignPayload: vi.fn(),
  mockValidateAuditAction: vi.fn(() => true),
}));

vi.mock("../lib/db.js", () => ({
  pool: { query: mockQuery },
  isRetryablePoolError: mockIsRetryablePoolError,
}));

vi.mock("../lib/audit-security.js", () => ({
  consumeAuditLogRateLimit: mockConsumeRateLimit,
  createAuditLogRateLimitKey: vi.fn(() => "merchant-1:update:127.0.0.1"),
  hashAuditPayload: mockHashPayload,
  sanitizeAuditKey: vi.fn((v) => v),
  sanitizeAuditValue: vi.fn((v) => v),
  signAuditPayload: mockSignPayload,
  validateAuditAction: mockValidateAuditAction,
}));

import { auditService, _resetSvcCircuitForTests } from "./auditService.js";

describe("auditService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockIsRetryablePoolError.mockReset();
    mockConsumeRateLimit.mockReset();
    mockHashPayload.mockReset();
    mockSignPayload.mockReset();
    mockValidateAuditAction.mockReset();
    mockValidateAuditAction.mockReturnValue(true);
    _resetSvcCircuitForTests();
  });

  it("writes signed audit records", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/payload_hash/);
    expect(sql).toMatch(/signature/);
    expect(params[7]).toBe("a".repeat(64));
    expect(params[8]).toBe("b".repeat(64));
  });

  it("drops events when the audit rate limit is exceeded", async () => {
    mockConsumeRateLimit.mockReturnValue({ allowed: false });
    mockIsRetryablePoolError.mockReturnValue(false);

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "email",
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("retries on transient errors", async () => {
    const transientError = new Error("connection terminated");
    mockIsRetryablePoolError.mockReturnValue(true);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));
    mockQuery
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ rows: [] });

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("falls back to file logging when DB fails permanently", async () => {
    const permanentError = new Error("relation does not exist");
    mockQuery.mockRejectedValue(permanentError);
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    await auditService.logEvent({
      merchantId: "merchant-1",
      action: "update",
      fieldChanged: "notification_email",
      oldValue: "old@example.com",
      newValue: "new@example.com",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(appendFileSyncSpy).toHaveBeenCalled();
    appendFileSyncSpy.mockRestore();
  });

  // ── SQL optimization: getAuditLogs (issue #770) ───────────────────────────

  it("fetches logs and count in a single window-function query", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, action: "update", field_changed: "email", old_value: "a@b.com", new_value: "c@d.com", ip_address: "1.2.3.4", user_agent: "ua", timestamp: new Date(), total_count: "3" },
        { id: 2, action: "login", field_changed: null, old_value: null, new_value: null, ip_address: "1.2.3.4", user_agent: "ua", timestamp: new Date(), total_count: "3" },
      ],
    });

    const result = await auditService.getAuditLogs("merchant-1", 1, 2);

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COUNT\(\*\) OVER\(\)/i);
    expect(result.total_count).toBe(3);
    expect(result.logs).toHaveLength(2);
    // Ensure the synthetic total_count column is stripped from returned rows
    expect(result.logs[0]).not.toHaveProperty("total_count");
  });

  it("returns zero total_count when no rows match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await auditService.getAuditLogs("merchant-nobody", 1, 10);
    expect(result.total_count).toBe(0);
    expect(result.logs).toHaveLength(0);
  });

  it("clamps page and limit to valid ranges", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await auditService.getAuditLogs("merchant-1", -5, 200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(100); // limit clamped to 100
    expect(params[2]).toBe(0);   // offset for page 1 = 0
    expect(result.page).toBe(1);
  });

  // ── Action validation (issue #772) ────────────────────────────────────────

  it("drops logEvent calls with disallowed action values", async () => {
    mockValidateAuditAction.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });

    await auditService.logEvent({ merchantId: "m", action: "DROP TABLE", fieldChanged: "x" });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── Circuit breaker: logEvent (issue #771) ─────────────────────────────────

  it("opens circuit breaker after repeated DB failures and routes to fallback", async () => {
    const permError = new Error("connection refused");
    mockQuery.mockRejectedValue(permError);
    mockIsRetryablePoolError.mockReturnValue(false);
    mockConsumeRateLimit.mockReturnValue({ allowed: true });
    mockHashPayload.mockReturnValue("a".repeat(64));
    mockSignPayload.mockReturnValue("b".repeat(64));

    const appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});

    for (let i = 0; i < 6; i += 1) {
      await auditService.logEvent({ merchantId: `m-${i}`, action: "update", fieldChanged: "email" });
    }

    const callsBeforeOpen = mockQuery.mock.calls.length;
    await auditService.logEvent({ merchantId: "m-open", action: "update", fieldChanged: "email" });
    expect(mockQuery.mock.calls.length).toBe(callsBeforeOpen);
    expect(appendFileSyncSpy).toHaveBeenCalled();

    appendFileSyncSpy.mockRestore();
  });
});