import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseExcel, parseWordText } from "../routes/sparePartImportRoutes.js";

test("finds a spare-part table regardless of worksheet name", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Spare Image", "Price", "Stock Qty", "U.O.M."],
    ["Heating Element", "https://example.com/heater.jpg", 1250, 8, "piece"],
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
