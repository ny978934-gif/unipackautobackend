import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseExcel, parseWordText } from "../routes/sparePartImportRoutes.js";

test("maps Excel headers and rows into spare part fields", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Part Name", "Part Code", "Price", "Stock Qty", "U.O.M."],
    ["Heating Element", "HE-22", 1250, 8, "piece"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Spare Parts");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  assert.deepEqual(parseExcel(buffer), [{
    name: "Heating Element",
    partCode: "HE-22",
    price: "1250",
    stock: "8",
    uom: "piece",
  }]);
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
