import nodemailer from "nodemailer";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rupeeFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const formatINR = (cents) => {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw invalidQuotation("Currency amount must be a non-negative integer number of paise.");
  }
  const wholeRupees = Math.floor(cents / 100);
  const paise = String(cents % 100).padStart(2, "0");
  return `₹${rupeeFormatter.format(wholeRupees)}.${paise}`;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const toCents = (value) => {
  const [mantissa, exponentText] = String(value).toLowerCase().split("e");
  const exponent = Number(exponentText || 0);
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`;
  const centsPosition = whole.length + exponent + 2;
  if (centsPosition >= digits.length) {
    return Number(digits + "0".repeat(centsPosition - digits.length));
  }
  if (centsPosition <= 0) return 0;
  const rounded = BigInt(digits.slice(0, centsPosition)) +
    (digits[centsPosition] >= "5" ? 1n : 0n);
  return Number(rounded);
};

const invalidQuotation = (message) => Object.assign(new Error(message), { status: 422 });

export const calculateQuotationTotals = (items) => {
  if (!Array.isArray(items) || !items.length) {
    throw invalidQuotation("A quotation must include at least one spare part.");
  }
  let subtotalCents = 0;
  const pricedItems = items.map((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) {
      throw invalidQuotation(`Part ${index + 1} quantity must be a whole number from 1 to 100,000.`);
    }
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw invalidQuotation(`Part ${index + 1} price must be a valid non-negative number.`);
    }
    const unitPriceCents = toCents(item.unitPrice);
    const totalCents = unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(unitPriceCents) || !Number.isSafeInteger(totalCents)) {
      throw invalidQuotation(`Part ${index + 1} total exceeds the supported amount.`);
    }
    subtotalCents += totalCents;
    if (!Number.isSafeInteger(subtotalCents)) {
      throw invalidQuotation("Quotation subtotal exceeds the supported amount.");
    }
    return { ...item, unitPriceCents, totalCents };
  });
  const gstCents = Number((BigInt(subtotalCents) * 18n + 50n) / 100n);
  const grossTotalCents = subtotalCents + gstCents;
  if (!Number.isSafeInteger(grossTotalCents)) {
    throw invalidQuotation("Quotation gross total exceeds the supported amount.");
  }
  return { items: pricedItems, subtotalCents, gstCents, grossTotalCents };
};

/**
 * Build a nodemailer transport config from environment variables.
 *
 * Priority:
 *   1. GMAIL_USER → use Gmail with its App Password when configured
 *   2. SMTP_HOST  → use generic SMTP when Gmail credentials are not configured
 *
 * Required env vars for SMTP:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, ADMIN_EMAIL
 *
 * Required env vars for Gmail shorthand:
 *   GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL
 */
export const getEmailConfiguration = (env = process.env) => {
  const adminEmail = env.ADMIN_EMAIL?.trim();
  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPassword = env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

  // Prefer Gmail explicitly configured with an App Password over any stale SMTP settings.
  if (gmailUser || gmailPassword) {
    if (!gmailUser || !gmailPassword) {
      throw new Error(
        "GMAIL_USER and GMAIL_APP_PASSWORD must both be set to use the Gmail shorthand."
      );
    }
    if (!emailPattern.test(gmailUser)) {
      throw new Error("GMAIL_USER must be a valid Gmail address.");
    }
    if (!adminEmail || !emailPattern.test(adminEmail)) {
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }
    if (gmailUser.toLowerCase() !== adminEmail.toLowerCase()) {
      throw new Error("GMAIL_USER and ADMIN_EMAIL must be the same address for Gmail notifications.");
    }
    return {
      transport: { service: "gmail", auth: { user: gmailUser, pass: gmailPassword } },
      from: gmailUser,
      to: gmailUser,
    };
  }

  // Use generic SMTP only if Gmail App Password credentials are absent.
  if (env.SMTP_HOST?.trim()) {
    const host   = env.SMTP_HOST.trim();
    const port   = Number(env.SMTP_PORT || 587);
    const secure = String(env.SMTP_SECURE || "").toLowerCase() === "true";
    const user   = env.SMTP_USER?.trim();
    const pass   = env.SMTP_PASS?.trim();
    const from   = env.EMAIL_FROM?.trim() || user;

    if (!adminEmail || !emailPattern.test(adminEmail)) {
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }
    if (!from || !emailPattern.test(from)) {
      throw new Error("EMAIL_FROM must be a valid email address.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be a number between 1 and 65,535.");
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error("SMTP_USER and SMTP_PASS must both be set (or both left empty).");
    }

    return {
      transport: {
        host,
        port,
        secure,
        ...(user && pass ? { auth: { user, pass } } : {}),
      },
      from,
      to: adminEmail,
    };
  }

  // Nothing configured.
  throw new Error(
    "Email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, and ADMIN_EMAIL to the server .env file."
  );
};

/**
 * Translate nodemailer / network errors into human-readable guidance.
 */
export const describeEmailFailure = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) {
    return (
      "Gmail rejected the password. Make sure SMTP_PASS (or GMAIL_APP_PASSWORD) is a " +
      "16-character App Password — not your Gmail login password. " +
      "Generate one at: myaccount.google.com → Security → 2-Step Verification → App passwords."
    );
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNREFUSED") {
    return (
      "Could not connect to the SMTP server. " +
      "For Gmail use port 465 with SMTP_SECURE=true, or port 587 with SMTP_SECURE=false. " +
      "Check that outbound SMTP is not blocked by your host or firewall."
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return (
      "Could not resolve the SMTP hostname. " +
      "Check SMTP_HOST is correct (smtp.gmail.com for Gmail) and the server has internet/DNS access."
    );
  }
  if (error?.message?.includes("not configured") || error?.message?.includes("must both be set")) {
    return `Email setup is incomplete: ${error.message}`;
  }
  return `Email delivery failed (${code || "unknown error"}): ${error?.message || "check server logs for details"}.`;
};

// ── helpers ───────────────────────────────────────────────────────────────────

const buildTransporter = () => {
  const config = getEmailConfiguration();
  return { config, transporter: nodemailer.createTransport(config.transport) };
};

const getQuoteSummary = (quote) => {
  if (quote.quoteType === "machine") {
    return [
      `Machine type : ${quote.machineType}`,
      `Model        : ${quote.model}`,
      `Quantity     : ${quote.quantity}`,
      `Specifications: ${quote.specifications || "Not provided"}`,
    ].join("\n");
  }
  return (quote.parts || []).map((part, i) => [
    `Part ${i + 1}     : ${part.partName}`,
    `Machine       : ${part.machine || "Not provided"}`,
    `Item code     : ${part.itemCode || "Not provided"}`,
    `Quantity      : ${part.quantity}`,
  ].join("\n")).join("\n\n");
};

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Verify SMTP credentials without sending a message.
 * Throws if the connection or auth fails.
 */
export async function verifyQuoteEmail() {
  const { config, transporter } = buildTransporter();
  await transporter.verify();
  return { recipient: config.to };
}

export async function sendCustomerQuotation(quote, items) {
  const totals = calculateQuotationTotals(items);
  const { config, transporter } = buildTransporter();
  const customerName = escapeHtml(quote.contactName);
  const rows = totals.items.map((item) => `
    <tr>
      <td style="padding:12px 10px;border-bottom:1px solid #e8e8e8;">${escapeHtml(item.name)}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #e8e8e8;">${escapeHtml(item.itemCode || "—")}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #e8e8e8;text-align:right;">${item.quantity}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #e8e8e8;text-align:right;white-space:nowrap;">${formatINR(item.unitPriceCents)}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #e8e8e8;text-align:right;white-space:nowrap;">${formatINR(item.totalCents)}</td>
    </tr>`).join("");
  const plainItems = totals.items.map((item) =>
    `${item.name} | ${item.itemCode || "—"} | ${item.quantity} | ${formatINR(item.unitPriceCents)} | ${formatINR(item.totalCents)}`
  );
  const info = await transporter.sendMail({
    from: `"UnipackAuto Quotations" <${config.from}>`,
    to: quote.email,
    replyTo: config.from,
    subject: `Your UnipackAuto spare parts quotation - ${String(quote.company || "").replace(/[\r\n]/g, " ")}`,
    text: [
      `Dear ${quote.contactName},`,
      "",
      "Thank you for your spare parts enquiry. Please find your quotation below.",
      "",
      "Spare Part | Item Code | Qty | Unit Price | Total",
      ...plainItems,
      "",
      `Subtotal (Before GST): ${formatINR(totals.subtotalCents)}`,
      `GST (18%): ${formatINR(totals.gstCents)}`,
      `Gross Total (Including GST): ${formatINR(totals.grossTotalCents)}`,
      "",
      "Prices are based on our current catalogue and are subject to confirmation.",
      "Regards,",
      "UnipackAuto Team",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f3f6;font-family:Arial,Helvetica,sans-serif;color:#29232b;">
  <div style="max-width:720px;margin:24px auto;padding:0 14px;">
    <div style="background:#66116f;color:#fff;padding:24px 26px;border-radius:12px 12px 0 0;">
      <div style="font-size:12px;letter-spacing:1.5px;opacity:.85;">UNIPACKAUTO · QUOTATION</div>
      <h1 style="font-size:23px;margin:10px 0 0;">Spare Parts Quotation</h1>
    </div>
    <div style="background:#fff;padding:24px 26px;border:1px solid #eee;border-top:0;">
      <p>Dear ${customerName},</p>
      <p>Thank you for your enquiry. Please find your current price breakdown below.</p>
      <p><strong>Company:</strong> ${escapeHtml(quote.company)}</p>
      <div style="overflow-x:auto;">
        <table role="table" style="width:100%;min-width:580px;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f7f2f8;text-align:left;">
            <th style="padding:12px 10px;">Spare Part Name</th><th style="padding:12px 10px;">Item Code</th>
            <th style="padding:12px 10px;text-align:right;">Qty</th><th style="padding:12px 10px;text-align:right;">Unit Price</th>
            <th style="padding:12px 10px;text-align:right;">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <table role="presentation" style="width:100%;max-width:380px;margin:20px 0 8px auto;border-collapse:collapse;">
        <tr><td style="padding:7px 0;color:#5b535d;">Subtotal (Before GST)</td><td style="padding:7px 0;text-align:right;white-space:nowrap;">${formatINR(totals.subtotalCents)}</td></tr>
        <tr><td style="padding:7px 0;color:#5b535d;">GST (18%)</td><td style="padding:7px 0;text-align:right;white-space:nowrap;">${formatINR(totals.gstCents)}</td></tr>
        <tr><td style="padding:13px 0;border-top:2px solid #66116f;font-weight:bold;font-size:16px;color:#66116f;">Gross Total (Including GST)</td><td style="padding:13px 0;border-top:2px solid #66116f;text-align:right;white-space:nowrap;font-weight:bold;font-size:18px;color:#66116f;">${formatINR(totals.grossTotalCents)}</td></tr>
      </table>
      <p style="font-size:12px;color:#777;">Prices are based on our current catalogue and are subject to confirmation.</p>
      <p style="margin-top:24px;">Regards,<br><strong>UnipackAuto Team</strong></p>
    </div>
    <div style="padding:14px 20px;color:#777;font-size:12px;text-align:center;">UnipackAuto · Packaging Automation Solutions</div>
  </div>
</body></html>`,
  });
  const accepted = (info.accepted || []).map((recipient) =>
    typeof recipient === "string" ? recipient : recipient.address
  );
  if (!accepted.some((recipient) => recipient?.toLowerCase() === quote.email.toLowerCase())) {
    const error = new Error("SMTP did not accept the customer quotation recipient.");
    error.code = "RECIPIENT_NOT_ACCEPTED";
    throw error;
  }
  return { ...totals, messageId: info.messageId, accepted };
}

export async function sendQuoteEmailTest() {
  const { config, transporter } = buildTransporter();
  const info = await transporter.sendMail({
    from: `"UnipackAuto Email Test" <${config.from}>`,
    to: config.to,
    subject: "UnipackAuto quote email delivery test",
    text: [
      "This is a test email from the UnipackAuto quote notification service.",
      `Recipient: ${config.to}`,
      "If you can read this, the SMTP server accepted the message.",
      "SMTP acceptance does not guarantee Inbox placement; check Spam, All Mail, filters, and the Sent folder.",
    ].join("\n"),
  });
  const accepted = (info.accepted || []).map((recipient) =>
    typeof recipient === "string" ? recipient : recipient.address
  );
  const recipientAccepted = accepted.some(
    (recipient) => recipient?.toLowerCase() === config.to.toLowerCase()
  );
  if (!recipientAccepted) {
    const error = new Error("SMTP did not accept the configured notification recipient.");
    error.code = "RECIPIENT_NOT_ACCEPTED";
    throw error;
  }
  return {
    recipient: config.to,
    messageId: info.messageId,
    response: info.response,
    accepted,
  };
}

/**
 * Send a new-quote-request notification email to the admin.
 */
export async function sendQuoteNotification(quote) {
  const { config, transporter } = buildTransporter();

  const subject =
    `New ${quote.quoteType === "machine" ? "machine" : "spare-part"} ` +
    `quote request from ${String(quote.company || "").replace(/[\r\n]/g, " ")}`;

  const body = [
    "A new quote request was submitted on the UnipackAuto website.",
    "",
    `Company  : ${quote.company}`,
    `Contact  : ${quote.contactName}`,
    `Email    : ${quote.email}`,
    `Phone    : ${quote.phone}`,
    `Location : ${quote.city}, ${quote.state}`,
    "",
    "── Requirement ──────────────────────────────",
    getQuoteSummary(quote),
    "",
    `Message  : ${quote.message || "Not provided"}`,
    `Attachment: ${quote.attachment?.url || "None"}`,
    "",
    `Request ID: ${quote.id}`,
    "",
    "Reply to this email to respond directly to the customer.",
  ].join("\n");

  const info = await transporter.sendMail({
    from: `"UnipackAuto Enquiries" <${config.from}>`,
    to: config.to,
    replyTo: quote.email,
    subject,
    text: body,
  });
  const accepted = (info.accepted || []).map((recipient) =>
    typeof recipient === "string" ? recipient : recipient.address
  );
  if (!accepted.some((recipient) => recipient?.toLowerCase() === config.to.toLowerCase())) {
    const error = new Error("SMTP did not accept the configured quote notification recipient.");
    error.code = "RECIPIENT_NOT_ACCEPTED";
    throw error;
  }
  return {
    messageId: info.messageId,
    response: info.response,
    accepted,
  };
}
