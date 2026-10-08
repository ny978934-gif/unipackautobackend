import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseExcel, parseWordText } from "../routes/sparePartImportRoutes.js";

test("maps the selected category's matching Excel sheet into spare part fields", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Part Code", "Price", "Stock Qty", "U.O.M."],
    ["Heating Element", "HE-22", 1250, 8, "piece"],
  ]);
  const otherWorksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Price", "Stock", "UOM"],
    ["Unrelated part", 99, 1, "piece"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Heating Elements");
  XLSX.utils.book_append_sheet(workbook, otherWorksheet, "Other Category");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer, "Heating Elements"), [{
    name: "Heating Element",
    partCode: "HE-22",
    price: "1250",
    stock: "8",
    uom: "piece",
  }]);
});

test("matches Excel sheets without case or punctuation differences", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name", "Price"], ["Roller", 100]]),
    "Hydraulic_Pump Parts"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer, "hydraulic pump parts"), [
    { name: "Roller", price: "100" },
  ]);
});

test("rejects Excel files without a sheet matching the selected category", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Part Name"], ["Roller"]]),
    "Spare Parts"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.throws(() => parseExcel(buffer, "Hydraulic Pump"), {
    message: 'No worksheet matches the selected category "Hydraulic Pump".',
    status: 422,
  });
});

test("parses Word tables with field headings", () => {
  assert.deepEqual(
    parseWordText("Part Name\tPart Code\tPrice\tStock\tUOM\nRoller\tRL-7\t₹1,200\t5\tset"),
    [{
      name: "Roller",
      partCode: "RL-7",
      price: "₹1,200",
      stock: "5",
      uom: "set",
    }],
  );
});

test("parses Word paragraphs with labeled fields and multiple parts", () => {
  assert.deepEqual(
    parseWordText("Part Name: Belt\nPart Code: BT-1\nPrice: 300\nUOM: piece\n\nPart Name: Gear\nPart Code: GR-2"),
    [
      { name: "Belt", partCode: "BT-1", price: "300", uom: "piece" },
      { name: "Gear", partCode: "GR-2" },
    ],
  );
});
