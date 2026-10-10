import assert from "node:assert/strict";
import test from "node:test";
import QuoteRequest from "../models/QuoteRequest.js";
import quoteRoutes from "../routes/quoteRoutes.js";

const contact = {
  company: "Example Packaging",
  contactName: "A. Customer",
  email: "customer@example.com",
  phone: "+91 98765 43210",
  city: "Bhiwadi",
  state: "Rajasthan",
};

test("quote request schema defaults new requests and stores machine details", () => {
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

test("quote request schema validates spare part quantities and request status", () => {
  const request = new QuoteRequest({
    ...contact,
    quoteType: "sparePart",
    parts: [{
      machine: "Strapping / UPA-100",
      partName: "Feed roller",
      itemCode: "FR-01",
      quantity: 3,
    }],
  });

  assert.equal(request.validateSync(), undefined);
  request.parts[0].quantity = 0;
  request.status = "awaiting";
  const validationError = request.validateSync();
  assert.ok(validationError.errors["parts.0.quantity"]);
  assert.ok(validationError.errors.status);
});
