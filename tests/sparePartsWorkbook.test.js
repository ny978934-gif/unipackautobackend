import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import XLSX from "xlsx";
import { exportSpareParts } from "../controllers/productController.js";
import Product from "../models/Product.js";
import { createSparePartsWorkbook } from "../services/sparePartsWorkbook.js";

test("exports only the five spare-part fields", () => {
  const workbook = createSparePartsWorkbook([
    {
      category: { name: "Strapping Machine" },
      name: "Feed Roller",
      image: "",
      images: ["https://example.com/feed-roller.jpg"],
      price: 250,
      uom: "piece",
      stock: 4,
      partCode: "FR-1",
    },
  ]);

  assert.deepEqual(
    XLSX.utils.sheet_to_json(workbook.Sheets["Spare Parts"], { header: 1 }),
    [
      ["Machine Name", "Spare Part Name", "Spare Image", "Price", "UOM"],
      ["Strapping Machine", "Feed Roller", "https://example.com/feed-roller.jpg", 250, "piece"],
    ],
  );
});

test("keeps the five export columns when inventory is empty", () => {
  const workbook = createSparePartsWorkbook([]);

  assert.deepEqual(
    XLSX.utils.sheet_to_json(workbook.Sheets["Spare Parts"], { header: 1 }),
    [["Machine Name", "Spare Part Name", "Spare Image", "Price", "UOM"]],
  );
});

test("spare-part API serialization omits fields outside the spare-part contract", () => {
  const product = new Product({
    type: "sparepart",
    category: new mongoose.Types.ObjectId(),
    name: "Feed Roller",
    slug: "feed-roller",
    images: ["https://example.com/feed-roller.jpg"],
    partCode: "FR-1",
    stock: 4,
    description: "Legacy description",
    specifications: [{ label: "Size", value: "Small" }],
    compatibleMachines: ["Wrapper"],
    inStock: false,
  }).toJSON();

  assert.deepEqual(
    ["category", "name", "image", "price", "uom", "slug", "type"].filter((key) => key in product).length,
    7,
  );
  assert.equal(product.image, "https://example.com/feed-roller.jpg");
  for (const field of ["images", "subcategory", "partCode", "stock", "description", "specifications", "compatibleMachines", "inStock"]) {
    assert.equal(field in product, false, `${field} should not be serialized for spare parts`);
  }
});

test("rejects an invalid category filter on spare-part exports", async () => {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };

  await exportSpareParts({ query: { category: "not-an-id" } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "A valid spare-part category is required.");
});
