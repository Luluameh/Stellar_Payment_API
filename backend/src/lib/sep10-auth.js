import jwt from "jsonwebtoken";
import * as StellarSdk from "stellar-sdk";
import { randomBytes } from "node:crypto";

const DEFAULT_HOME_DOMAIN = "localhost";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const CHALLENGE_EXPIRES_IN = 300;
const NONCE_CLEANUP_INTERVAL = 600_000;
const MAX_NONCE_CACHE = 10_000;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for SEP-10 authentication");
  }
  return secret;
}

const _usedNonces = new Set();
let _nonceCleanupTimer = null;

function startNonceCleanup() {
  if (_nonceCleanupTimer) return;
  _nonceCleanupTimer = setInterval(() => {
    if (_usedNonces.size > MAX_NONCE_CACHE) {
      _usedNonces.clear();
    }
  }, NONCE_CLEANUP_INTERVAL);
  if (_nonceCleanupTimer.unref) _nonceCleanupTimer.unref();
}

function isNonceReused(nonce) {
  if (_usedNonces.has(nonce)) return true;
  _usedNonces.add(nonce);
  if (_usedNonces.size === 1) startNonceCleanup();
  return false;
}

export function _resetNonceCacheForTests() {
  _usedNonces.clear();
  if (_nonceCleanupTimer) {
    clearInterval(_nonceCleanupTimer);
    _nonceCleanupTimer = null;
  }
}

function getServerSigningKey() {
  return process.env.SEP10_SERVER_SIGNING_KEY;
}

export function generateChallenge(clientAccountId, homeDomain = DEFAULT_HOME_DOMAIN) {
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    throw new Error("SEP-0010 server signing key not configured");
  }

  try {
    StellarSdk.Keypair.fromPublicKey(clientAccountId);
  } catch {
    throw new Error("Invalid client Stellar account");
  }

  const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
  const nonce = randomBytes(32).toString("base64");

  const now = Math.floor(Date.now() / 1000);
  const minTime = now.toString();
  const maxTime = (now + CHALLENGE_EXPIRES_IN).toString();

  const account = new StellarSdk.Account(serverKeypair.publicKey(), "-1");

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime,
      maxTime,
    },
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: `${homeDomain} auth`,
        value: nonce,
        source: clientAccountId,
      }),
    )
    .build();

  transaction.sign(serverKeypair);

  return transaction.toXDR();
}

/**
 * Verify a signed SEP-0010 challenge transaction
 * @param {string} challengeXdr - Base64-encoded signed transaction XDR
 * @param {string} clientAccountId - Expected client account ID
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyChallenge(challengeXdr, clientAccountId, homeDomain = DEFAULT_HOME_DOMAIN) {
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    return { valid: false, error: "SEP-0010 not configured" };
  }

  try {
    StellarSdk.Keypair.fromPublicKey(clientAccountId);
  } catch {
    return { valid: false, error: "Invalid client account" };
  }

  try {
    const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
    const transaction = new StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      NETWORK_PASSPHRASE,
    );

    if (transaction.operations.length !== 1) {
      return { valid: false, error: "Invalid challenge structure" };
    }

    const operation = transaction.operations[0];
    if (operation.type !== "manageData") {
      return { valid: false, error: "Invalid operation type" };
    }

    if (operation.source !== clientAccountId) {
      return { valid: false, error: "Client account mismatch" };
    }

    const expectedName = `${homeDomain} auth`;
    if (operation.name !== expectedName) {
      return { valid: false, error: "Challenge data name mismatch" };
    }

    const valueStr = typeof operation.value === "string" ? operation.value : operation.value?.toString();
    if (typeof valueStr !== "string" || valueStr.length < 16) {
      return { valid: false, error: "Invalid challenge nonce" };
    }

    if (isNonceReused(valueStr)) {
      return { valid: false, error: "Challenge nonce already used" };
    }

    const now = Math.floor(Date.now() / 1000);
    const { minTime, maxTime } = transaction.timeBounds;

    if (now < parseInt(minTime, 10) || now > parseInt(maxTime, 10)) {
      return { valid: false, error: "Challenge expired" };
    }

    const txHash = transaction.hash();

    const serverKeypairForVerify = StellarSdk.Keypair.fromSecret(
      serverSigningKey,
    );
    const serverSigned = transaction.signatures.some((sig) => {
      try {
        return serverKeypairForVerify.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!serverSigned) {
      return { valid: false, error: "Server signature missing" };
    }

    const clientKeypair = StellarSdk.Keypair.fromPublicKey(clientAccountId);
    const clientSigned = transaction.signatures.some((sig) => {
      try {
        return clientKeypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!clientSigned) {
      return { valid: false, error: "Client signature missing or invalid" };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: "Authentication failed" };
  }
}

/**
 * Generate a JWT session token for authenticated merchant
 * @param {string} merchantId - Merchant UUID
 * @param {string} email - Merchant's email or Stellar address
 * @returns {string} JWT token
 */
export function generateSessionToken(merchantId, email) {
  return jwt.sign(
    {
      id: merchantId,
      email: email,
      merchant_id: merchantId,
    },
    getJwtSecret(),
    { expiresIn: "24h" },
  );
}

/**
 * Verify and decode a session token
 * @param {string} token - Session token
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifySessionToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: "Invalid or expired session token" };
  }
}

