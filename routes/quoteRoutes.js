import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import QuoteRequest from "../models/QuoteRequest.js";
import Product from "../models/Product.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import cloudinary, { isConfigured } from "../config/cloudinary.js";
import { uploadsDirectory } from "../config/uploads.js";
import {
  createQuotationNumber,
  calculateQuotationTotals,
  calculateQuotationTotalsFromPaise,
  describeEmailFailure,
  sendFinalQuotation,
  sendQuoteRequestNotification,
} from "../services/quoteNotification.js";
import { buildQuotationPdf } from "../services/quotePdf.js";

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

const applyQuotationTotals = (quote, totals, quotationNumber, issuedAt) => {
  quote.quotation.number = quotationNumber;
  quote.quotation.sentAt = issuedAt;
  quote.quotation.items = totals.items.map((item) => ({
    name: item.name,
    itemCode: item.itemCode || "",
    machine: item.machine || "",
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
  }));
  quote.quotation.subtotalCents = totals.subtotalPaise;
  quote.quotation.gstCents = totals.gstPaise;
  quote.quotation.grossTotalCents = totals.grandTotalPaise;
  quote.quotation.discountType = totals.discountType;
  quote.quotation.discountValue = totals.discountValue;
  quote.quotation.discountCents = totals.discountPaise;
  quote.quotation.finalTotalCents = totals.finalTotalPaise;
};

const getQuotationTotals = async (quote) => {
  const discount = {
    type: quote.quotation?.discountType || "none",
    value: quote.quotation?.discountValue || 0,
  };
  if (quote.quotation?.items?.length) {
    return calculateQuotationTotalsFromPaise(
      quote.quotation.items.map((item) => ({
        ...(item.toObject?.() ?? item),
        unitPricePaise: item.unitPricePaise,
      })),
      discount
    );
  }
  const pricedItems = await enrichPartsWithPrices(quote.parts || []);
  return calculateQuotationTotals(pricedItems, discount);
};

const sendFinalizedQuotation = async (quote, totals, { issuedAt }) => {
  const quotationNumber = quote.quotation.number || createQuotationNumber(quote.id, issuedAt);
  applyQuotationTotals(quote, totals, quotationNumber, issuedAt);
  quote.notificationStatus = "pending";
  quote.notificationError = "";
  quote.status = "quoted";
  await quote.save();

  try {
    await sendFinalQuotation(quote, totals, {
      quotationNumber,
      issuedAt,
    });
    quote.notificationStatus = "sent";
    quote.notificationError = "";
    await quote.save();
    return { notificationSent: true, request: quote };
  } catch (error) {
    quote.notificationStatus = "failed";
    quote.notificationError = describeEmailFailure(error);
    await quote.save();
    console.error(`Updated quotation email failed for ${quote.id}:`, {
      message: error.message,
      guidance: quote.notificationError,
    });
    return { notificationSent: false, notificationError: quote.notificationError, request: quote };
  }
};

export const validateQuote = (body) => {
  if (body.quoteType !== "sparePart") {
    throw new QuoteInputError("Only spare-part quote requests are accepted.");
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
    quoteType: "sparePart",
    company: readText(body.company, "Company name", 200),
    contactName: readText(body.contactName, "Contact person name", 160),
    email,
    phone: readText(body.phone, "Phone number", 30),
    city: readText(body.city, "City", 120),
    state: readText(body.state, "State", 120),
    message: optionalText(body.message, "Message", 4000),
  };

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
      productId: part.partId || part.productId || null,
      quantity: readQuantity(part.quantity, `Part ${index + 1} quantity`),
    };
  });
  for (const [index, part] of quote.parts.entries()) {
    if (part.productId && !/^[0-9a-fA-F]{24}$/.test(String(part.productId))) {
      throw new QuoteInputError(`Part ${index + 1} has an invalid spare part selection.`);
    }
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

// ── Price lookup ──────────────────────────────────────────────────────────────
/**
 * For each spare-part row in the validated quote, fetch the catalogue price
 * from MongoDB using the productId the frontend sent.
 *
 * Returns an array ready for request or finalized quotation totals:
 *   { name, itemCode, quantity, unitPrice (rupees from the catalogue) }
 */
const enrichPartsWithPrices = async (parts) => {
  // Collect distinct valid ObjectIds
  const validIds = [
    ...new Set(
      parts
        .map((p) => p.productId)
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  if (parts.some((part) => !part.productId || !mongoose.isValidObjectId(part.productId))) {
    throw new Error("Every spare part must be selected from the current catalogue.");
  }

  // Fetch all in one query
  const products = validIds.length
    ? await Product.find(
        { _id: { $in: validIds }, type: "sparepart" },
        { _id: 1, name: 1, partCode: 1, price: 1 }
      ).lean()
    : [];

  const priceMap = new Map(
    products.map((p) => [String(p._id), p])
  );

  return parts.map((part, index) => {
    const product = part.productId ? priceMap.get(String(part.productId)) : null;
    if (!product || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0) {
      throw new Error(`A catalogue price is not configured for spare part ${index + 1}.`);
    }
    return {
      name:      product.name,
      itemCode:  product.partCode || part.itemCode || "",
      machine:   part.machine || "",
      quantity:  part.quantity,
      // Never accept pricing from the submitted form; catalogue prices are authoritative.
      unitPrice: product.price,
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────

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
    let notificationSent = false;
    try {
      const requestItems = await enrichPartsWithPrices(savedQuote.parts || []);
      const requestTotals = calculateQuotationTotals(requestItems);
      await sendQuoteRequestNotification(savedQuote, requestTotals);
      savedQuote.notificationStatus = "sent";
      savedQuote.notificationError = "";
      notificationSent = true;
    } catch (error) {
      savedQuote.notificationStatus = "failed";
      savedQuote.notificationError = describeEmailFailure(error);
      console.error(`Quote request notification failed for ${savedQuote.id}:`, {
        message: error.message,
        guidance: savedQuote.notificationError,
      });
    }
    await savedQuote.save();
    return res.status(201).json({
      message: "Quote request received.",
      notificationSent,
      notificationError: savedQuote.notificationError,
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
    const requests = await QuoteRequest.find()
      .select("-customerAccessTokenHash")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(requests);
  } catch (error) {
    console.error("Error fetching quote requests:", error);
    return res.status(500).json({ message: "Could not fetch quote requests." });
  }
});

router.get("/:id/pdf", requireAdmin, async (req, res) => {
  try {
    const quote = await QuoteRequest.findById(req.params.id);
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
    console.error("Failed to generate admin quotation PDF:", error);
    return res.status(500).json({ message: "Could not generate the quotation PDF." });
  }
});

router.patch("/:id/discount", requireAdmin, async (req, res) => {
  const discountType = req.body?.discountType;
  const discountValue = Number(req.body?.discountValue);
  if (!["none", "percentage", "fixed"].includes(discountType)) {
    return res.status(400).json({ message: "Choose no discount, percentage, or fixed amount." });
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return res.status(400).json({ message: "Enter a valid non-negative discount." });
  }
  if ((discountType === "none" && discountValue !== 0) ||
      (discountType === "percentage" && discountValue > 100)) {
    return res.status(400).json({ message: "Discount percentage must be from 0 to 100; no discount must be zero." });
  }

  try {
    const quote = await QuoteRequest.findById(req.params.id);
    if (!quote || quote.quoteType !== "sparePart") {
      return res.status(404).json({ message: "Spare-part quote request not found." });
    }
    const wasFinalized = Boolean(quote.quotation?.sentAt);
    const discountIsUnchanged = quote.quotation?.discountType === discountType &&
      Number(quote.quotation?.discountValue || 0) === discountValue;
    if (wasFinalized && quote.notificationStatus === "sent" && discountIsUnchanged) {
      return res.json({
        message: "This quotation has already been emailed with the current discount.",
        notificationSent: true,
        alreadySent: true,
        request: quote,
      });
    }
    quote.quotation.discountType = discountType;
    quote.quotation.discountValue = discountValue;
    const totals = await getQuotationTotals(quote);
    const delivery = await sendFinalizedQuotation(quote, totals, {
      issuedAt: new Date(),
    });
    return res.json({
      message: delivery.notificationSent
        ? wasFinalized
          ? "Discount saved and revised quotation emailed to the owner and customer."
          : "Quotation finalized and emailed to the owner and customer."
        : wasFinalized
          ? "Discount saved, but the revised quotation email could not be delivered to both recipients."
          : "Quotation finalized, but the email could not be delivered to both recipients.",
      notificationSent: delivery.notificationSent,
      notificationError: delivery.notificationError || "",
      request: delivery.request,
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ message: "Quote request not found." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Failed to apply quotation discount:", error);
    return res.status(500).json({ message: "Could not apply the quotation discount." });
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
