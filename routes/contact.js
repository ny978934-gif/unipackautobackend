import { Router } from 'express';
import Inquiry from '../models/Inquiry.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { optionalUser } from '../middleware/userAuth.js';
import User from '../models/User.js';

const router = Router();

// POST /api/inquiries — create a new inquiry
router.post("/", optionalUser, async (req, res) => {
  try {
    const {
      name,
      fullName,
      company,
      email,
      phone,
      machineInterest,
      productInterest,
      message,
    } = req.body;
    const inquiryName = name || fullName;
    const inquiryInterest = machineInterest || productInterest;

    if (!inquiryName || !email || !message) {
      return res.status(400).json({
        error: "Name, email, and message are required.",
      });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    const inquiry = await Inquiry.create({
      name: inquiryName,
      company,
      email,
      phone,
      machineInterest: inquiryInterest,
      message,
      assignedUser: req.user?._id || null,
    });

    res.status(201).json({
      message: "Inquiry received. Our team will get back to you shortly.",
      inquiry,
    });
  } catch (err) {
    console.error("Error creating inquiry:", err);
    res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
});

// GET /api/inquiries — list inquiries (for an admin view, if you build one later)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const inquiries = await Inquiry.find()
      .populate("assignedUser", "_id name email userId")
      .sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (err) {
    console.error("Error fetching inquiries:", err);
    res.status(500).json({ error: "Could not fetch inquiries." });
  }
});

router.patch("/:id/assign", requireAdmin, async (req, res, next) => {
  try {
    const assignedUserId = req.body?.assignedUserId || null;
    if (assignedUserId !== null) {
      if (typeof assignedUserId !== "string" || !/^[0-9a-fA-F]{24}$/.test(assignedUserId)) {
        return res.status(400).json({ message: "Choose a valid user." });
      }
      const user = await User.findOne({
        _id: assignedUserId,
        status: "active",
        deletedAt: null,
      }).select("_id");
      if (!user) return res.status(404).json({ message: "Active user not found." });
    }

    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { assignedUser: assignedUserId },
      { new: true, runValidators: true }
    ).populate("assignedUser", "_id name email userId");
    if (!inquiry) return res.status(404).json({ message: "Inquiry not found." });
    return res.json({ inquiry });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Inquiry not found." });
    return next(error);
  }
});

export default router;
