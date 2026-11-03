import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import XLSX from "xlsx";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import {
  addSparePartDuplicateKeys,
  getSparePartDuplicateKeys,
  isSparePartDuplicate,
} from "../services/sparePartIdentity.js";

const router = express.Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const allowedMimeTypes = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    if (!["doc", "docx", "xls", "xlsx"].includes(extension) || !allowedMimeTypes.has(file.mimetype)) {
      const error = new Error("Only Word (.doc, .docx) and Excel (.xls, .xlsx) files are accepted.");
      error.status = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

const headerAliases = {
  name: ["name", "partname", "sparepartname", "productname", "itemname"],
  partCode: ["partcode", "itemcode", "code", "sku"],
  image: ["image", "spareimage", "imageurl", "photo", "photourl"],
  price: ["price", "mrp", "rate", "unitprice", "sellingprice"],
  uom: ["uom", "unit", "unitofmeasure", "unitmeasure", "measure"],
};
const normalizeHeader = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const headerFor = (value) => {
  const normalized = normalizeHeader(value);
  return Object.entries(headerAliases).find(([, aliases]) => aliases.includes(normalized))?.[0];
};

const mapRecord = (record) => Object.entries(record).reduce((mapped, [key, value]) => {
  const field = headerFor(key);
  if (field && value !== undefined && value !== null) mapped[field] = String(value).trim();
  return mapped;
}, {});

export const parseExcel = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const candidates = workbook.SheetNames.flatMap((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    });
    return rows.flatMap((headerRow, headerIndex) => {
      const columns = headerRow.reduce((recognized, header, columnIndex) => {
        const field = headerFor(header);
        if (field && !recognized.has(field)) recognized.set(field, columnIndex);
        return recognized;
      }, new Map());
      if (!columns.has("name")) return [];

      const records = rows.slice(headerIndex + 1).map((row) => {
        const record = {};
        for (const [field, columnIndex] of columns) {
          const value = row[columnIndex];
          if (value !== undefined && value !== null) record[field] = String(value).trim();
        }
        return record;
      }).filter((record) => Object.values(record).some(Boolean));

      return records.length
        ? [{ recognizedColumnCount: columns.size, records }]
        : [];
    });
  });
  if (!candidates.length) {
    const error = new Error("No spare-part table found. Please include a Part Name column and at least one data row.");
    error.status = 422;
    throw error;
  }

  candidates.sort((left, right) =>
    right.recognizedColumnCount - left.recognizedColumnCount ||
    right.records.length - left.records.length
  );
  return candidates[0].records;
};

export const parseWordText = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const tableRows = lines.map((line) =>
    line.includes("\t") ? line.split("\t").map((cell) => cell.trim()) :
      line.includes("|") ? line.split("|").map((cell) => cell.trim()) : null
  );
  const headerRowIndex = tableRows.findIndex((cells) => cells && cells.filter((cell) => headerFor(cell)).length >= 2);
  if (headerRowIndex >= 0) {
    const headers = tableRows[headerRowIndex];
    return tableRows.slice(headerRowIndex + 1)
      .filter((cells) => cells && cells.some(Boolean))
      .map((cells) => mapRecord(Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]))));
  }

  const labelledRecords = [];
  let current = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:\t]+)\s*:\s*(.*?)\s*$/);
    if (!match) {
      if (Object.keys(current).length && !line.trim()) {
        labelledRecords.push(current);
        current = {};
      }
      continue;
    }
    const field = headerFor(match[1]);
    if (!field) continue;
    if (field === "name" && current.name) {
      labelledRecords.push(current);
      current = {};
    }
    current[field] = match[2];
  }
  if (Object.keys(current).length) labelledRecords.push(current);
  return labelledRecords;
};

const parseWord = async (buffer, extension) => {
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return parseWordText(result.value || "");
  }
  const document = await new WordExtractor().extract(buffer);
  return parseWordText(document.getBody());
};

const slugify = (value) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "spare-part";

router.post("/upload-parse", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Choose a Word (.doc, .docx) or Excel (.xls, .xlsx) file." });
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database is unavailable. Try again when the server reconnects." });
    }

    const { categoryId } = req.body;
    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({ message: "Select a valid main spare part category." });
    }
    const category = await Category.findOne({ _id: categoryId, type: "sparepart" });
    if (!category) return res.status(404).json({ message: "Main spare part category was not found." });

    const extension = req.file.originalname.split(".").pop()?.toLowerCase();
    let parsedRecords;
    try {
      parsedRecords = ["xls", "xlsx"].includes(extension)
        ? parseExcel(req.file.buffer)
        : await parseWord(req.file.buffer, extension);
    } catch (error) {
      error.status = 422;
      throw error;
    }
    if (!parsedRecords.length) {
      return res.status(422).json({ message: "No spare part rows found. Include column headings and at least one data row." });
    }
    if (parsedRecords.length > MAX_IMPORT_ROWS) {
      return res.status(413).json({ message: `An import may contain at most ${MAX_IMPORT_ROWS} spare parts.` });
    }

    const existingProducts = await Product.find({ type: "sparepart" })
      .select("category name partCode slug")
      .lean();
    const existingSlugs = new Set(existingProducts.map((item) => item.slug));
    const categoryDuplicateKeys = new Set();
    existingProducts
      .filter((item) => String(item.category) === String(category._id))
      .forEach((item) => addSparePartDuplicateKeys(item, categoryDuplicateKeys));
    const timestamp = Date.now();
    const productsToSave = [];
    const failedItems = [];
    let duplicateCount = 0;
    parsedRecords.forEach((record, index) => {
      const rowNumber = index + 2;
      const name = record.name?.trim();
      if (!name) {
        failedItems.push({ row: rowNumber, name: "", reason: "Part name is required." });
        return;
      }
      if (name.length > 150) {
        failedItems.push({ row: rowNumber, name, reason: "Part name must be 150 characters or fewer." });
        return;
      }
      const priceText = (record.price || "").replace(/[₹$€£,\s]/g, "");
      const price = priceText ? Number(priceText) : 0;
      if (!Number.isFinite(price) || price < 0) {
        failedItems.push({ row: rowNumber, name, reason: "Price must be a non-negative number." });
        return;
      }
      const partCode = record.partCode?.trim() || "";
      if (partCode.length > 100) {
        failedItems.push({ row: rowNumber, name, reason: "Part code must be 100 characters or fewer." });
        return;
      }
      if (isSparePartDuplicate({ name, partCode }, categoryDuplicateKeys)) {
        duplicateCount += 1;
        return;
      }
      const baseSlug = slugify(name);
      let slug = baseSlug;
      let suffix = 1;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${timestamp}-${suffix++}`;
      }
      existingSlugs.add(slug);
      addSparePartDuplicateKeys({ name, partCode }, categoryDuplicateKeys);

      productsToSave.push({
        type: "sparepart",
        category: category._id,
        name,
        slug,
        partCode,
        image: record.image?.trim() || "",
        images: record.image?.trim() ? [record.image.trim()] : [],
        price,
        uom: record.uom?.trim() || "",
      });
    });

    const inserted = productsToSave.length
      ? await Product.insertMany(productsToSave, { ordered: false })
      : [];
    const products = await Product.find({ _id: { $in: inserted.map((item) => item._id) } })
      .select("_id type name image images price uom")
      .populate("category", "name slug")
      .sort({ createdAt: -1 });
    const counts = {
      imported: products.length,
      duplicate: duplicateCount,
      failed: failedItems.length,
      total: parsedRecords.length,
    };
    return res.status(201).json({
      success: true,
      message: `Imported ${counts.imported}; skipped ${counts.duplicate} duplicate${counts.duplicate === 1 ? "" : "s"}; failed ${counts.failed}.`,
      counts,
      failedItems: failedItems.slice(0, 50),
      products,
      category: { _id: category._id, name: category.name, slug: category.slug },
    });
  } catch (error) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 500;
    if (status >= 500) console.error("Spare part document import failed:", error);
    return res.status(status).json({
      message: error.code === "LIMIT_FILE_SIZE"
        ? "File is too large. Maximum allowed size is 10 MB."
        : error.message || "Unable to parse and import this file.",
    });
  }
});

export default router;