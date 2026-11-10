import { Router } from "express";
import User from "../models/User.js";
import Cart from "../models/Cart.js";
import Inquiry from "../models/Inquiry.js";
import QuoteRequest from "../models/QuoteRequest.js";
import {
  createUserToken,
  hashLegacyPassword,
  isAdminManagedUser,
  requireUser,
  requirePortalUser,
  verifyPassword,
} from "../middleware/userAuth.js";
import {
  buildQuotationPdf,
  getQuotationTotals,
  sendFinalizedQuotation,
} from "../services/quoteManagement.js";

const router = Router();
const failedAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const QUOTE_STATUSES = ["new", "in_progress", "quoted", "closed"];
const INQUIRY_STATUSES = ["new", "contacted", "closed"];

// ── Validation helpers ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const validateSignup = (body) => {
  const errors = {};
  const name    = String(body.name    || "").trim();
  const email   = String(body.email   || "").trim().toLowerCase();
  const password = String(body.password || "");
  const phone   = String(body.phone   || "").trim();
  const company = String(body.company || "").trim();

  if (!name || name.length < 2 || name.length > 120)
    errors.name = "Name must be 2–120 characters.";
  if (!EMAIL_RE.test(email))
    errors.email = "Enter a valid email address.";
  if (password.length < 8 || password.length > 1024)
    errors.password = "Password must be 8–1024 characters.";
  if (phone && !/^[+\d\s().\-]{7,20}$/.test(phone))
    errors.phone = "Enter a valid phone number.";

  return { errors, fields: { name, email, password, phone, company } };
};

// ── POST /api/users/signup ────────────────────────────────────────────────────

router.post("/signup", async (req, res) => {
  const { errors, fields } = validateSignup(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ message: "Please fix the errors below.", errors });
  }

  try {
    const exists = await User.exists({ email: fields.email });
    if (exists) {
      return res.status(409).json({
        message: "An account with this email already exists.",
        errors: { email: "Email already in use." },
      });
    }

    const passwordHash = await hashLegacyPassword(fields.password);
    const user = await User.create({
      name:    fields.name,
      email:   fields.email,
      passwordHash,
      phone:   fields.phone,
      company: fields.company,
    });

    // Create an empty cart for the new user
    await Cart.create({ user: user._id, items: [] });

    const token = createUserToken(user._id, user.authVersion || 0);
    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userId: user.userId,
        phone: user.phone,
        company: user.company,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists.", errors: { email: "Email already in use." } });
    }
    console.error("Signup error:", error);
    return res.status(500).json({ message: "Could not create account. Please try again." });
  }
});

// ── POST /api/users/login ─────────────────────────────────────────────────────

router.post("/login", rateLimitLogin, async (req, res) => {
  const email    = String(req.body?.email    || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 1024) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    // +passwordHash — re-include the field that has select:false
    const user = await User.findOne({
      email,
      status: "active",
      deletedAt: null,
    }).select("+passwordHash");
    const ok = await verifyPassword(password, user?.passwordHash || "");
    if (!user || isAdminManagedUser(user) || !ok) {
      recordFailedAttempt(req.loginRateLimitKey);
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    failedAttempts.delete(req.loginRateLimitKey);
    const token = createUserToken(user._id, user.authVersion || 0);
    return res.status(200).json({
      message: "Logged in successfully.",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userId: user.userId,
        phone: user.phone,
        company: user.company,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
});

router.post("/portal-login", rateLimitLogin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const userId = String(req.body?.userId || "").trim().toUpperCase();
  const password = String(req.body?.password || "");
  if (
    !EMAIL_RE.test(email) ||
    email.length > 254 ||
    !userId ||
    userId.length > 40 ||
    !password ||
    password.length > 1024
  ) {
    return res.status(400).json({ message: "Email, User ID, and password are required." });
  }

  try {
    const user = await User.findOne({
      email,
      userId,
      status: "active",
      deletedAt: null,
    }).select("+passwordHash");
    const valid = await verifyPassword(password, user?.passwordHash || "");
    if (!user || !isAdminManagedUser(user) || !valid) {
      recordFailedAttempt(req.loginRateLimitKey);
      return res.status(401).json({ message: "Incorrect email, User ID, or password." });
    }

    failedAttempts.delete(req.loginRateLimitKey);
    return res.json({
      message: "Logged in successfully.",
      token: createUserToken(user._id, user.authVersion || 0, true),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userId: user.userId,
        phone: user.phone,
        company: user.company,
      },
    });
  } catch (error) {
    console.error("User portal login error:", error);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
});

// ── GET /api/users/me  (requires login) ───────────────────────────────────────

router.get("/me", requireUser, (req, res) => {
  res.json({ user: req.user, portalAccess: Boolean(req.portalAccess) });
});

// ── PATCH /api/users/me  (update profile) ────────────────────────────────────

router.patch("/me", requireUser, async (req, res) => {
  const allowed = {};
  if (req.body.name    !== undefined) allowed.name    = String(req.body.name).trim().slice(0, 120);
  if (req.body.phone   !== undefined) allowed.phone   = String(req.body.phone).trim().slice(0, 30);
  if (req.body.company !== undefined) allowed.company = String(req.body.company).trim().slice(0, 200);

  if (!Object.keys(allowed).length) {
    return res.status(400).json({ message: "Nothing to update." });
  }

  try {
    const updated = await User.findByIdAndUpdate(req.user._id, allowed, { new: true });
    if (!updated) return res.status(404).json({ message: "User not found." });
    return res.json({
      user: {
        _id: updated._id,
        name: updated.name,
        email: updated.email,
        userId: updated.userId,
        phone: updated.phone,
        company: updated.company,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({ message: "Could not update profile." });
  }
});

router.get("/me/quotes", requirePortalUser, async (req, res, next) => {
  try {
    const quotes = await QuoteRequest.find()
      .select("-customerAccessTokenHash -assignedUser")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ quotes });
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/quotes/:id/status", requirePortalUser, async (req, res, next) => {
  const { status } = req.body || {};
  if (!QUOTE_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Choose a valid quote request status." });
  }
  try {
    const request = await QuoteRequest.findOneAndUpdate(
      { _id: req.params.id },
      { status },
      { new: true, runValidators: true }
    );
    if (!request) return res.status(404).json({ message: "Quote request not found." });
    return res.json({ request });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Quote request not found." });
    return next(error);
  }
});

router.get("/me/quotes/:id/pdf", requirePortalUser, async (req, res) => {
  try {
    const quote = await QuoteRequest.findOne({
      _id: req.params.id,
    });
    if (!quote || quote.quoteType !== "sparePart") {
      return res.status(404).json({ message: "Spare-part quotation not found." });
    }
    if (!quote.quotation?.sentAt || !quote.quotation?.items?.length) {
      return res.status(409).json({ message: "Finalize the quotation before downloading its PDF." });
    }
    const totals = await getQuotationTotals(quote);
    const pdf = buildQuotationPdf(quote, totals);
    const filename = `${(quote.quotation.number || "quotation").replace(/[^a-z0-9-]/gi, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(pdf);
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Quotation not found." });
    console.error("Failed to generate portal quotation PDF:", error);
    return res.status(500).json({ message: "Could not generate the quotation PDF." });
  }
});

router.patch("/me/quotes/:id/quotation", requirePortalUser, async (req, res) => {
  try {
    const quote = await QuoteRequest.findOne({
      _id: req.params.id,
    });
    if (!quote || quote.quoteType !== "sparePart") {
      return res.status(404).json({ message: "Spare-part quote request not found." });
    }
    const discountPercentages = req.body?.discountPercentages;
    if (!Array.isArray(discountPercentages) || discountPercentages.length !== quote.parts.length) {
      return res.status(400).json({ message: "Provide a discount percentage for every spare part." });
    }
    if (discountPercentages.some((value) =>
      typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100
    )) {
      return res.status(400).json({ message: "Each item discount must be a percentage from 0 to 100." });
    }
    const wasFinalized = Boolean(quote.quotation?.sentAt);
    const discountsAreUnchanged = quote.quotation?.items?.length === discountPercentages.length &&
      quote.quotation.items.every((item, index) =>
        Number(item.discountPercentage || 0) === discountPercentages[index]
      );
    if (wasFinalized && quote.notificationStatus === "sent" && discountsAreUnchanged) {
      return res.json({
        message: "This quotation has already been emailed with these item discounts.",
        notificationSent: true,
        alreadySent: true,
        request: quote,
      });
    }
    const totals = await getQuotationTotals(quote, discountPercentages);
    const delivery = await sendFinalizedQuotation(quote, totals, {
      issuedAt: new Date(),
      creator: {
        type: "user",
        databaseId: req.user._id,
        name: req.user.name,
        userId: req.user.userId,
      },
    });
    return res.json({
      message: delivery.notificationSent
        ? wasFinalized
          ? "Item discounts saved and revised quotation emailed to the owner and customer."
          : "Quotation finalized and emailed to the owner and customer."
        : wasFinalized
          ? "Item discounts saved, but the revised quotation email could not be delivered to both recipients."
          : "Quotation finalized, but the email could not be delivered to both recipients.",
      notificationSent: delivery.notificationSent,
      notificationError: delivery.notificationError || "",
      request: delivery.request,
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Quote request not found." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Failed to save portal quotation:", error);
    return res.status(500).json({ message: "Could not save the quotation." });
  }
});

router.get("/me/inquiries", requirePortalUser, async (req, res, next) => {
  try {
    const inquiries = await Inquiry.find()
      .select("_id name company email phone machineInterest message status createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ inquiries });
  } catch (error) {
    return next(error);
  }
});

router.patch("/me/inquiries/:id/status", requirePortalUser, async (req, res, next) => {
  const { status } = req.body || {};
  if (!INQUIRY_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Choose a valid inquiry status." });
  }
  try {
    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!inquiry) return res.status(404).json({ message: "Inquiry not found." });
    return res.json({ inquiry });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Inquiry not found." });
    return next(error);
  }
});

router.patch("/me/password", requirePortalUser, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || currentPassword.length > 1024) {
    return res.status(400).json({ message: "Enter your current password." });
  }
  if (newPassword.length < 12 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ message: "New password must be at least 12 characters and no more than 72 bytes." });
  }
  try {
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }
    user.passwordHash = await hashPassword(newPassword);
    user.authVersion = (user.authVersion || 0) + 1;
    await user.save();
    return res.json({
      message: "Password changed successfully.",
      token: createUserToken(user._id, user.authVersion, true),
    });
  } catch (error) {
    console.error("Password change error:", error);
    return res.status(500).json({ message: "Could not change password. Please try again." });
  }
});

export default router;
