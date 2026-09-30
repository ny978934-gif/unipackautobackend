import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { randomUUID } from "crypto";
import cloudinary, { isConfigured } from "../config/cloudinary.js";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import SubCategory from "../models/SubCategory.js";
import SubSubCategory from "../models/SubSubCategory.js";

const router = express.Router();

// ── multer — keep file in memory, validate type & size ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    const isPdf  = ext === "pdf"  && file.mimetype === "application/pdf";
    const isDocx = ext === "docx" &&
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    isPdf || isDocx ? cb(null, true) : cb(null, false);
  },
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Try each label pattern in order; return first non-empty match trimmed.
 * labels: array of strings used as alternation inside (?:...)
 */
const extractField = (text, labels, postProcess = (v) => v) => {
  const pattern = new RegExp(
    `(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)`,
    "im",
  );
  const raw = text.match(pattern)?.[1]?.trim() || "";
  return raw ? postProcess(raw) : "";
};

/** slugify a string into a URL-safe handle */
const slugify = (str) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Upload a Buffer to Cloudinary; returns secure_url or null on failure */
const uploadBufferToCloudinary = (buffer, mimetype) =>
  new Promise((resolve) => {
    if (!isConfigured || !cloudinary) return resolve(null);

    const resourceType = mimetype.startsWith("image/") ? "image" : "raw";
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "unipack_products",
        public_id: `product-${randomUUID()}`,
        resource_type: resourceType,
      },
      (err, result) => {
        if (err || !result?.secure_url) {
          console.warn("Cloudinary upload failed:", err?.message);
          return resolve(null);
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });

/**
 * Extract embedded images from a DOCX buffer via mammoth.
 * Returns an array of Cloudinary URLs (or empty if Cloudinary unavailable).
 */
const extractDocxImages = async (buffer) => {
  try {
    const urls = [];
    await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (img) => {
          const imgBuffer = await img.read();
          const url = await uploadBufferToCloudinary(imgBuffer, img.contentType);
          if (url) urls.push(url);
          return { src: url || "" };
        }),
      },
    );
    return urls;
  } catch {
    return [];
  }
};

// ── POST /upload-parse ────────────────────────────────────────────────────────
router.post("/upload-parse", upload.single("document"), async (req, res) => {
  try {
    // ── 1. guard: file present ──────────────────────────────────────────────
    if (!req.file) {
      return res.status(400).json({
        message: "No document received. Upload a PDF or DOCX file.",
      });
    }

    // ── 2. guard: DB connected ──────────────────────────────────────────────
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: "Database is unavailable. Check the server's MongoDB connection.",
      });
    }

    // ── 3. validate body params ─────────────────────────────────────────────
    const { categoryId, subCategoryId, subSubCategoryId, type = "machine" } = req.body;

    if (!["machine", "sparepart"].includes(type)) {
      return res.status(400).json({ message: "type must be 'machine' or 'sparepart'." });
    }
    if (!mongoose.isValidObjectId(categoryId) || !mongoose.isValidObjectId(subCategoryId)) {
      return res.status(400).json({
        message: "Select a valid category and subcategory before uploading.",
      });
    }

    // ── 4. verify IDs exist in DB ───────────────────────────────────────────
    const [category, subCategory] = await Promise.all([
      Category.findOne({ _id: categoryId, type }),
      SubCategory.findOne({ _id: subCategoryId, category: categoryId, type }),
    ]);
    if (!category) {
      return res.status(404).json({ message: "Category not found for the given type." });
    }
    if (!subCategory) {
      return res.status(404).json({
        message: "Subcategory not found or does not belong to the selected category.",
      });
    }

    let subSubCategory = null;
    if (subSubCategoryId && mongoose.isValidObjectId(subSubCategoryId)) {
      subSubCategory = await SubSubCategory.findOne({
        _id: subSubCategoryId,
        category: category._id,
        subCategory: subCategory._id,
        type,
      });
      if (!subSubCategory) {
        return res.status(400).json({
          message: "Sub-subcategory does not belong to the selected category hierarchy.",
        });
      }
    }

    // ── 5. parse document text & images ────────────────────────────────────
    const isPdf = req.file.mimetype === "application/pdf";
    let text = "";
    let imageUrls = [];

    if (isPdf) {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || "";
      // PDFs: upload the whole file to Cloudinary as a raw asset for reference
      // (image extraction from PDFs requires heavy native deps — skip for now)
    } else {
      // DOCX: extract raw text + embedded images
      const [textResult, imgs] = await Promise.all([
        mammoth.extractRawText({ buffer: req.file.buffer }),
        extractDocxImages(req.file.buffer),
      ]);
      text = textResult.value || "";
      imageUrls = imgs;
    }

    if (!text.trim()) {
      return res.status(422).json({
        message: "No readable text found in the document. Make sure the file contains real text (not a scanned image).",
      });
    }

    // ── 6. regex field extraction ───────────────────────────────────────────
    //  Name
    const rawName =
      extractField(text, ["Product Name", "Machine Name", "Name"]) ||
      req.file.originalname.replace(/\.(pdf|docx)$/i, "").replace(/[-_]/g, " ").trim();

    //  Item code  — uppercase alphanumeric + dashes
    const rawCode = extractField(
      text,
      ["Item Code", "Part Code", "Code", "SKU", "Part No", "Model No"],
      (v) => v.replace(/\s+/g, "").toUpperCase(),
    );

    //  Price  — strip currency symbols and commas, keep digits
    const rawPrice = extractField(
      text,
      ["Price", "MRP", "Rate", "Unit Price"],
      (v) => v.replace(/[₹$€£,\s]/g, ""),
    );
    const price = rawPrice ? Number(rawPrice) : 0;

    //  Description — first 5000 chars of document (minus extracted header lines)
    const description = text.trim().slice(0, 5000);

    // ── 7. build slug — must be unique; append timestamp if collision ───────
    const baseSlug = slugify(rawName) || `product-${Date.now()}`;
    const existing = await Product.findOne({ slug: baseSlug });
    const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;

    // ── 8. fallback item code if nothing extracted ──────────────────────────
    const partCode = rawCode || `ITEM-${Date.now()}`;

    // ── 9. save to MongoDB ──────────────────────────────────────────────────
    const product = await Product.create({
      type,
      category:       category._id,
      subCategory:    subCategory._id,
      subSubCategory: subSubCategory?._id || null,
      name:           rawName,
      slug,
      partCode,
      price:          Number.isFinite(price) && price >= 0 ? price : 0,
      image:          imageUrls[0] || "",
      images:         imageUrls,
      description,
      inStock:        true,
    });

    // ── 10. populate refs for response ──────────────────────────────────────
    const savedProduct = await Product.findById(product._id)
      .populate("category")
      .populate("subCategory")
      .populate("subSubCategory");

    return res.status(201).json({
      success: true,
      message: `Product "${savedProduct.name}" parsed and saved to the database.`,
      product: savedProduct,
    });

  } catch (error) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Document is too large. Maximum allowed size is 10 MB." });
    }
    if (error.name === "MulterError") {
      return res.status(400).json({ message: "Unable to read the uploaded file." });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "A product with the same slug already exists. Rename the file and try again." });
    }

    console.error("Document parse error:", error);
    return res.status(500).json({
      message: "Failed to parse the document and save the product.",
      detail: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

export default router;
