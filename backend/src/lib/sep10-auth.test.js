import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  generateChallenge,
  verifyChallenge,
  _resetNonceCacheForTests,
} from "./sep10-auth.js";

const HOME_DOMAIN = "localhost";

describe("SEP-0010 Authentication", () => {
  let clientKeypair;
  let serverKeypair;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    clientKeypair = StellarSdk.Keypair.random();
    serverKeypair = StellarSdk.Keypair.random();
    process.env.SEP10_SERVER_SIGNING_KEY = serverKeypair.secret();
  });

  beforeEach(() => {
    _resetNonceCacheForTests();
  });

  it("should generate a valid challenge transaction", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    expect(challengeXdr).toBeTruthy();
    expect(typeof challengeXdr).toBe("string");

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );
    expect(tx.operations.length).toBe(1);
    expect(tx.operations[0].type).toBe("manageData");
  });

  it("should reject an invalid client Stellar account", () => {
    expect(() => generateChallenge("not-a-valid-account", HOME_DOMAIN)).toThrow(
      "Invalid client Stellar account",
    );
  });

  it("should verify a properly signed challenge", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(true);
  });

  it("should reject challenge without client signature", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);

    const result = verifyChallenge(challengeXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Client signature");
  });

  it("should reject challenge with wrong client account", () => {
    const wrongKeypair = StellarSdk.Keypair.random();
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, wrongKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
  });

  it("should reject a reused nonce (replay protection)", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const first = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(first.valid).toBe(true);

    const second = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(second.valid).toBe(false);
    expect(second.error).toBe("Challenge nonce already used");
  });

  it("should reject an invalid client account in verifyChallenge", () => {
    const result = verifyChallenge("AAAA", "not-a-key", HOME_DOMAIN);
    expect(result.valid).toBe(false);
  });
});
