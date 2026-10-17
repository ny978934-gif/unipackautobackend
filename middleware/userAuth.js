/**
 * User authentication middleware
 *
 * Uses the exact same hand-rolled JWT + scrypt approach as adminAuth.js
 * so we have zero extra npm dependencies.
 *
 * Token storage: the client keeps the token in localStorage under
 * "unipack-user-token". The server sends/validates it via
 * "Authorization: Bearer <token>".
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import User from "../models/User.js";

const scrypt = promisify(scryptCallback);

const USER_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ── Helpers (same implementation as adminAuth) ────────────────────────────────

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error("JWT_SECRET must be at least 32 characters.");
    error.status = 503;
    throw error;
  }
  return secret;
};

export const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
};

export const verifyPassword = async (password, storedHash) => {
  const [algorithm, saltText, hashText, ...extra] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText || extra.length) return false;
  let salt, expected;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(hashText, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, actual);
};

export const createUserToken = (userId) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    iat: issuedAt,
    exp: issuedAt + USER_TOKEN_LIFETIME_SECONDS,
    role: "user",
  })).toString("base64url");
  const content = `${header}.${payload}`;
  const signature = createHmac("sha256", getJwtSecret()).update(content).digest("base64url");
  return `${content}.${signature}`;
};

export const verifyUserToken = (token) => {
  const [headerText, payloadText, signatureText, ...extra] = String(token || "").split(".");
  if (!headerText || !payloadText || !signatureText || extra.length) return null;

  const content = `${headerText}.${payloadText}`;
  const expected = createHmac("sha256", getJwtSecret()).update(content).digest();
  let provided, header, payload;
  try {
    provided = Buffer.from(signatureText, "base64url");
    header = JSON.parse(Buffer.from(headerText, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    header.alg !== "HS256" ||
    payload.role !== "user" ||
    provided.length !== expected.length ||
    !timingSafeEqual(expected, provided) ||
    typeof payload.sub !== "string" ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) return null;
  return payload;
};

// ── requireUser middleware ─────────────────────────────────────────────────────

export const requireUser = async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) return res.status(401).json({ message: "Login required." });

  try {
    const payload = verifyUserToken(match[1]);
    if (!payload) return res.status(401).json({ message: "Session invalid or expired. Please log in again." });

    const user = await User.findById(payload.sub).select("_id name email phone company").lean();
    if (!user) return res.status(401).json({ message: "Account no longer exists." });

    req.user = user;
    return next();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

/** Optional auth — attaches req.user if a valid token is present, but never blocks the request */
export const optionalUser = async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) return next();

  try {
    const payload = verifyUserToken(match[1]);
    if (payload) {
      const user = await User.findById(payload.sub).select("_id name email").lean();
      if (user) req.user = user;
    }
  } catch {
    // intentionally silent — optional auth never blocks
  }
  return next();
};
