import { Router } from 'express';
import Inquiry from '../models/Inquiry.js';

const router = Router();

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

// GET /api/inquiries — list inquiries (for an admin view, if you build one later)
router.get("/", async (req, res) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (err) {
    console.error("Error fetching inquiries:", err);
    res.status(500).json({ error: "Could not fetch inquiries." });
  }
});

export default router;
