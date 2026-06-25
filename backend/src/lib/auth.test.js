import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKeyAuth } from "./auth.js";

function createResponse() {
  return {
    status: vi.fn(),
    json: vi.fn()
  };
}

function createRequest(headers = {}) {
  return {
    get(name) {
      return headers[name.toLowerCase()];
    },
    path: "/api/test",
    method: "POST",
    ip: "127.0.0.1"
  };
}

describe("createApiKeyAuth", () => {
  let maybeSingle;
  let eq;
  let select;
  let from;
  let supabaseClient;
  let middleware;
  let res;
  let next;

  beforeEach(() => {
    maybeSingle = vi.fn();
    eq = vi.fn(() => ({ maybeSingle }));
    select = vi.fn(() => ({ eq }));
    from = vi.fn(() => ({ select }));
    supabaseClient = { from };
    middleware = createApiKeyAuth({ supabaseClient });
    res = createResponse();
    res.status.mockReturnValue(res);
    next = vi.fn();
  });

  it("rejects requests without an x-api-key header", async () => {
    const req = createRequest();

    await middleware(req, res, next);

    expect(from).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing x-api-key header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid API key format", async () => {
    const req = createRequest({ "x-api-key": "invalid-key" });

    await middleware(req, res, next);

    // Should reject before querying database due to format validation
    expect(from).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key format" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects requests with a properly formatted but unknown API key", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    // Use properly formatted API key: sk_ + 48 hex chars
    const validFormatKey = "sk_" + "a".repeat(48);
    const req = createRequest({ "x-api-key": validFormatKey });

    await middleware(req, res, next);

    expect(from).toHaveBeenCalledWith("merchants");
    expect(select).toHaveBeenCalledWith("id, email, business_name, notification_email, api_key_rotated_at");
    expect(eq).toHaveBeenCalledWith("api_key", validFormatKey);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the authenticated merchant to the request", async () => {
    const merchant = {
      id: "merchant-123",
      email: "merchant@example.com",
      business_name: "Merchant Co",
      notification_email: "ops@example.com"
    };
    maybeSingle.mockResolvedValue({ data: merchant, error: null });
    // Use properly formatted API key: sk_ + 48 hex chars
    const validFormatKey = "sk_" + "0123456789abcdef".repeat(3); // 48 hex chars
    const req = createRequest({ "x-api-key": `  ${validFormatKey}  ` }); // Test trimming

    await middleware(req, res, next);

    expect(eq).toHaveBeenCalledWith("api_key", validFormatKey);
    expect(req.merchant).toEqual(merchant);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards Supabase lookup failures to the error handler", async () => {
    const error = new Error("Supabase unavailable");
    maybeSingle.mockResolvedValue({ data: null, error });
    // Use properly formatted API key: sk_ + 48 hex chars
    const validFormatKey = "sk_" + "b".repeat(48);
    const req = createRequest({ "x-api-key": validFormatKey });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
