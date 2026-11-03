import assert from "node:assert/strict";
import test from "node:test";
import QuoteRequest from "../models/QuoteRequest.js";
import quoteRoutes, { validateQuote } from "../routes/quoteRoutes.js";

const contact = {
  company: "Example Packaging",
  contactName: "A. Customer",
  email: "customer@example.com",
  phone: "+91 98765 43210",
  city: "Bhiwadi",
  state: "Rajasthan",
};

test("quote request schema preserves existing machine quote details", () => {
  assert.ok(quoteRoutes);
  const request = new QuoteRequest({
    ...contact,
    quoteType: "machine",
    machineType: "Strapping machine",
    model: "UPA-100",
    quantity: 2,
  });
  assert.equal(request.validateSync(), undefined);
  assert.equal(request.status, "new");
  assert.equal(request.notificationStatus, "pending");
});

test("new quote submissions reject machine quote requests", () => {
  assert.throws(
    () => validateQuote({ quoteType: "machine" }),
    /Only spare-part quote requests are accepted/
  );
});

test("quote request schema validates spare part quantities and request status", () => {
  const request = new QuoteRequest({
    ...contact,
    quoteType: "sparePart",
    parts: [{
      machine: "Strapping / UPA-100",
      partName: "Feed roller",
      itemCode: "FR-01",
      productId: "507f1f77bcf86cd799439011",
      quantity: 3,
    }],
  });

  assert.equal(request.validateSync(), undefined);
  assert.equal(String(request.parts[0].productId), "507f1f77bcf86cd799439011");
  request.parts[0].quantity = 0;
  request.status = "awaiting";
  const validationError = request.validateSync();
  assert.ok(validationError.errors["parts.0.quantity"]);
  assert.ok(validationError.errors.status);
});

test("quotation snapshot and per-item discount amounts validate", () => {
  const request = new QuoteRequest({
    ...contact,
    quoteType: "sparePart",
    parts: [{
      machine: "Strapping / UPA-100",
      partName: "Feed roller",
      productId: "507f1f77bcf86cd799439011",
      quantity: 2,
    }],
    quotation: {
      items: [{
        name: "Feed roller",
        itemCode: "FR-01",
        machine: "Strapping / UPA-100",
        uom: "Rolls",
        quantity: 2,
        unitPricePaise: 250000,
        totalPaise: 500000,
        discountPercentage: 10,
        discountPaise: 50000,
        netTotalPaise: 450000,
      }],
      subtotalCents: 450000,
      gstCents: 81000,
      grossTotalCents: 531000,
      finalTotalCents: 531000,
    },
  });

  assert.equal(request.validateSync(), undefined);
  assert.equal(request.quotation.items[0].unitPricePaise, 250000);
  assert.equal(request.quotation.items[0].discountPercentage, 10);
  assert.equal(request.quotation.items[0].uom, "Rolls");
  assert.equal(request.quotation.items[0].netTotalPaise, 450000);
  assert.equal(request.quotation.finalTotalCents, 531000);
  request.quotation.items[0].discountPercentage = 101;
  assert.ok(request.validateSync().errors["quotation.items.0.discountPercentage"]);
});
