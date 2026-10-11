import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateQuotationTotals,
  describeEmailFailure,
  formatINR,
  getEmailConfiguration,
} from "../services/quoteNotification.js";

test("configures Gmail notifications and removes spaces from grouped app passwords", () => {
  const config = getEmailConfiguration({
    GMAIL_USER: "quotes@unipackauto.in",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    ADMIN_EMAIL: "quotes@unipackauto.in",
    SMTP_HOST: "smtp.old-provider.example",
    SMTP_USER: "old-sender@example.com",
    SMTP_PASS: "old-password",
  });

  assert.deepEqual(config.transport, {
    service: "gmail",
    auth: { user: "quotes@unipackauto.in", pass: "abcdefghijklmnop" },
  });
  assert.equal(config.from, "quotes@unipackauto.in");
  assert.equal(config.to, "quotes@unipackauto.in");
});

test("rejects partially configured Gmail credentials", () => {
  assert.throws(
    () => getEmailConfiguration({ GMAIL_USER: "quotes@unipackauto.in", ADMIN_EMAIL: "sales@unipackauto.in" }),
    /GMAIL_USER and GMAIL_APP_PASSWORD/
  );
});

test("rejects a Gmail recipient that differs from the sending Gmail account", () => {
  assert.throws(
    () => getEmailConfiguration({
      GMAIL_USER: "quotes@unipackauto.in",
      GMAIL_APP_PASSWORD: "abcdefghijklmnop",
      ADMIN_EMAIL: "sales@unipackauto.in",
    }),
    /GMAIL_USER and ADMIN_EMAIL must be the same/
  );
});

test("retains custom SMTP configuration when Gmail credentials are not set", () => {
  const config = getEmailConfiguration({
    ADMIN_EMAIL: "sales@unipackauto.in",
    EMAIL_FROM: "quotes@unipackauto.in",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-password",
  });

  test("gives actionable guidance for common Gmail authentication and VPS network failures", () => {
    assert.match(
      describeEmailFailure(Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 })),
      /App Password/
    );
    assert.match(
      describeEmailFailure(Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" })),
      /outbound SMTP/
    );
  });

  assert.deepEqual(config.transport, {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "smtp-user", pass: "smtp-password" },
  });
});

test("calculates item totals, subtotal, 18% GST, and gross total in integer cents", () => {
  const totals = calculateQuotationTotals([
    { name: "Feed roller", itemCode: "FR-01", quantity: 2, unitPrice: 2500 },
    { name: "Drive belt", itemCode: "DB-02", quantity: 2, unitPrice: 2500 },
  ]);

  assert.deepEqual(totals.items.map((item) => item.totalCents), [500000, 500000]);
  assert.equal(totals.subtotalCents, 1000000);
  assert.equal(totals.gstCents, 180000);
  assert.equal(totals.grossTotalCents, 1180000);
  assert.equal(formatINR(totals.subtotalCents), "₹10,000.00");
  assert.equal(formatINR(totals.gstCents), "₹1,800.00");
  assert.equal(formatINR(totals.grossTotalCents), "₹11,800.00");
});

test("rounds unit prices to paise before multiplying quantities", () => {
  const totals = calculateQuotationTotals([
    { name: "Precision part", quantity: 3, unitPrice: 1.005 },
  ]);
  assert.equal(totals.items[0].unitPriceCents, 101);
  assert.equal(totals.subtotalCents, 303);
  assert.equal(totals.gstCents, 55);
  assert.equal(totals.grossTotalCents, 358);
});

test("rounds fractional paise without shifting leading zeroes", () => {
  const totals = calculateQuotationTotals([
    { name: "Low-price part", quantity: 1, unitPrice: 0.004 },
  ]);
  assert.equal(totals.items[0].unitPriceCents, 0);
  assert.equal(totals.grossTotalCents, 0);
});

test("rejects invalid quotation quantities and prices", () => {
  assert.throws(
    () => calculateQuotationTotals([{ name: "Part", quantity: 0, unitPrice: 10 }]),
    /quantity must be a whole number/
  );
  assert.throws(
    () => calculateQuotationTotals([{ name: "Part", quantity: 1, unitPrice: -1 }]),
    /price must be a valid non-negative number/
  );
});
