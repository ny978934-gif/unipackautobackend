import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSparePartsQuotationEmail,
  calculateQuotationTotals,
  createQuotationNumber,
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

test("sends Gmail notifications to the separately configured admin address", () => {
  const config = getEmailConfiguration({
    GMAIL_USER: "quotes@unipackauto.in",
    GMAIL_APP_PASSWORD: "abcdefghijklmnop",
    ADMIN_EMAIL: "sales@unipackauto.in",
  });
  assert.equal(config.to, "sales@unipackauto.in");
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

  assert.deepEqual(config.transport, {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "smtp-user", pass: "smtp-password" },
  });
});

test("calculates item totals, subtotal, 18% GST, and grand total in integer paise", () => {
  const totals = calculateQuotationTotals([
    { name: "Feed roller", itemCode: "FR-01", quantity: 2, unitPrice: 2500 },
    { name: "Drive belt", itemCode: "DB-02", quantity: 2, unitPrice: 2500 },
  ]);

  assert.deepEqual(totals.items.map((item) => item.totalPaise), [500000, 500000]);
  assert.equal(totals.subtotalPaise, 1000000);
  assert.equal(totals.gstPaise, 180000);
  assert.equal(totals.grandTotalPaise, 1180000);
  assert.equal(formatINR(totals.subtotalPaise), "₹10,000.00");
  assert.equal(formatINR(totals.gstPaise), "₹1,800.00");
  assert.equal(formatINR(totals.grandTotalPaise), "₹11,800.00");
});

test("rounds unit prices to paise before multiplying quantities", () => {
  const totals = calculateQuotationTotals([
    { name: "Precision part", quantity: 3, unitPrice: 1.005 },
  ]);
  assert.equal(totals.items[0].unitPricePaise, 101);
  assert.equal(totals.subtotalPaise, 303);
  assert.equal(totals.gstPaise, 55);
  assert.equal(totals.grandTotalPaise, 358);
});

test("rounds fractional paise without shifting leading zeroes", () => {
  const totals = calculateQuotationTotals([
    { name: "Low-price part", quantity: 1, unitPrice: 0.004 },
  ]);
  assert.equal(totals.items[0].unitPricePaise, 0);
  assert.equal(totals.grandTotalPaise, 0);
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

test("builds the branded spare-parts quotation email with request details and supplied terms", () => {
  const issuedAt = new Date("2026-10-12T12:00:00.000Z");
  const quote = {
    id: "507f1f77bcf86cd799439011",
    company: "Example Packaging",
    contactName: "A. Customer",
    email: "customer@example.com",
    phone: "+91 98765 43210",
    city: "Bhiwadi",
    state: "Rajasthan",
    parts: [],
  };
  const items = [
    { name: "Feed roller", machine: "Wrapping Machine / UPA-100", quantity: 2, unitPrice: 2500 },
    { name: "Drive belt", machine: "Cartoning Machine", quantity: 1, unitPrice: 500 },
  ];
  const totals = calculateQuotationTotals(items);
  const quotationNumber = createQuotationNumber(quote.id, issuedAt);
  const email = buildSparePartsQuotationEmail(quote, totals, quotationNumber, issuedAt);

  assert.equal(quotationNumber, "UPK/Spare/Quote/Oct-26/d799439011");
  assert.equal(
    email.subject,
    `Unipackauto Spare Parts Quote - ${quotationNumber}`
  );
  for (const value of [
    "Spare Part Quotation",
    "Company: Example Packaging",
    "Email: customer@example.com",
    "Location: Bhiwadi, Rajasthan",
    "Request ID: 507f1f77bcf86cd799439011",
    "Contact: A. Customer",
    "Phone: +91 98765 43210",
    "Dear Sir/Madam,",
    "Please find below our offer for the required spare parts:",
    "12 October 2026",
    "GST: 18% Extra or as actual as per Govt. Norms .",
    "Freight Charges: Extra, as applicable.",
    "100% advance payment against the proforma invoice.",
    "UNIPACKAUTO INDIA PRIVATE LIMITED",
    "174405500608",
    "ICIC0001744",
    "9215521314, 7232001235, 9991226074",
    "info@unipackauto.in",
    "services.upa@gmail.com",
    "uniquepackagingandautomation@gmail.com",
  ]) {
    assert.ok(email.text.includes(value), `expected text email to contain: ${value}`);
  }
  for (const value of [
    "Example Packaging",
    "A. Customer",
    "customer@example.com",
    "+91 98765 43210",
    "Bhiwadi, Rajasthan",
    "12 October 2026",
    "UPK/Spare/Quote/Oct-26/d799439011",
    "Customer Details",
    "Spare Part Description",
    "Machine/Application",
    "Subtotal",
    "GST @ 18%",
    "Grand Total (Including GST)",
    "₹5,500.00",
    "₹990.00",
    "₹6,490.00",
    "UNIPACKAUTO INDIA PRIVATE LIMITED",
    "174405500608",
    "ICIC0001744",
    "Tapukera",
    "9215521314, 7232001235, 9991226074",
    "info@unipackauto.in",
    "services.upa@gmail.com",
    "uniquepackagingandautomation@gmail.com",
  ]) {
    assert.ok(email.html.includes(value), `expected HTML email to contain: ${value}`);
  }
  assert.ok(
    email.html.indexOf("Customer Details") < email.html.indexOf("Dear Sir/Madam,"),
    "customer details should appear before the greeting"
  );
  assert.ok(
    email.html.indexOf("Dear Sir/Madam,") < email.html.indexOf("Commercial Terms &amp; Conditions"),
    "the greeting and quotation should appear before the commercial terms"
  );
  assert.match(email.html, /<strong>GST:<\/strong> 18% Extra or as actual as per Govt\. Norms \./);
  assert.match(email.html, /<strong>Freight Charges:<\/strong> Extra, as applicable\./);
  assert.match(email.html, /<strong>Payment Terms:<\/strong> 100% advance payment against the proforma invoice\./);
  assert.match(email.html, /<strong>Dispatch:<\/strong> The spare parts will be dispatched after receipt of payment confirmation\./);
  assert.match(email.html, /<strong>Technical Support:<\/strong> Our technical team will contact you, if required, to discuss your requirements and provide further assistance\./);
});
