import 'dotenv/config';
import express from "express";
import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { findMatchingPayment } from "../lib/stellar.js";
import { sendWebhook } from "../lib/webhooks.js";
import { validateUuidParam } from "../lib/validate-uuid.js";
import {
  validateStellarAddress,
  validateAssetCode,
  validateWebhookUrl,
  logSecurityEvent,
} from "../lib/security.js";

const router = express.Router();

const REQUIRED_FIELDS = ["amount", "asset", "recipient"];
const VALID_MEMO_TYPES = ["text", "id", "hash", "return"];
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_MEMO_LENGTH = 28;
const MAX_METADATA_SIZE = 4096; // 4KB
const MIN_AMOUNT = 0.0000001;
const MAX_AMOUNT = 922337203685.4775; // max for Stellar

function validateCreatePayment(body) {
  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null) {
      return `Missing field: ${field}`;
    }
  }

  // Validate amount
  const amount = Number(body.amount);
  if (Number.isNaN(amount)) {
    return "Amount must be a valid number";
  }
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return `Amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT}`;
  }

  // Validate asset code
  const asset = String(body.asset || "").toUpperCase();
  if (!validateAssetCode(asset)) {
    return "Invalid asset code format";
  }

  // Validate asset issuer for non-native assets
  if (asset !== "XLM") {
    if (!body.asset_issuer) {
      return "asset_issuer is required for non-native assets";
    }
    if (!validateStellarAddress(body.asset_issuer)) {
      return "Invalid asset_issuer Stellar address format";
    }
  }

  // Validate recipient
  if (!validateStellarAddress(body.recipient)) {
    return "Invalid recipient Stellar address format";
  }

  // Validate description if provided
  if (body.description) {
    if (typeof body.description !== "string") {
      return "description must be a string";
    }
    if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      return `description must be less than ${MAX_DESCRIPTION_LENGTH} characters`;
    }
  }

  // Validate memo and memo_type
  if (body.memo || body.memo_type) {
    if (!body.memo || !body.memo_type) {
      return "Both memo and memo_type are required together";
    }

    if (typeof body.memo !== "string") {
      return "memo must be a string";
    }

    const memoTypeLower = body.memo_type.toLowerCase();
    if (!VALID_MEMO_TYPES.includes(memoTypeLower)) {
      return `Invalid memo_type. Must be one of: ${VALID_MEMO_TYPES.join(", ")}`;
    }

    if (body.memo.length > MAX_MEMO_LENGTH) {
      return `memo must be less than ${MAX_MEMO_LENGTH} characters`;
    }

    // Validate memo type specific constraints
    if (memoTypeLower === "id") {
      if (!/^\d+$/.test(body.memo)) {
        return "memo for memo_type 'id' must contain only digits";
      }
      const memoNum = BigInt(body.memo);
      if (memoNum < 0n || memoNum > 9223372036854775807n) {
        return "memo for memo_type 'id' must fit in a 64-bit unsigned integer";
      }
    }
  }

  // Validate webhook_url if provided
  if (body.webhook_url) {
    if (typeof body.webhook_url !== "string") {
      return "webhook_url must be a string";
    }
    if (!validateWebhookUrl(body.webhook_url)) {
      return "Invalid webhook_url format or blocked address";
    }
  }

  // Validate metadata if provided
  if (body.metadata) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return "metadata must be a JSON object";
    }
    const metadataStr = JSON.stringify(body.metadata);
    if (metadataStr.length > MAX_METADATA_SIZE) {
      return `metadata must be less than ${MAX_METADATA_SIZE} bytes`;
    }
  }

  return null;
}

/**
 * @swagger
 * /api/create-payment:
 *   post:
 *     summary: Create a new payment request
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, asset, recipient]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Payment amount (must be positive)
 *               asset:
 *                 type: string
 *                 description: Asset code (e.g. XLM, USDC)
 *               asset_issuer:
 *                 type: string
 *                 description: Asset issuer (required for non-native assets)
 *               recipient:
 *                 type: string
 *                 description: Stellar address of the recipient
 *               description:
 *                 type: string
 *               memo:
 *                 type: string
 *               memo_type:
 *                 type: string
 *                 enum: [text, id, hash, return]
 *               webhook_url:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Payment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment_id:
 *                   type: string
 *                 payment_link:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Validation error
 */
router.post("/create-payment", async (req, res, next) => {
  try {
    const validationError = validateCreatePayment(req.body || {});
    if (validationError) {
      logSecurityEvent("PAYMENT_VALIDATION_FAILED", {
        merchantId: req.merchant?.id,
        error: validationError,
      });
      return res.status(400).json({ error: validationError });
    }

    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const paymentLinkBase = process.env.PAYMENT_LINK_BASE || "http://localhost:3000";
    const paymentLink = `${paymentLinkBase}/pay/${paymentId}`;

    const asset = String(req.body.asset || "").toUpperCase();
    const assetIssuer = req.body.asset_issuer ? String(req.body.asset_issuer).trim() : null;

    const payload = {
      id: paymentId,
      merchant_id: req.merchant.id,
      amount: Number(req.body.amount),
      asset,
      asset_issuer: assetIssuer,
      recipient: String(req.body.recipient).trim(),
      description: req.body.description ? String(req.body.description).trim() : null,
      memo: req.body.memo ? String(req.body.memo).trim() : null,
      memo_type: req.body.memo_type ? req.body.memo_type.toLowerCase() : null,
      webhook_url: req.body.webhook_url ? String(req.body.webhook_url).trim() : null,
      status: "pending",
      tx_id: null,
      metadata: req.body.metadata || null,
      created_at: now
    };

    const { error: insertError } = await supabase
      .from("payments")
      .insert(payload);

    if (insertError) {
      logSecurityEvent("PAYMENT_INSERT_FAILED", {
        merchantId: req.merchant.id,
        error: insertError.message,
      });
      throw { status: 500, message: "An error occurred while creating the payment" };
    }

    logSecurityEvent("PAYMENT_CREATED", {
      merchantId: req.merchant.id,
      paymentId,
      amount: req.body.amount,
      asset,
    });

    res.status(201).json({
      payment_id: paymentId,
      payment_link: paymentLink,
      status: "pending"
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/payment-status/{id}:
 *   get:
 *     summary: Get the status of a payment
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.get("/payment-status/:id", validateUuidParam(), async (req, res, next) => {
  try {
    const paymentId = String(req.params.id).trim();

    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at"
      )
      .eq("id", paymentId)
      .maybeSingle();

    if (error) {
      logSecurityEvent("PAYMENT_STATUS_ERROR", {
        paymentId,
        error: error.message,
      });
      throw { status: 500, message: "An error occurred while fetching payment status" };
    }

    if (!data) {
      logSecurityEvent("PAYMENT_NOT_FOUND", { paymentId });
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({ payment: data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/verify-payment/{id}:
 *   post:
 *     summary: Verify a payment on the Stellar network
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, confirmed]
 *                 tx_id:
 *                   type: string
 *                 webhook:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.post("/verify-payment/:id", validateUuidParam(), async (req, res, next) => {
  try {
    const paymentId = String(req.params.id).trim();

    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret)"
      )
      .eq("id", paymentId)
      .maybeSingle();

    if (error) {
      logSecurityEvent("PAYMENT_VERIFY_ERROR", {
        paymentId,
        error: error.message,
      });
      throw { status: 500, message: "An error occurred while verifying payment" };
    }

    if (!data) {
      logSecurityEvent("PAYMENT_VERIFY_NOT_FOUND", { paymentId });
      return res.status(404).json({ error: "Payment not found" });
    }

    if (data.status === "confirmed") {
      return res.json({ 
        status: "confirmed", 
        tx_id: data.tx_id,
        ledger_url: `https://stellar.expert/explorer/testnet/tx/${data.tx_id}`
      });
    }

    const match = await findMatchingPayment({
      recipient: data.recipient,
      amount: data.amount,
      assetCode: data.asset,
      assetIssuer: data.asset_issuer,
      memo: data.memo,
      memoType: data.memo_type
    });

    if (!match) {
      return res.json({ status: "pending" });
    }

    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "confirmed", tx_id: match.transaction_hash })
      .eq("id", data.id);

    if (updateError) {
      logSecurityEvent("PAYMENT_CONFIRM_ERROR", {
        paymentId,
        error: updateError.message,
      });
      throw { status: 500, message: "An error occurred while confirming payment" };
    }

    const merchantSecret = data.merchants?.webhook_secret;

    const webhookResult = await sendWebhook(data.webhook_url, {
      event: "payment.confirmed",
      payment_id: data.id,
      amount: data.amount,
      asset: data.asset,
      asset_issuer: data.asset_issuer,
      recipient: data.recipient,
      tx_id: match.transaction_hash
    }, merchantSecret);

    if (!webhookResult.ok && !webhookResult.skipped) {
      console.warn("[WEBHOOK] Delivery failed:", {
        paymentId: data.id,
        webhookUrl: data.webhook_url,
        status: webhookResult.status,
      });
    }

    logSecurityEvent("PAYMENT_VERIFIED", {
      paymentId,
      txId: match.transaction_hash,
    });

    res.json({
      status: "confirmed",
      tx_id: match.transaction_hash,
      ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
      webhook: webhookResult
    });
  } catch (err) {
    next(err);
  }
});

export default router;

/**
 * @swagger
 * /api/create-payment:
 *   post:
 *     summary: Create a new payment request
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, asset, recipient]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Payment amount (must be positive)
 *               asset:
 *                 type: string
 *                 description: Asset code (e.g. XLM, USDC)
 *               asset_issuer:
 *                 type: string
 *                 description: Asset issuer (required for non-native assets)
 *               recipient:
 *                 type: string
 *                 description: Stellar address of the recipient
 *               merchant_id:
 *                 type: string
 *               description:
 *                 type: string
 *               memo:
 *                 type: string
 *               memo_type:
 *                 type: string
 *                 enum: [text, id, hash, return]
 *               webhook_url:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment_id:
 *                   type: string
 *                 payment_link:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Validation error
 */
router.post("/create-payment", async (req, res, next) => {
  try {
    const error = validateCreatePayment(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const paymentLinkBase = process.env.PAYMENT_LINK_BASE || "http://localhost:3000";
    const paymentLink = `${paymentLinkBase}/pay/${paymentId}`;

    const asset = String(req.body.asset || "").toUpperCase();
    const assetIssuer = req.body.asset_issuer || null;

    const payload = {
      id: paymentId,
      merchant_id: req.merchant.id,
      amount: Number(req.body.amount),
      asset,
      asset_issuer: assetIssuer,
      recipient: req.body.recipient,
      description: req.body.description || null,
      memo: req.body.memo || null,
      memo_type: req.body.memo_type ? req.body.memo_type.toLowerCase() : null,
      webhook_url: req.body.webhook_url || null,
      status: "pending",
      tx_id: null,
      metadata: req.body.metadata || null,
      created_at: now
    };

    const { error: insertError } = await supabase
      .from("payments")
      .insert(payload);

    if (insertError) {
      insertError.status = 500;
      throw insertError;
    }

    res.status(201).json({
      payment_id: paymentId,
      payment_link: paymentLink,
      status: "pending"
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/payment-status/{id}:
 *   get:
 *     summary: Get the status of a payment
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 payment:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.get("/payment-status/:id", validateUuidParam(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, description, memo, memo_type, status, tx_id, metadata, created_at"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json({ payment: data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/verify-payment/{id}:
 *   post:
 *     summary: Verify a payment on the Stellar network
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, confirmed]
 *                 tx_id:
 *                   type: string
 *                 webhook:
 *                   type: object
 *       404:
 *         description: Payment not found
 */
router.post("/verify-payment/:id", verifyPaymentRateLimit, validateUuidParam(), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, asset, asset_issuer, recipient, status, tx_id, memo, memo_type, webhook_url, merchants(webhook_secret)"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (data.status === "confirmed") {
      return res.json({ 
        status: "confirmed", 
        tx_id: data.tx_id,
        ledger_url: `https://stellar.expert/explorer/testnet/tx/${data.tx_id}`
      });
    }

    const match = await findMatchingPayment({
      recipient: data.recipient,
      amount: data.amount,
      assetCode: data.asset,
      assetIssuer: data.asset_issuer,
      memo: data.memo,
      memoType: data.memo_type
    });

    if (!match) {
      return res.json({ status: "pending" });
    }

    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "confirmed", tx_id: match.transaction_hash })
      .eq("id", data.id);

    if (updateError) {
      updateError.status = 500;
      throw updateError;
    }

    const merchantSecret = data.merchants?.webhook_secret;

    const webhookResult = await sendWebhook(data.webhook_url, {
      event: "payment.confirmed",
      payment_id: data.id,
      amount: data.amount,
      asset: data.asset,
      asset_issuer: data.asset_issuer,
      recipient: data.recipient,
      tx_id: match.transaction_hash
    }, merchantSecret);

    if (!webhookResult.ok && !webhookResult.skipped) {
      console.warn("Webhook failed", webhookResult);
    }

    res.json({
      status: "confirmed",
      tx_id: match.transaction_hash,
      ledger_url: `https://stellar.expert/explorer/testnet/tx/${match.transaction_hash}`,
      webhook: webhookResult
    });
  } catch (err) {
    next(err);
  }
});

export default router;
