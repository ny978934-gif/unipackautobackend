import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import Admin from "../models/Admin.js";

const scrypt = promisify(scryptCallback);
const JWT_LIFETIME_SECONDS = 8 * 60 * 60;

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error("JWT_SECRET must be configured with at least 32 characters.");
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
  let salt;
  let expected;
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

export const createAdminToken = (adminId) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: String(adminId),
    iat: issuedAt,
    exp: issuedAt + JWT_LIFETIME_SECONDS,
  })).toString("base64url");
  const content = `${header}.${payload}`;
  const signature = createHmac("sha256", getJwtSecret()).update(content).digest("base64url");
  return `${content}.${signature}`;
};

export const verifyAdminToken = (token) => {
  const [headerText, payloadText, signatureText, ...extra] = String(token || "").split(".");
  if (!headerText || !payloadText || !signatureText || extra.length) return null;

  const content = `${headerText}.${payloadText}`;
  const expected = createHmac("sha256", getJwtSecret()).update(content).digest();
  let provided;
  let header;
  let payload;
  try {
    provided = Buffer.from(signatureText, "base64url");
    header = JSON.parse(Buffer.from(headerText, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    headerText !== Buffer.from(JSON.stringify(header)).toString("base64url") ||
    payloadText !== Buffer.from(JSON.stringify(payload)).toString("base64url") ||
    signatureText !== provided.toString("base64url")
  ) return null;
  if (
    header.alg !== "HS256" ||
    provided.length !== expected.length ||
    !timingSafeEqual(expected, provided) ||
    typeof payload.sub !== "string" ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) return null;
  return payload;
};

export const requireAdmin = async (req, res, next) => {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) return res.status(401).json({ message: "Admin authentication is required." });

  try {
    const payload = verifyAdminToken(match[1]);
    if (!payload) return res.status(401).json({ message: "Admin session is invalid or expired." });
    const admin = await Admin.findById(payload.sub).select("_id email").lean();
    if (!admin) return res.status(401).json({ message: "Admin session is invalid or expired." });
    req.admin = admin;
    return next();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};
