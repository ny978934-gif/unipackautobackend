import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { MAX_IMPORT_ROWS, parseExcel, parseWordText } from "../routes/sparePartImportRoutes.js";
import {
  addSparePartDuplicateKeys,
  getSparePartDuplicateKeys,
  isSparePartDuplicate,
} from "../services/sparePartIdentity.js";

test("finds a spare-part table regardless of worksheet name", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Part Code", "Spare Image", "Price", "Stock Qty", "U.O.M."],
    ["Heating Element", "HE-01", "https://example.com/heater.jpg", 1250, 8, "piece"],
  ]);
  const otherWorksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Price", "Stock", "UOM"],
    ["Unrelated part", 99, 1, "piece"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Heating Elements");
  XLSX.utils.book_append_sheet(workbook, otherWorksheet, "Other Category");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [{
    name: "Heating Element",
    partCode: "HE-01",
    image: "https://example.com/heater.jpg",
    price: "1250",
    uom: "piece",
  }]);
});

test("detects case-insensitive headers with extra spaces", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Inventory export"],
      ["  pArT   nAmE  ", "  pRiCe  ", " U O M "],
      ["Roller", 100, "piece"],
    ]),
    "Unrelated Worksheet"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [
    { name: "Roller", price: "100", uom: "piece" },
  ]);
});

test("keeps non-empty rows without a part name so they count as failed imports", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name", "Price"], ["", 125]]),
    "Spare Parts"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [{ name: "", price: "125" }]);
});

test("parses an Excel workbook containing the full 5,000-part import limit", () => {
  const rows = [
    ["Part Name", "Price"],
    ...Array.from({ length: 5000 }, (_, index) => [`Part ${index + 1}`, index + 1]),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Spare Parts");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.equal(MAX_IMPORT_ROWS, 5000);
  assert.equal(parseExcel(buffer).length, MAX_IMPORT_ROWS);
});

test("normalizes names and part codes to detect duplicates consistently", () => {
  const existingKeys = new Set(getSparePartDuplicateKeys({
    name: "  Feed-Roller ",
    partCode: "FR 01",
  }));
  assert.equal(isSparePartDuplicate({ name: "feed roller" }, existingKeys), true);
  assert.equal(isSparePartDuplicate({ name: "Different part", partCode: "fr-01" }, existingKeys), true);
  assert.equal(isSparePartDuplicate({ name: "New part", partCode: "NP-01" }, existingKeys), false);
  addSparePartDuplicateKeys({ name: "New part", partCode: "NP-01" }, existingKeys);
  assert.equal(isSparePartDuplicate({ name: "new-part" }, existingKeys), true);
  assert.equal(isSparePartDuplicate({ name: "फीड रोलर" }, new Set(
    getSparePartDuplicateKeys({ name: "फीड-रोलर" })
  )), true);
});

test("chooses the matching sheet with the most recognized columns, then data rows", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name", "Price"], ["Less complete", 10], ["Also less complete", 20]]),
    "Selected category is not here"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Part Name", "Price", "UOM"],
      ["Most complete", 30, "piece"],
    ]),
    "Completely different name"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [
    { name: "Most complete", price: "30", uom: "piece" },
  ]);
});

test("uses the matching sheet with the most data rows when recognized columns tie", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name", "Price"], ["One row", 10]]),
    "First"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name", "Price"], ["Row one", 10], ["Row two", 20]]),
    "Second"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [
    { name: "Row one", price: "10" },
    { name: "Row two", price: "20" },
  ]);
});

test("rejects Excel files without a valid part-name table and data row", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name"], [""]]),
    "Spare Parts"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.throws(() => parseExcel(buffer), {
    message: "No spare-part table found. Please include a Part Name column and at least one data row.",
    status: 422,
  });
});

test("parses Word tables with field headings", () => {
  assert.deepEqual(
    parseWordText("Part Name\tSpare Image\tPrice\tStock\tUOM\nRoller\thttps://example.com/roller.jpg\t₹1,200\t5\tset"),
    [{
      name: "Roller",
      image: "https://example.com/roller.jpg",
      price: "₹1,200",
      uom: "set",
    }],
  );
});

test("parses Word paragraphs with labeled fields and multiple parts", () => {
  assert.deepEqual(
    parseWordText("Part Name: Belt\nSpare Image: https://example.com/belt.jpg\nPrice: 300\nUOM: piece\n\nPart Name: Gear\nPrice: 20"),
    [
      { name: "Belt", image: "https://example.com/belt.jpg", price: "300", uom: "piece" },
      { name: "Gear", price: "20" },
    ],
  );
});
