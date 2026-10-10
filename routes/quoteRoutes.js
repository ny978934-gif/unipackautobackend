import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import QuoteRequest from "../models/QuoteRequest.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import cloudinary, { isConfigured } from "../config/cloudinary.js";
import { uploadsDirectory } from "../config/uploads.js";
import { sendQuoteNotification } from "../services/quoteNotification.js";

const router = Router();
const maximumAttachmentSize = 10 * 1024 * 1024;
const allowedTypes = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".csv": ["text/csv", "application/vnd.ms-excel", "application/octet-stream"],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumAttachmentSize, files: 1, fieldSize: 256 * 1024, fields: 20, parts: 21 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedTypes[extension]?.includes(file.mimetype)) return callback(null, true);
    const error = new Error("Unsupported attachment. Upload a PDF, image, Word, Excel, or CSV file.");
    error.status = 400;
    return callback(error);
  },
});

const parseAttachment = (req, res, next) => {
  upload.single("attachment")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "The attachment must be 10 MB or smaller."
        : "Only one attachment can be uploaded.";
      return res.status(400).json({ message });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  });
};

class QuoteInputError extends Error {}

const readText = (value, field, maxLength) => {
  if (typeof value !== "string") throw new QuoteInputError(`${field} is required.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new QuoteInputError(`${field} is required and must be under ${maxLength} characters.`);
  return text;
};

const optionalText = (value, field, maxLength) => {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new QuoteInputError(`${field} must be under ${maxLength} characters.`);
  }
  return value.trim();
};

const readQuantity = (value, field) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    throw new QuoteInputError(`${field} must be a whole number between 1 and 100,000.`);
  }
  return quantity;
};

const validateQuote = (body) => {
  const quoteType = body.quoteType;
  if (!["sparePart", "machine"].includes(quoteType)) {
    throw new QuoteInputError("Choose either a spare part or machine quote.");
  }
  const email = readText(body.email, "Email address", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new QuoteInputError("Please provide a valid email address.");
  }
  const digits = String(body.phone || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 20 || !/^[+()\-\d.\s]+$/.test(body.phone || "")) {
    throw new QuoteInputError("Please provide a valid phone number.");
  }
  const quote = {
    quoteType,
    company: readText(body.company, "Company name", 200),
    contactName: readText(body.contactName, "Contact person name", 160),
    email,
    phone: readText(body.phone, "Phone number", 30),
    city: readText(body.city, "City", 120),
    state: readText(body.state, "State", 120),
    message: optionalText(body.message, "Message", 4000),
  };

  if (quoteType === "machine") {
    quote.machineType = readText(body.machineType, "Machine type", 150);
    quote.model = readText(body.model, "Model", 150);
    quote.quantity = readQuantity(body.quantity, "Quantity");
    quote.specifications = optionalText(body.specifications, "Specifications", 4000);
  } else {
    let parts;
    try {
      parts = JSON.parse(body.parts);
    } catch {
      throw new QuoteInputError("Add at least one valid spare part.");
    }
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 30) {
      throw new QuoteInputError("A quote must include between 1 and 30 spare parts.");
    }
    quote.parts = parts.map((part, index) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new QuoteInputError(`Part ${index + 1} must contain valid spare part details.`);
      }
      return {
        machine: readText(
          part.machine || [part.machineCategory, part.machineName].filter(Boolean).join(" / "),
          `Part ${index + 1} machine category / name`,
          300
        ),
        partName: readText(part.partName, `Part ${index + 1} spare part name`, 150),
        itemCode: optionalText(part.itemCode, `Part ${index + 1} item code`, 100),
        quantity: readQuantity(part.quantity, `Part ${index + 1} quantity`),
      };
    });
  }
  return quote;
};

const cloudinaryUpload = (file, publicId) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { resource_type: "auto", folder: "unipackauto/quote-requests", public_id: publicId },
    (error, result) => {
      if (error) return reject(error);
      if (!result?.secure_url) return reject(new Error("Attachment upload did not return a file URL."));
      resolve(result.secure_url);
    }
  );
  stream.end(file.buffer);
});

const storeAttachment = async (req, file) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const filename = `${randomUUID()}${extension}`;
  let url;
  if (isConfigured && cloudinary) {
    url = await cloudinaryUpload(file, path.parse(filename).name);
  } else {
    if (process.env.NODE_ENV === "production" && !process.env.UPLOAD_DIR) {
      const error = new Error("File upload storage is unavailable. Configure Cloudinary or a persistent UPLOAD_DIR.");
      error.status = 503;
      throw error;
    }
    const directory = path.join(uploadsDirectory, "quote-requests");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), file.buffer, { flag: "wx" });
    url = `${req.protocol}://${req.get("host")}/uploads/quote-requests/${filename}`;
  }
  return {
    url,
    name: file.originalname.replace(/[\r\n]/g, "").slice(0, 255),
    contentType: file.mimetype,
    size: file.size,
  };
};

router.post("/", parseAttachment, async (req, res) => {
  let quote;
  try {
    quote = validateQuote(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    if (req.file) quote.attachment = await storeAttachment(req, req.file);
    const savedQuote = await QuoteRequest.create(quote);

    let notificationSent = true;
    try {
      await sendQuoteNotification(savedQuote);
      savedQuote.notificationStatus = "sent";
    } catch (error) {
      notificationSent = false;
      savedQuote.notificationStatus = "failed";
      console.error(`Email notification failed for quote request ${savedQuote.id}:`, error.message);
    }
    await savedQuote.save();
    return res.status(201).json({
      message: "Quote request received.",
      notificationSent,
      requestId: savedQuote.id,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Error creating quote request:", error);
    return res.status(500).json({ message: "Your quote request could not be saved. Please try again." });
  }
});

router.get("/", requireAdmin, async (_req, res) => {
  try {
    const requests = await QuoteRequest.find().sort({ createdAt: -1 }).lean();
    return res.json(requests);
  } catch (error) {
    console.error("Error fetching quote requests:", error);
    return res.status(500).json({ message: "Could not fetch quote requests." });
  }
});

router.patch("/:id/status", requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!["new", "in_progress", "quoted", "closed"].includes(status)) {
    return res.status(400).json({ message: "Choose a valid quote request status." });
  }
  try {
    const request = await QuoteRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!request) return res.status(404).json({ message: "Quote request not found." });
    return res.json({ request });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Quote request not found." });
    console.error("Error updating quote request status:", error);
    return res.status(500).json({ message: "Could not update quote request status." });
  }
});

export default router;
