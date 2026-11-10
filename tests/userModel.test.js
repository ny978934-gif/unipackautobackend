import assert from "node:assert/strict";
import test from "node:test";
import User from "../models/User.js";
import Inquiry from "../models/Inquiry.js";
import QuoteRequest from "../models/QuoteRequest.js";

test("user accounts support unique IDs, activation, and soft deletion", () => {
  const user = new User({
    name: "Example Customer",
    email: "customer@example.com",
    userId: "upa-1234",
    passwordHash: "$2b$12$placeholder",
  });

  assert.equal(user.validateSync(), undefined);
  assert.equal(user.userId, "UPA-1234");
  assert.equal(user.status, "active");
  assert.equal(user.managedByAdmin, false);
  assert.equal(user.authVersion, 0);
  assert.equal(user.deletedAt, null);
  user.status = "disabled";
  assert.ok(user.validateSync().errors.status);
});

test("admin-managed accounts are distinguishable from public website accounts", () => {
  const user = new User({
    name: "Managed Customer",
    email: "managed@example.com",
    userId: "UPA-4321",
    passwordHash: "$2b$12$placeholder",
    managedByAdmin: true,
  });

  assert.equal(user.validateSync(), undefined);
  assert.equal(user.managedByAdmin, true);
});

test("legacy users without an assigned user ID remain valid for migration", () => {
  const user = new User({
    name: "Legacy Customer",
    email: "legacy@example.com",
    passwordHash: "scrypt$legacy$hash",
  });

  assert.equal(user.validateSync(), undefined);
});

test("inquiries and quote requests do not require user assignment", () => {
  const inquiry = new Inquiry({
    name: "Example Customer",
    email: "customer@example.com",
    message: "Please call me.",
  });
  const quote = new QuoteRequest({
    quoteType: "machine",
    company: "Example Packaging",
    contactName: "Example Customer",
    email: "customer@example.com",
    phone: "+91 98765 43210",
    city: "Bhiwadi",
    state: "Rajasthan",
    machineType: "Strapping machine",
    quantity: 1,
  });

  assert.equal(inquiry.validateSync(), undefined);
  assert.equal(quote.validateSync(), undefined);
  assert.equal(Inquiry.schema.path("assignedUser"), undefined);
  assert.equal(QuoteRequest.schema.path("assignedUser"), undefined);
});
