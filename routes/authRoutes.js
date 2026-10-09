import express from "express";
import { timingSafeEqual } from "node:crypto";
import Admin from "../models/Admin.js";
import {
  createAdminToken,
  getJwtSecret,
  hashPassword,
  requireAdmin,
  verifyPassword,
} from "../middleware/adminAuth.js";

const router = express.Router();
const failedAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const DUMMY_PASSWORD_HASH = `scrypt$AAAAAAAAAAAAAAAAAAAAAA$${"A".repeat(86)}`;

const rateLimitLogin = (req, res, next) => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (entry.resetAt <= now) failedAttempts.delete(ip);
  }
  const ip = req.ip || "unknown";
  const entry = failedAttempts.get(ip);
  if (entry && entry.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ message: "Too many login attempts. Try again later." });
  }
  req.loginRateLimitKey = ip;
  return next();
};

const recordFailedAttempt = (key) => {
  const current = failedAttempts.get(key);
  failedAttempts.set(key, {
    count: (current?.count || 0) + 1,
    resetAt: current?.resetAt > Date.now() ? current.resetAt : Date.now() + LOGIN_WINDOW_MS,
  });
};

const matchesSetupKey = (providedKey) => {
  const configuredKey = process.env.ADMIN_SETUP_KEY;
  if (!configuredKey || Buffer.byteLength(configuredKey) < 32 || !providedKey) return false;
  const expected = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};

router.get("/setup-status", async (_req, res, next) => {
  try {
    res.json({
      available: Boolean(process.env.ADMIN_SETUP_KEY && Buffer.byteLength(process.env.ADMIN_SETUP_KEY) >= 32) &&
        !(await Admin.exists({})),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/setup", rateLimitLogin, async (req, res, next) => {
  try {
    getJwtSecret();
    await Admin.init();
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmation = typeof req.body?.passwordConfirmation === "string"
      ? req.body.passwordConfirmation
      : "";
    const setupKey = typeof req.body?.setupKey === "string" ? req.body.setupKey : "";

    if (!matchesSetupKey(setupKey)) {
      recordFailedAttempt(req.loginRateLimitKey);
      return res.status(403).json({ message: "The first-admin setup key is invalid or not configured." });
    }
    if (await Admin.exists({})) {
      return res.status(403).json({ message: "Initial admin setup is already complete." });
    }
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 12 ||
      password.length > 1024 ||
      password !== confirmation
    ) {
      return res.status(400).json({
        message: "Provide a valid email, matching passwords of at least 12 characters, and the setup key.",
      });
    }

    const admin = await Admin.create({
      email,
      passwordHash: await hashPassword(password),
      bootstrapAccount: "initial",
    });
    failedAttempts.delete(req.loginRateLimitKey);
    return res.status(201).json({
      token: createAdminToken(admin.id),
      admin: { id: admin.id, email: admin.email },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(403).json({ message: "Initial admin setup is already complete." });
    }
    return next(error);
  }
});

router.post("/login", rateLimitLogin, async (req, res, next) => {
  try {
    getJwtSecret();
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length > 1024
    ) {
      return res.status(400).json({ message: "Provide a valid email and password." });
    }

    const admin = await Admin.findOne({ email }).select("+passwordHash");
    const isValidPassword = await verifyPassword(password, admin?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!admin || !isValidPassword) {
      recordFailedAttempt(req.loginRateLimitKey);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    failedAttempts.delete(req.loginRateLimitKey);
    return res.json({
      token: createAdminToken(admin.id),
      admin: { id: admin.id, email: admin.email },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: { id: String(req.admin._id), email: req.admin.email } });
});

export default router;
