import { Router } from 'express';
import Inquiry from '../models/Inquiry.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();
const INQUIRY_STATUSES = ["new", "contacted", "closed"];

// POST /api/inquiries — create a new inquiry
router.post("/", async (req, res) => {
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

// GET /api/inquiries — list inquiries for the Admin dashboard
router.get("/", requireAdmin, async (_req, res) => {
  try {
    const inquiries = await Inquiry.find()
      .select("-assignedUser")
      .sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (err) {
    console.error("Error fetching inquiries:", err);
    res.status(500).json({ error: "Could not fetch inquiries." });
  }
});

router.patch("/:id/status", requireAdmin, async (req, res, next) => {
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

export default router;
