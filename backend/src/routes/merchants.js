import express from "express";
import { randomBytes } from "crypto";
import { supabase } from "../lib/supabase.js";
import { logSecurityEvent, validateApiKeyFormat } from "../lib/security.js";

const router = express.Router();

const REQUIRED_FIELDS = ["email"];

// Enhanced email regex with stricter validation
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const BUSINESS_NAME_MAX_LENGTH = 255;

function validateRegisterMerchant(body) {
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) {
      return `Missing field: ${field}`;
    }
  }

  // Validate email format (RFC 5322 compliant)
  if (!EMAIL_REGEX.test(body.email)) {
    return "Invalid email format";
  }

  // Ensure email is not too long
  if (body.email.length > 254) {
    return "Email address is too long";
  }

  // Validate notification_email if provided
  if (body.notification_email) {
    if (!EMAIL_REGEX.test(body.notification_email)) {
      return "Invalid notification_email format";
    }
    if (body.notification_email.length > 254) {
      return "Notification email address is too long";
    }
  }

  // Validate business_name if provided
  if (body.business_name) {
    if (typeof body.business_name !== "string") {
      return "business_name must be a string";
    }
    if (body.business_name.length > BUSINESS_NAME_MAX_LENGTH) {
      return `business_name must be less than ${BUSINESS_NAME_MAX_LENGTH} characters`;
    }
    if (body.business_name.trim().length === 0) {
      return "business_name cannot be empty";
    }
  }

  return null;
}

/**
 * @swagger
 * /api/register-merchant:
 *   post:
 *     summary: Register a new merchant
 *     tags: [Merchants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               business_name:
 *                 type: string
 *               notification_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       201:
 *         description: Merchant registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 merchant:
 *                   type: object
 *       400:
 *         description: Validation error
 *       409:
 *         description: Merchant already exists
 */
router.post("/register-merchant", async (req, res, next) => {
  try {
    const error = validateRegisterMerchant(req.body || {});
    if (error) {
      logSecurityEvent("REGISTRATION_VALIDATION_FAILED", {
        error,
        email: req.body?.email,
      });
      return res.status(400).json({ error });
    }

    const { email } = req.body;
    const business_name = req.body.business_name ? req.body.business_name.trim() : email.split("@")[0];
    const notification_email = req.body.notification_email ? req.body.notification_email.trim() : email;

    // Check if merchant already exists
    const { data: existing, error: checkError } = await supabase
      .from("merchants")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (checkError) {
      logSecurityEvent("DATABASE_ERROR_CHECK_EXISTING", {
        error: checkError.message,
        email,
      });
      throw { status: 500, message: "An error occurred during registration" };
    }

    if (existing) {
      logSecurityEvent("DUPLICATE_REGISTRATION_ATTEMPT", { email });
      return res.status(409).json({ error: "Merchant with this email already exists" });
    }

    // Generate secure credentials (48 hex chars = 192 bits of entropy)
    const apiKey = `sk_${randomBytes(24).toString("hex")}`;
    const webhookSecret = `whsec_${randomBytes(24).toString("hex")}`;

    const payload = {
      email: email.toLowerCase(),
      business_name,
      notification_email: notification_email.toLowerCase(),
      api_key: apiKey,
      webhook_secret: webhookSecret,
      created_at: new Date().toISOString()
    };

    const { data: merchant, error: insertError } = await supabase
      .from("merchants")
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      logSecurityEvent("REGISTRATION_INSERT_FAILED", {
        error: insertError.message,
        email,
      });
      throw { status: 500, message: "An error occurred during registration" };
    }

    logSecurityEvent("MERCHANT_REGISTERED", {
      merchantId: merchant.id,
      email: merchant.email,
    });

    res.status(201).json({
      message: "Merchant registered successfully",
      merchant: {
        id: merchant.id,
        email: merchant.email,
        business_name: merchant.business_name,
        notification_email: merchant.notification_email,
        api_key: merchant.api_key,
        webhook_secret: merchant.webhook_secret,
        created_at: merchant.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/rotate-key:
 *   post:
 *     summary: Rotate the authenticated merchant's API key
 *     tags: [Merchants]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: New API key issued; the old key is immediately invalidated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 api_key:
 *                   type: string
 *       401:
 *         description: Missing or invalid x-api-key header
 */
router.post("/rotate-key", async (req, res, next) => {
  try {
    // Verify merchant is authenticated (already done by middleware)
    if (!req.merchant || !req.merchant.id) {
      logSecurityEvent("ROTATE_KEY_UNAUTHORIZED");
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Generate new API key with high entropy
    const newApiKey = `sk_${randomBytes(24).toString("hex")}`;

    const { error } = await supabase
      .from("merchants")
      .update({
        api_key: newApiKey,
        api_key_rotated_at: new Date().toISOString()
      })
      .eq("id", req.merchant.id);

    if (error) {
      logSecurityEvent("ROTATE_KEY_FAILED", {
        merchantId: req.merchant.id,
        error: error.message,
      });
      throw { status: 500, message: "An error occurred during key rotation" };
    }

    logSecurityEvent("API_KEY_ROTATED", {
      merchantId: req.merchant.id,
    });

    res.json({ api_key: newApiKey });
  } catch (err) {
    next(err);
  }
});

export default router;
