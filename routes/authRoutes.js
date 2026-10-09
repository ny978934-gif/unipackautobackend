import express from "express";
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

const configuredAdminEmail = () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : "";
};

router.get("/setup-status", async (_req, res, next) => {
  try {
    res.json({
      available: Boolean(configuredAdminEmail()) && !(await Admin.exists({})),
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
    const allowedEmail = configuredAdminEmail();
    if (!allowedEmail || email !== allowedEmail) {
      recordFailedAttempt(req.loginRateLimitKey);
      return res.status(403).json({
        message:
          "Initial admin setup is restricted to the email configured in ADMIN_EMAIL on the backend. Set ADMIN_EMAIL to this address in Render, restart the service, and try again.",
      });
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
        message: "Provide the authorized email and matching passwords of at least 12 characters.",
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
