import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import XLSX from "xlsx";
import Category from "../models/Category.js";
import Product from "../models/Product.js";

const router = express.Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
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
  partCode: ["partcode", "itemcode", "code", "sku", "partno", "partnumber", "itemnumber"],
  price: ["price", "mrp", "rate", "unitprice", "sellingprice"],
  stock: ["stock", "stockqty", "stockquantity", "quantity", "qty", "availablequantity", "inventory"],
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
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
    return rows.map(mapRecord).filter((record) => Object.values(record).some(Boolean));
  });
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

const parseStock = (value, rowNumber) => {
  if (value === undefined || value === "") return { stock: 0, inStock: true };
  const normalized = String(value).trim().toLowerCase();
  if (["in stock", "available", "yes", "true"].includes(normalized)) return { stock: 1, inStock: true };
  if (["out of stock", "unavailable", "no", "false"].includes(normalized)) return { stock: 0, inStock: false };
  const stock = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
    const error = new Error(`Row ${rowNumber}: stock must be a non-negative whole number or availability value.`);
    error.status = 422;
    throw error;
  }
  return { stock, inStock: stock > 0 };
};

const slugify = (value) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "spare-part";

router.post("/upload-parse", upload.single("file"), async (req, res) => {
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

    const existingSlugs = new Set(
      (await Product.find({ type: "sparepart" }).select("slug").lean()).map((item) => item.slug)
    );
    const timestamp = Date.now();
    const productsToSave = parsedRecords.map((record, index) => {
      const rowNumber = index + 2;
      const name = record.name?.trim();
      if (!name) {
        const error = new Error(`Row ${rowNumber}: part name is required.`);
        error.status = 422;
        throw error;
      }
      const priceText = (record.price || "").replace(/[₹$€£,\s]/g, "");
      const price = priceText ? Number(priceText) : 0;
      if (!Number.isFinite(price) || price < 0) {
        const error = new Error(`Row ${rowNumber}: price must be a non-negative number.`);
        error.status = 422;
        throw error;
      }
      const { stock, inStock } = parseStock(record.stock, rowNumber);
      const baseSlug = slugify(record.partCode ? `${name}-${record.partCode}` : name);
      let slug = baseSlug;
      let suffix = 1;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${timestamp}-${suffix++}`;
      }
      existingSlugs.add(slug);

      return {
        type: "sparepart",
        category: category._id,
        name,
        slug,
        partCode: record.partCode?.trim() || "",
        price,
        stock,
        inStock,
        uom: record.uom?.trim() || "",
      };
    });

    const inserted = await Product.insertMany(productsToSave);
    const products = await Product.find({ _id: { $in: inserted.map((item) => item._id) } })
      .populate("category")
      .sort({ createdAt: -1 });
    return res.status(201).json({
      success: true,
      message: `Imported ${products.length} spare part${products.length === 1 ? "" : "s"}.`,
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