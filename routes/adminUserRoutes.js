import { Router } from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import {
  generateSecurePassword,
  generateUserId,
  hashPassword,
} from "../middleware/userAuth.js";
import { requireAdmin } from "../middleware/adminAuth.js";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

router.use(requireAdmin);

const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  userId: user.userId || "",
  phone: user.phone || "",
  company: user.company || "",
  status: user.status,
  deletedAt: user.deletedAt || null,
  createdAt: user.createdAt,
});

const createAvailableUserId = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const userId = generateUserId();
    if (!(await User.exists({ userId }))) return userId;
  }
  throw new Error("Could not generate an available user ID. Please try again.");
};

const readPassword = (value) => {
  if (value === undefined || value === null || value === "") return generateSecurePassword();
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value, "utf8") > 72) {
    const error = new Error("Password must be at least 12 characters and no more than 72 bytes.");
    error.status = 400;
    throw error;
  }
  return value;
};

router.post("/credentials", async (_req, res, next) => {
  try {
    const [userId, password] = await Promise.all([
      createAvailableUserId(),
      Promise.resolve(generateSecurePassword()),
    ]);
    return res.json({ userId, password });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const filter = req.query.includeDeleted === "true"
      ? {}
      : { deletedAt: null };
    const users = await User.find(filter)
      .select("_id name email userId phone company status createdAt +deletedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(users.map(publicUser));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const requestedUserId = typeof req.body?.userId === "string"
      ? req.body.userId.trim().toUpperCase()
      : "";
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ message: "Name must be 2–120 characters." });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (requestedUserId && !USER_ID_RE.test(requestedUserId)) {
      return res.status(400).json({ message: "User ID must be 2–40 letters, numbers, hyphens, or underscores." });
    }

    const userIdWasGenerated = !requestedUserId;
    const userId = requestedUserId || await createAvailableUserId();
    const passwordWasGenerated = req.body?.password === undefined || req.body.password === "";
    const password = readPassword(req.body?.password);
    const user = await User.create({
      name,
      email,
      userId,
      passwordHash: await hashPassword(password),
      status: "active",
    });
    return res.status(201).json({
      user: publicUser(user),
      ...(passwordWasGenerated || userIdWasGenerated
        ? { generatedCredentials: { userId, password } }
        : {}),
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        message: field === "userId" ? "User ID is already in use." : "An account with this email already exists.",
      });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "User not found." });
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim().toUpperCase() : "";
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ message: "Name must be 2–120 characters." });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (!USER_ID_RE.test(userId)) {
      return res.status(400).json({ message: "User ID must be 2–40 letters, numbers, hyphens, or underscores." });
    }

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { name, email, userId },
      { new: true, runValidators: true }
    ).select("_id name email userId phone company status createdAt +deletedAt");
    if (!user) return res.status(404).json({ message: "Active account not found." });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        message: field === "userId" ? "User ID is already in use." : "An account with this email already exists.",
      });
    }
    if (error.name === "CastError") return res.status(404).json({ message: "User not found." });
    return next(error);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  const { status } = req.body || {};
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ message: "Choose active or inactive status." });
  }
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { status },
      { new: true, runValidators: true }
    ).select("_id name email userId phone company status createdAt +deletedAt");
    if (!user) return res.status(404).json({ message: "Active account not found." });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "User not found." });
    return next(error);
  }
});

router.post("/:id/reset-password", async (req, res, next) => {
  try {
    const password = readPassword(req.body?.password);
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      {
        passwordHash: await hashPassword(password),
        $inc: { authVersion: 1 },
      },
      { new: true }
    ).select("_id name email userId");
    if (!user) return res.status(404).json({ message: "Active account not found." });
    return res.json({ message: "Password reset. Share the temporary password securely.", password });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.name === "CastError") return res.status(404).json({ message: "User not found." });
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { status: "inactive", deletedAt: new Date() },
      { new: true }
    ).select("_id name email userId status +deletedAt");
    if (!user) return res.status(404).json({ message: "Active account not found." });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "User not found." });
    return next(error);
  }
});

router.patch("/:id/restore", async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, deletedAt: { $ne: null } },
      { status: "active", deletedAt: null },
      { new: true, runValidators: true }
    ).select("_id name email userId phone company status createdAt +deletedAt");
    if (!user) return res.status(404).json({ message: "Deleted account not found." });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "User not found." });
    return next(error);
  }
});

export default router;
