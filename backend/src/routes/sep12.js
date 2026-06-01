/**
 * SEP-12 KYC routes.
 *
 *   GET    /sep12/customer            — fetch a customer's KYC status
 *   PUT    /sep12/customer            — create/update KYC (signature-gated)
 *   DELETE /sep12/customer/:account   — delete a customer's KYC record
 *
 * All KYC business logic lives in lib/sep12-kyc.js; this layer only maps
 * HTTP <-> service calls and translates KycError into responses (#592).
 */

import express from "express";
import {
  putCustomer,
  getCustomer,
  deleteCustomer,
  KycError,
} from "../lib/sep12-kyc.js";
import { logger } from "../lib/logger.js";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";

export const SEP12_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const SEP12_RATE_LIMIT_MAX = 50;

export function buildSep12RateLimitKey(req) {
  const rawAccount =
    req.query?.account ?? req.body?.account ?? req.params?.account ?? "unknown";
  const account = Array.isArray(rawAccount) ? rawAccount[0] : String(rawAccount);
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown-ip");
  return `sep12:${account}:${ip}`;
}

export function createSep12RateLimit({
  windowMs = SEP12_RATE_LIMIT_WINDOW_MS,
  max = SEP12_RATE_LIMIT_MAX,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs,
    max,
    keyGenerator: buildSep12RateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    passOnStoreError: true,
    handler: (_req, res) => {
      res.status(429).json({
        error: "TOO_MANY_REQUESTS",
        message: "Too many KYC requests, please try again later",
      });
    },
  });
}

const sep12RateLimit = createSep12RateLimit();

function handleError(err, res) {
  if (err instanceof KycError) {
    const body = { error: err.code, message: err.message };
    if (err.retryable) body.retryable = true;
    res.status(err.httpStatus).json(body);
    return;
  }
  // Never leak internals; field values are not logged (#593).
  logger.error({ err: err.message }, "sep12 unexpected error");
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error" });
}

export default function createSep12Router() {
  const router = express.Router();

  // Apply rate limiting to all SEP-12 routes (Issue #742 & #741: Security audit)
  router.use(sep12RateLimit);

  router.get("/sep12/customer", async (req, res) => {
    try {
      const data = await getCustomer({
        account: req.query.account,
        memo: req.query.memo ?? "",
      });
      res.json({
        id: data.id,
        account: data.account,
        status: data.status,
        fields: data.fields,
        provided_fields: Object.keys(data.fields || {}),
      });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put("/sep12/customer", async (req, res) => {
    try {
      const { account, memo, timestamp, signature, fields } = req.body ?? {};
      const result = await putCustomer({
        account,
        memo: memo ?? "",
        timestamp,
        signature,
        fields,
      });
      res.status(202).json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete("/sep12/customer/:account", async (req, res) => {
    try {
      const result = await deleteCustomer({
        account: req.params.account,
        memo: req.query.memo ?? "",
      });
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
