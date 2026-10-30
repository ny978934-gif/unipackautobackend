import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSparePartsQuotationEmail,
  buildQuoteRequestOwnerEmail,
  buildQuoteRequestConfirmationEmail,
  calculateQuotationTotals,
  createQuotationNumber,
  deliverEmailToRecipients,
  describeEmailFailure,
  formatINR,
  getEmailConfiguration,
  sendQuoteRequestNotification,
} from "../services/quoteNotification.js";
import { buildQuotationPdf } from "../services/quotePdf.js";

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
  assert.equal(config.to, "old-sender@example.com");
});

test("rejects partially configured Gmail credentials", () => {
  assert.throws(
    () => getEmailConfiguration({ GMAIL_USER: "quotes@unipackauto.in", ADMIN_EMAIL: "sales@unipackauto.in" }),
    /GMAIL_USER and GMAIL_APP_PASSWORD/
  );
});

test("sends Gmail notifications to SMTP_USER instead of ADMIN_EMAIL when configured", () => {
  const config = getEmailConfiguration({
    GMAIL_USER: "quotes@unipackauto.in",
    GMAIL_APP_PASSWORD: "abcdefghijklmnop",
    ADMIN_EMAIL: "sales@unipackauto.in",
    SMTP_USER: "owner@unipackauto.in",
  });
  assert.equal(config.to, "owner@unipackauto.in");
});

test("falls back to ADMIN_EMAIL when SMTP_USER is not configured", () => {
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

test("sends identical quotation content separately to the owner and customer", async () => {
  const sentMessages = [];
  const transporter = {
    async sendMail(message) {
      sentMessages.push(message);
      return { accepted: [message.to], messageId: `message-${sentMessages.length}` };
    },
  };
  const message = {
    from: "quotes@unipackauto.in",
    subject: "Unipackauto Spare Parts Quote",
    text: "Quotation details and totals",
    html: "<p>Quotation details and totals</p>",
  };

  const result = await deliverEmailToRecipients(transporter, message, [
    "sales@unipackauto.in",
    "customer@example.com",
  ]);

  assert.deepEqual(sentMessages, [
    { ...message, to: "sales@unipackauto.in" },
    { ...message, to: "customer@example.com" },
  ]);
  assert.deepEqual(result.accepted, ["sales@unipackauto.in", "customer@example.com"]);
  assert.equal(result.deliveries.length, 2);
});

test("deduplicates a customer who is also the configured quotation owner", async () => {
  const sentMessages = [];
  const transporter = {
    async sendMail(message) {
      sentMessages.push(message);
      return { accepted: [message.to] };
    },
  };

  await deliverEmailToRecipients(transporter, { subject: "Quote" }, [
    "sales@unipackauto.in",
    "SALES@UNIPACKAUTO.IN",
  ]);

  assert.equal(sentMessages.length, 1);
});

test("attempts delivery to both recipients and reports partial delivery failures", async () => {
  const attemptedRecipients = [];
  const transporter = {
    async sendMail(message) {
      attemptedRecipients.push(message.to);
      if (message.to === "customer@example.com") {
        throw Object.assign(new Error("Customer mailbox unavailable"), { code: "ECONNECTION" });
      }
      return { accepted: [message.to] };
    },
  };

  await assert.rejects(
    deliverEmailToRecipients(transporter, { subject: "Quote" }, [
      "sales@unipackauto.in",
      "customer@example.com",
    ]),
    (error) => {
      assert.equal(error.code, "RECIPIENT_DELIVERY_FAILED");
      assert.deepEqual(error.deliverySuccesses, ["sales@unipackauto.in"]);
      assert.match(describeEmailFailure(error), /customer@example\.com/);
      assert.match(describeEmailFailure(error), /SMTP server/);
      return true;
    }
  );
  assert.deepEqual(attemptedRecipients, ["sales@unipackauto.in", "customer@example.com"]);
});

test("builds a simple customer submission confirmation without request details or PDF links", () => {
  const email = buildQuoteRequestConfirmationEmail({
    id: "request-123",
    company: "Example Packaging",
    contactName: "A. Customer",
    email: "customer@example.com",
  });
  assert.equal(email.subject, "We received your spare parts quotation request");
  assert.match(email.text, /We have received the spare parts quotation request/);
  assert.match(email.text, /Request ID: request-123/);
  assert.doesNotMatch(email.text, /Grand Total|Discount|PDF|View or download/i);
  assert.doesNotMatch(email.html, /href=.*quotation|application\/pdf/i);
  assert.equal("attachments" in email, false);
});

test("builds a complete owner notification with customer and requested spare-part details", () => {
  const email = buildQuoteRequestOwnerEmail({
    id: "request-123",
    company: "Example Packaging",
    contactName: "A. Customer",
    email: "customer@example.com",
    phone: "+91 98765 43210",
    city: "Bhiwadi",
    state: "Rajasthan",
    message: "Please confirm availability.",
    parts: [{
      partName: "Feed roller",
      machine: "Wrapping Machine / UPA-100",
      itemCode: "FR-01",
      quantity: 3,
    }],
    attachment: {
      name: "machine-label.jpg",
      url: "https://files.example.com/machine-label.jpg",
    },
  });

  assert.match(email.subject, /New spare parts quotation request/);
  for (const value of [
    "request-123",
    "Example Packaging",
    "A. Customer",
    "customer@example.com",
    "+91 98765 43210",
    "Bhiwadi, Rajasthan",
    "Feed roller",
    "Wrapping Machine / UPA-100",
    "FR-01",
    "Quantity: 3",
    "Please confirm availability.",
    "machine-label.jpg",
    "https://files.example.com/machine-label.jpg",
  ]) {
    assert.ok(email.text.includes(value), `expected owner email to contain: ${value}`);
  }
  assert.doesNotMatch(email.text, /Grand Total|Discount|application\/pdf/i);
  assert.equal("attachments" in email, false);
});

test("rejects an invalid customer email before attempting SMTP delivery", async () => {
  await assert.rejects(
    sendQuoteRequestNotification({ quoteType: "sparePart", email: "not-an-email" }),
    { status: 400, message: "A valid customer email address is required for the quotation." }
  );
});

test("does not send new machine quote notifications", async () => {
  await assert.rejects(
    sendQuoteRequestNotification({ quoteType: "machine" }),
    /Only spare-part quote notifications are supported/
  );
});

test("retains custom SMTP configuration when Gmail credentials are not set", () => {
  const config = getEmailConfiguration({
    ADMIN_EMAIL: "sales@unipackauto.in",
    EMAIL_FROM: "quotes@unipackauto.in",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "sales@unipackauto.in",
    SMTP_PASS: "smtp-password",
  });

  assert.deepEqual(config.transport, {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "sales@unipackauto.in", pass: "smtp-password" },
  });
  assert.equal(config.to, "sales@unipackauto.in");
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

test("applies percentage and fixed discounts after GST", () => {
  const items = [{ name: "Part", quantity: 1, unitPrice: 200 }];
  const percentage = calculateQuotationTotals(items, { type: "percentage", value: 10 });
  assert.equal(percentage.subtotalPaise, 20000);
  assert.equal(percentage.gstPaise, 3600);
  assert.equal(percentage.grandTotalPaise, 23600);
  assert.equal(percentage.discountPaise, 2360);
  assert.equal(percentage.finalTotalPaise, 21240);

  const fixed = calculateQuotationTotals(items, { type: "fixed", value: 20 });
  assert.equal(fixed.discountPaise, 2000);
  assert.equal(fixed.finalTotalPaise, 21600);
});

test("final quotation email includes the discount and amount due without customer PDF links", () => {
  const quote = {
    id: "request-123",
    company: "Example Packaging",
    contactName: "A. Customer",
    email: "customer@example.com",
    phone: "+91 98765 43210",
    city: "Bhiwadi",
    state: "Rajasthan",
    parts: [],
  };
  const totals = calculateQuotationTotals(
    [{ name: "Feed roller", itemCode: "FR-01", quantity: 1, unitPrice: 200 }],
    { type: "percentage", value: 10 }
  );
  const email = buildSparePartsQuotationEmail(
    quote,
    totals,
    "UPK/Spare/Quote/Oct-26/request-123",
    new Date("2026-10-29T00:00:00.000Z")
  );

  assert.match(email.text, /Discount \(10%\): -₹23\.60/);
  assert.match(email.text, /Final Amount Due: ₹212\.40/);
  assert.match(email.html, /Discount \(10%\)/);
  assert.match(email.html, /Final Amount Due/);
  assert.doesNotMatch(email.text, /View or download|quotation PDF/i);
  assert.doesNotMatch(email.html, /View or download|quotation PDF/i);
  assert.equal("attachments" in email, false);
});

test("rejects discounts above the tax-inclusive total and percentages above 100", () => {
  const items = [{ name: "Part", quantity: 1, unitPrice: 200 }];
  assert.throws(
    () => calculateQuotationTotals(items, { type: "fixed", value: 236.01 }),
    /Discount cannot exceed the total including GST/
  );
  assert.throws(
    () => calculateQuotationTotals(items, { type: "percentage", value: 100.01 }),
    /Percentage discount cannot exceed 100%/
  );
});

test("generates a valid multi-page PDF with the complete discount breakdown", () => {
  const issuedAt = new Date("2026-10-12T12:00:00.000Z");
  const quote = {
    id: "507f1f77bcf86cd799439011",
    company: "Example Packaging",
    contactName: "A. Customer",
    email: "customer@example.com",
    phone: "+91 98765 43210",
    city: "Bhiwadi",
    state: "Rajasthan",
    quotation: { number: "UPK/Spare/Quote/Oct-26/d799439011", sentAt: issuedAt },
  };
  const items = Array.from({ length: 90 }, (_, index) => ({
    name: `Part ${index + 1}`,
    itemCode: `P-${index + 1}`,
    quantity: 1,
    unitPrice: 100,
  }));
  const totals = calculateQuotationTotals(items, { type: "percentage", value: 10 });
  const pdf = buildQuotationPdf(quote, totals);
  const content = pdf.toString("latin1");
  const startXref = Number(content.match(/startxref\n(\d+)/)?.[1]);
  assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-1.4"));
  assert.match(content, /\/Count [2-9]\d*/);
  assert.equal(pdf.subarray(startXref, startXref + 4).toString("ascii"), "xref");
  assert.match(content, /Subtotal: Rs 9,000\.00/);
  assert.match(content, /GST @ 18%: Rs 1,620\.00/);
  assert.match(content, /Discount \(10%\): Rs 1,062\.00/);
  assert.match(content, /FINAL AMOUNT DUE: Rs 9,558\.00/);
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
    "Discount",
    "Final Amount Due",
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
  assert.doesNotMatch(email.html, /View or download quotation PDF/);
  assert.doesNotMatch(email.text, /View or download your quotation PDF/);
  assert.equal("attachments" in email, false);
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
