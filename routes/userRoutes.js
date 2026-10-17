import { Router } from "express";
import User from "../models/User.js";
import Cart from "../models/Cart.js";
import { hashPassword, verifyPassword, createUserToken, requireUser } from "../middleware/userAuth.js";

const router = Router();

// ── Validation helpers ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const passwordHash = await hashPassword(fields.password);
    const user = await User.create({
      name:    fields.name,
      email:   fields.email,
      passwordHash,
      phone:   fields.phone,
      company: fields.company,
    });

    // Create an empty cart for the new user
    await Cart.create({ user: user._id, items: [] });

    const token = createUserToken(user._id);
    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, company: user.company },
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

router.post("/login", async (req, res) => {
  const email    = String(req.body.email    || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!EMAIL_RE.test(email) || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    // +passwordHash — re-include the field that has select:false
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) {
      // Constant-time-ish response — don't reveal whether email exists
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    const token = createUserToken(user._id);
    return res.status(200).json({
      message: "Logged in successfully.",
      token,
      user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, company: user.company },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
});

// ── GET /api/users/me  (requires login) ───────────────────────────────────────

router.get("/me", requireUser, (req, res) => {
  res.json({ user: req.user });
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
    return res.json({ user: { _id: updated._id, name: updated.name, email: updated.email, phone: updated.phone, company: updated.company } });
  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({ message: "Could not update profile." });
  }
});

export default router;
