import nodemailer from "nodemailer";

// ── Number helpers ─────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Format an integer number of paise as ₹X,XX,XXX.XX. */
export const formatINR = (amountInPaise) => {
  if (!Number.isSafeInteger(amountInPaise) || amountInPaise < 0) {
    throw Object.assign(
      new Error("Currency amount must be a non-negative integer (paise)."),
      { status: 422 }
    );
  }
  const rupees = Math.floor(amountInPaise / 100);
  const paiseStr = String(amountInPaise % 100).padStart(2, "0");
  return `\u20B9${INR.format(rupees)}.${paiseStr}`;
};

/** Convert a JS float price (rupees) to integer paise without float drift */
const toPaise = (value) => {
  const [mantissa = "", expText = "0"] = String(value).toLowerCase().split("e");
  const exp = Number(expText);
  const [whole = "", frac = ""] = mantissa.split(".");
  const digits = whole + frac;
  const paisePos = whole.length + exp + 2;          // position of paise decimal point
  if (paisePos >= digits.length) {
    return Number(digits + "0".repeat(paisePos - digits.length));
  }
  if (paisePos <= 0) return 0;
  const rounded =
    BigInt(digits.slice(0, paisePos)) +
    (digits[paisePos] >= "5" ? 1n : 0n);
  return Number(rounded);
};

// ── Price calculation ─────────────────────────────────────────────────────────

/**
 * items  – array of { name, itemCode, quantity, unitPrice (rupees float) }
 * Returns item and aggregate amounts as integer paise.
 */
export const calculateQuotationTotals = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(
      new Error("A quotation must include at least one spare part."),
      { status: 422 }
    );
  }

  let subtotalPaise = 0;

  const priced = items.map((item, i) => {
    const qty = item.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) {
      throw Object.assign(
        new Error(`Part ${i + 1}: quantity must be a whole number from 1 to 100,000.`),
        { status: 422 }
      );
    }
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw Object.assign(
        new Error(`Part ${i + 1}: unit price must be a valid non-negative number.`),
        { status: 422 }
      );
    }

    const unitPricePaise = toPaise(item.unitPrice);
    const totalPaise = unitPricePaise * qty;

    if (!Number.isSafeInteger(unitPricePaise) || !Number.isSafeInteger(totalPaise)) {
      throw Object.assign(
        new Error(`Part ${i + 1}: amount exceeds the supported limit.`),
        { status: 422 }
      );
    }

    subtotalPaise += totalPaise;
    if (!Number.isSafeInteger(subtotalPaise)) {
      throw Object.assign(
        new Error("Quotation subtotal exceeds the supported limit."),
        { status: 422 }
      );
    }

    return { ...item, unitPricePaise, totalPaise };
  });

  // GST 18 % — round half-up using integer arithmetic
  const gstPaise = Number((BigInt(subtotalPaise) * 18n + 50n) / 100n);
  const grandTotalPaise = subtotalPaise + gstPaise;

  if (!Number.isSafeInteger(grandTotalPaise)) {
    throw Object.assign(
      new Error("Quotation grand total exceeds the supported limit."),
      { status: 422 }
    );
  }

  return { items: priced, subtotalPaise, gstPaise, grandTotalPaise };
};

// ── HTML helpers ──────────────────────────────────────────────────────────────

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const COL_STYLE  = "padding:11px 12px;border-bottom:1px solid #ede8f0;font-size:13px;";
const HEAD_STYLE = "padding:11px 12px;background:#f7f2f8;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#4a1155;";

const formatQuotationDate = (date) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);

export const createQuotationNumber = (requestId, date = new Date()) => {
  if (!requestId) throw new Error("A saved quote request ID is required for the quotation number.");
  const monthYear = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date).replace(" ", "-");
  return `UPK/Spare/Quote/${monthYear}/${requestId}`;
};

const commercialTerms = [
  "GST: 18% Extra or as actual as per Govt. Norms .",
  "Freight Charges: Extra, as applicable.",
  "Payment Terms: 100% advance payment against the proforma invoice.",
  "Dispatch: The spare parts will be dispatched after receipt of payment confirmation.",
  "Technical Support: Our technical team will contact you, if required, to discuss your requirements and provide further assistance.",
];

const bankDetails = [
  ["Account Holder's Name", "UNIPACKAUTO INDIA PRIVATE LIMITED"],
  ["Bank Name", "ICICI Bank"],
  ["Current Account No.", "174405500608"],
  ["Branch", "Tapukera"],
  ["IFSC Code", "ICIC0001744"],
];

export const buildSparePartsQuotationEmail = (quote, totals, quotationNumber, issuedAt = new Date()) => {
  const date = formatQuotationDate(issuedAt);
  const subject = `UnipackAuto – Spare Parts Quote – ${quotationNumber}`;

  // ── Plain text ────────────────────────────────────────────────────────────────
  const textLines = [
    `Quotation No.: ${quotationNumber}`,
    "Unipackauto India Pvt. Ltd.",
    "",
    "                        SPARE PART QUOTATION",
    "",
    `Date             : ${date}`,
    `Company Name     : ${quote.company}`,
    `Email            : ${quote.email}`,
    `Location         : ${quote.city}, ${quote.state}`,
    `Request ID       : ${quote.id}`,
    `Contact Person   : ${quote.contactName}`,
    `Phone            : ${quote.phone}`,
    "",
    "Dear Sir/Madam,",
    "",
    "Thank you for your enquiry regarding spare parts.",
    "We are pleased to submit our quotation as follows:",
    "",
    "Spare Part Quotation",
    "─────────────────────────────────────────────────────────────────────────────",
    "S.No. | Spare Part Description | Machine | Item Code | Qty | Unit Price | Total",
    "─────────────────────────────────────────────────────────────────────────────",
    ...totals.items.map((item, i) =>
      `${i + 1}. ${item.name} | ${item.machine || "—"} | ${item.itemCode || "—"} | ${item.quantity} | ${item.unitPrice > 0 ? formatINR(item.unitPricePaise) : "On request"} | ${item.unitPrice > 0 ? formatINR(item.totalPaise) : "—"}`
    ),
    "─────────────────────────────────────────────────────────────────────────────",
    `Subtotal                                                  : ${formatINR(totals.subtotalPaise)}`,
    `GST @ 18%                                                 : ${formatINR(totals.gstPaise)}`,
    `Grand Total (Including GST)                               : ${formatINR(totals.grandTotalPaise)}`,
    "",
    "Commercial Terms & Conditions:",
    ...commercialTerms.map((term, i) => `  ${i + 1}. ${term}`),
    "",
    "Bank Details for Payment:",
    ...bankDetails.map(([label, value]) => `  ${label.padEnd(30)}: ${value}`),
    "",
    "Kindly arrange the payment to enable us to process your order and dispatch the spare parts.",
    "For any further assistance, please feel free to contact our team.",
    "We look forward to your valuable order and assure you of our best services.",
    "",
    "Best regards,",
    "Spare Parts Division",
    "Unipackauto India Pvt. Ltd.",
    "Phone: 9215521314 | 7232001235 | 9991226074",
    "Email: info@unipackauto.in | services.upa@gmail.com | uniquepackagingandautomation@gmail.com",
  ];
  if (quote.message) {
    textLines.splice(textLines.indexOf("Dear Sir/Madam,"), 0, `Customer Message: ${quote.message}`, "");
  }
  if (quote.attachment?.url) textLines.push(`Attachment: ${quote.attachment.url}`);

  // ── HTML ──────────────────────────────────────────────────────────────────────
  const termsHtml = commercialTerms.map((term) => {
    const sep = term.indexOf(":");
    return `<li style="margin:0 0 8px 0;line-height:1.55;"><strong>${esc(term.slice(0, sep + 1))}</strong>${esc(term.slice(sep + 1))}</li>`;
  }).join("");

  const bankHtml = bankDetails.map(([label, value]) =>
    `<tr>
      <td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap;">${esc(label)}</td>
      <td style="padding:6px 0;font-weight:600;">${esc(value)}</td>
    </tr>`
  ).join("");

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:600px){.hide-mobile{display:none!important}.full-width{width:100%!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f0edf2;font-family:Arial,Helvetica,sans-serif;color:#25232a;">
<div style="max-width:820px;margin:24px auto;padding:0 12px;">
<div style="border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(30,10,40,.10);">

  <!-- ── TOP HEADER ── -->
  <header style="background:#66116f;padding:28px 32px 22px;text-align:center;">
    <div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#e8d0ec;margin-bottom:4px;">
      Unipackauto India Pvt. Ltd.
    </div>
    <!-- Quotation Number centered -->
    <div style="display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);
      border-radius:6px;padding:5px 18px;font-size:13px;color:#f5e6f7;letter-spacing:.5px;margin-bottom:14px;">
      ${esc(quotationNumber)}
    </div>
    <!-- Main heading -->
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff;letter-spacing:-.3px;">
      Spare Part Quotation
    </h1>
    <div style="margin-top:8px;font-size:13px;color:#e0c8e4;">Date: ${esc(date)}</div>
  </header>

  <!-- ── CUSTOMER DETAILS ── -->
  <div style="background:#fff;padding:24px 32px 18px;">
    <table role="presentation" cellspacing="0" cellpadding="0"
      style="width:100%;border-collapse:collapse;font-size:13.5px;">
      <tr>
        <td style="padding:7px 14px 7px 0;color:#888;width:160px;white-space:nowrap;">Company Name</td>
        <td style="padding:7px 14px 7px 0;font-weight:700;font-size:15px;" colspan="3">${esc(quote.company)}</td>
      </tr>
      <tr>
        <td style="padding:7px 14px 7px 0;color:#888;">Email</td>
        <td style="padding:7px 14px 7px 0;">
          <a href="mailto:${esc(quote.email)}" style="color:#66116f;text-decoration:none;">${esc(quote.email)}</a>
        </td>
        <td style="padding:7px 14px 7px 0;color:#888;width:120px;">Phone</td>
        <td style="padding:7px 0;">${esc(quote.phone)}</td>
      </tr>
      <tr>
        <td style="padding:7px 14px 7px 0;color:#888;">Location</td>
        <td style="padding:7px 14px 7px 0;" colspan="3">${esc(quote.city)}, ${esc(quote.state)}</td>
      </tr>
      <tr>
        <td style="padding:7px 14px 7px 0;color:#888;">Contact Person</td>
        <td style="padding:7px 14px 7px 0;">${esc(quote.contactName)}</td>
        <td style="padding:7px 14px 7px 0;color:#888;">Request ID</td>
        <td style="padding:7px 0;font-size:11px;color:#aaa;">${esc(quote.id)}</td>
      </tr>
    </table>
  </div>

  <!-- ── DIVIDER ── -->
  <div style="height:1px;background:#ede8f0;"></div>

  <!-- ── SALUTATION + INTRO ── -->
  <div style="background:#fff;padding:20px 32px 4px;">
    <p style="margin:0 0 8px;font-size:14px;">Dear Sir/Madam,</p>
    <p style="margin:0 0 6px;font-size:13.5px;line-height:1.6;color:#444;">
      Thank you for your enquiry regarding spare parts.
    </p>
    <p style="margin:0 0 0;font-size:13.5px;line-height:1.6;color:#444;">
      We are pleased to submit our quotation as follows:
    </p>
  </div>

  <!-- ── SPARE PART QUOTATION TABLE ── -->
  <div style="background:#fff;padding:12px 32px 20px;">
    <h2 style="margin:18px 0 10px;font-size:15px;font-weight:700;color:#4a1155;
      padding-bottom:8px;border-bottom:2px solid #ede8f0;">
      Spare Part Quotation
    </h2>
    <div style="overflow-x:auto;">
      <table role="table" cellspacing="0" cellpadding="0"
        style="width:100%;min-width:600px;border-collapse:collapse;
        border:1px solid #ede8f0;border-radius:8px;overflow:hidden;font-size:13px;">
        <thead>
          <tr style="background:#f7f2f8;">
            <th style="${HEAD_STYLE}">S.No.</th>
            <th style="${HEAD_STYLE}">Spare Part Description</th>
            <th style="${HEAD_STYLE}">Machine / Application</th>
            <th style="${HEAD_STYLE}">Item Code</th>
            <th style="${HEAD_STYLE}text-align:right;">Qty</th>
            <th style="${HEAD_STYLE}text-align:right;">Unit Price (₹)</th>
            <th style="${HEAD_STYLE}text-align:right;">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${totals.items.map((item, i) => `
          <tr>
            <td style="${COL_STYLE}text-align:center;">${esc(i + 1)}</td>
            <td style="${COL_STYLE}">${esc(item.name)}</td>
            <td style="${COL_STYLE}">${esc(item.machine || "—")}</td>
            <td style="${COL_STYLE}">${esc(item.itemCode || "—")}</td>
            <td style="${COL_STYLE}text-align:right;">${esc(item.quantity)}</td>
            <td style="${COL_STYLE}text-align:right;white-space:nowrap;">
              ${item.unitPrice > 0 ? formatINR(item.unitPricePaise) : "<em style='color:#aaa;font-style:normal;'>On request</em>"}
            </td>
            <td style="${COL_STYLE}text-align:right;white-space:nowrap;">
              ${item.unitPrice > 0 ? formatINR(item.totalPaise) : "<em style='color:#aaa;font-style:normal;'>—</em>"}
            </td>
          </tr>`).join("")}
        </tbody>
        <tfoot style="border-top:2px solid #ede8f0;">
          <tr>
            <td colspan="6" style="padding:8px 14px;text-align:right;font-size:13px;color:#666;">Subtotal</td>
            <td style="padding:8px 14px;text-align:right;white-space:nowrap;font-size:13px;">${formatINR(totals.subtotalPaise)}</td>
          </tr>
          <tr>
            <td colspan="6" style="padding:8px 14px;text-align:right;font-size:13px;color:#666;">GST @ 18%</td>
            <td style="padding:8px 14px;text-align:right;white-space:nowrap;font-size:13px;">${formatINR(totals.gstPaise)}</td>
          </tr>
          <tr style="border-top:2px solid #66116f;">
            <td colspan="6" style="padding:13px 14px;text-align:right;font-weight:700;font-size:14px;color:#66116f;">
              Grand Total (Including GST)
            </td>
            <td style="padding:13px 14px;text-align:right;white-space:nowrap;font-weight:800;font-size:17px;color:#66116f;">
              ${formatINR(totals.grandTotalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- ── COMMERCIAL TERMS ── -->
  <div style="background:#fff;padding:8px 32px 20px;">
    <h2 style="margin:16px 0 10px;font-size:15px;font-weight:700;color:#4a1155;
      padding-bottom:8px;border-bottom:2px solid #ede8f0;">
      Commercial Terms &amp; Conditions
    </h2>
    <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;">${termsHtml}</ol>
  </div>

  <!-- ── BANK DETAILS ── -->
  <div style="background:#faf8fc;padding:8px 32px 22px;border-top:1px solid #ede8f0;">
    <h2 style="margin:16px 0 10px;font-size:15px;font-weight:700;color:#4a1155;
      padding-bottom:8px;border-bottom:2px solid #ede8f0;">
      Bank Details for Payment
    </h2>
    <table role="presentation" cellspacing="0" cellpadding="0"
      style="font-size:13px;border-collapse:collapse;">
      ${bankHtml}
    </table>
  </div>

  <!-- ── CLOSING ── -->
  <div style="background:#fff;padding:16px 32px 24px;border-top:1px solid #ede8f0;">
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#444;">
      Kindly arrange the payment to enable us to process your order and dispatch the spare parts.
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#444;">
      For any further assistance or technical clarification, please feel free to contact our team.
    </p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#444;">
      We look forward to your valuable order and assure you of our best services.
    </p>
    ${quote.message ? `
    <div style="padding:13px 16px;background:#faf7fb;border-left:3px solid #66116f;font-size:13px;
      color:#444;margin-bottom:18px;border-radius:0 6px 6px 0;">
      <strong>Customer Message:</strong><br>${esc(quote.message)}
    </div>` : ""}
    ${quote.attachment?.url ? `
    <p style="font-size:12px;color:#888;margin-bottom:18px;">
      📎 Attachment:
      <a href="${esc(quote.attachment.url)}" style="color:#66116f;">${esc(quote.attachment.name || "View file")}</a>
    </p>` : ""}
    <p style="margin:0;font-size:13.5px;line-height:1.7;">
      Best regards,<br>
      <strong>Spare Parts Division</strong><br>
      <strong style="color:#66116f;">Unipackauto India Pvt. Ltd.</strong>
    </p>
  </div>

  <!-- ── FOOTER ── -->
  <footer style="background:#66116f;padding:18px 32px;color:#f0e4f2;font-size:12.5px;line-height:1.8;">
    <strong style="color:#fff;display:block;margin-bottom:4px;">Unipackauto India Pvt. Ltd.</strong>
    <span>📞 9215521314 &nbsp;|&nbsp; 7232001235 &nbsp;|&nbsp; 9991226074</span><br>
    <a href="mailto:info@unipackauto.in" style="color:#f5d6fb;">info@unipackauto.in</a>
    &nbsp;·&nbsp;
    <a href="mailto:services.upa@gmail.com" style="color:#f5d6fb;">services.upa@gmail.com</a>
    &nbsp;·&nbsp;
    <a href="mailto:uniquepackagingandautomation@gmail.com" style="color:#f5d6fb;">uniquepackagingandautomation@gmail.com</a>
  </footer>

</div>
</div>
</body>
</html>`;

  return { subject, text: textLines.join("\n"), html, date, quotationNumber };
};

// ── SMTP transport factory ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getEmailConfiguration = (env = process.env) => {
  const adminEmail = env.ADMIN_EMAIL?.trim();

  // ── 1. Generic SMTP (smtp.gmail.com or any other host) ──────────────────────
  if (env.SMTP_HOST?.trim()) {
    const host   = env.SMTP_HOST.trim();
    const port   = Number(env.SMTP_PORT || 587);
    const secure = String(env.SMTP_SECURE || "").toLowerCase() === "true";
    const user   = env.SMTP_USER?.trim();
    const pass   = env.SMTP_PASS?.trim();
    const from   = (env.EMAIL_FROM?.trim()) || user;

    if (!adminEmail || !EMAIL_RE.test(adminEmail))
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    if (!from || !EMAIL_RE.test(from))
      throw new Error("EMAIL_FROM (or SMTP_USER) must be a valid email address.");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("SMTP_PORT must be a number between 1 and 65,535.");
    if (Boolean(user) !== Boolean(pass))
      throw new Error("SMTP_USER and SMTP_PASS must both be set (or both left empty).");
    if (pass && (pass === "your_16_character_app_password_here" || pass.length < 8))
      throw new Error("SMTP_PASS appears to still be a placeholder. Replace it with your real App Password.");

    return {
      transport: {
        host, port, secure,
        ...(user && pass ? { auth: { user, pass } } : {}),
      },
      from,
      to: adminEmail,
    };
  }

  // ── 2. Gmail shorthand ───────────────────────────────────────────────────────
  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPass = env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

  if (gmailUser || gmailPass) {
    if (!gmailUser || !gmailPass)
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must both be set.");
    if (!EMAIL_RE.test(gmailUser))
      throw new Error("GMAIL_USER must be a valid Gmail address.");
    const to = adminEmail || gmailUser;
    if (!EMAIL_RE.test(to))
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    return {
      transport: { service: "gmail", auth: { user: gmailUser, pass: gmailPass } },
      from: gmailUser,
      to,
    };
  }

  // ── 3. Nothing configured ────────────────────────────────────────────────────
  throw new Error(
    "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, and ADMIN_EMAIL in .env."
  );
};

export const describeEmailFailure = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const rc   = Number(error?.responseCode || 0);

  if (code === "EAUTH" || rc === 535 || rc === 534)
    return "Gmail rejected the password. SMTP_PASS must be a 16-character App Password (not your Gmail login). " +
      "Generate one at myaccount.google.com → Security → 2-Step Verification → App passwords.";

  if (["ETIMEDOUT","ESOCKET","ECONNECTION","ECONNREFUSED"].includes(code))
    return "Cannot reach the SMTP server. For Gmail use port 465 + SMTP_SECURE=true, or port 587 + SMTP_SECURE=false. " +
      "Check that outbound SMTP is not blocked by your host/firewall.";

  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "Cannot resolve SMTP hostname. Check SMTP_HOST (smtp.gmail.com for Gmail) and server DNS/internet access.";

  if (error?.message?.startsWith("SMTP_PASS appears to still be a placeholder"))
    return error.message;

  if (error?.message?.includes("not configured") || error?.message?.includes("must both be set"))
    return `Email setup is incomplete: ${error.message}`;

  return `Email delivery failed (${code || "unknown"}): ${error?.message || "check server logs"}.`;
};

// ── Transport helpers ─────────────────────────────────────────────────────────

const makeTransporter = () => {
  const config = getEmailConfiguration();
  return { config, transporter: nodemailer.createTransport(config.transport) };
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Verify SMTP credentials without sending a message. */
export async function verifyQuoteEmail() {
  const { config, transporter } = makeTransporter();
  await transporter.verify();
  return { recipient: config.to };
}

/**
 * Send a new-quote-request notification email to the admin.
 *
 * @param {object}   quote      – saved QuoteRequest document
 * @param {Array}    [pricedItems] – optional pre-enriched items from MongoDB price lookup
 *   Each item: { name, itemCode, machine, quantity, unitPrice (rupees from MongoDB) }
 */
export async function sendQuoteNotification(quote, pricedItems, quotationOptions = {}) {
  const { config, transporter } = makeTransporter();
  const isSparePart = quote.quoteType === "sparePart";
  let totals = null;
  let email;
  if (isSparePart) {
    totals = calculateQuotationTotals(pricedItems);
    const issuedAt = quotationOptions.issuedAt || new Date();
    const quotationNumber =
      quotationOptions.quotationNumber || createQuotationNumber(quote.id || quote._id, issuedAt);
    email = buildSparePartsQuotationEmail(quote, totals, quotationNumber, issuedAt);
  } else {
    const textLines = [
      "A new machine quote request was submitted on the UnipackAuto website.",
      "",
      `Company    : ${quote.company}`,
      `Contact    : ${quote.contactName}`,
      `Email      : ${quote.email}`,
      `Phone      : ${quote.phone}`,
      `Location   : ${quote.city}, ${quote.state}`,
      `Request ID : ${quote.id}`,
      "",
      "Machine Requirement",
      `Machine type   : ${quote.machineType}`,
      `Model          : ${quote.model}`,
      `Quantity       : ${quote.quantity}`,
      `Specifications : ${quote.specifications || "Not provided"}`,
    ];
    if (quote.message) textLines.push("", `Message: ${quote.message}`);
    if (quote.attachment?.url) textLines.push(`Attachment: ${quote.attachment.url}`);

    email = {
      subject: `New machine quote from ${String(quote.company || "").replace(/[\r\n]/g, " ")} — ${quote.id}`,
      text: textLines.join("\n"),
      html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f3f6;font-family:Arial,Helvetica,sans-serif;color:#29232b;">
<div style="max-width:740px;margin:24px auto;padding:0 12px;">
  <div style="background:#66116f;color:#fff;padding:22px 26px;border-radius:12px 12px 0 0;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;">UnipackAuto · New Quote Request</div>
    <h1 style="margin:8px 0 0;font-size:22px;">Machine Quote Request</h1>
  </div>
  <div style="background:#fff;padding:24px 26px;border:1px solid #ede8f0;border-top:0;">
    <table role="presentation" cellspacing="0" cellpadding="0"
      style="width:100%;margin-bottom:20px;font-size:14px;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;color:#777;width:140px;">Company</td>
        <td style="padding:6px 0;font-weight:600;">${esc(quote.company)}</td>
        <td style="padding:6px 0;color:#777;width:120px;">Contact</td>
        <td style="padding:6px 0;">${esc(quote.contactName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Email</td>
        <td style="padding:6px 0;"><a href="mailto:${esc(quote.email)}" style="color:#66116f;">${esc(quote.email)}</a></td>
        <td style="padding:6px 0;color:#777;">Phone</td>
        <td style="padding:6px 0;">${esc(quote.phone)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Location</td>
        <td style="padding:6px 0;" colspan="3">${esc(quote.city)}, ${esc(quote.state)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Date</td>
        <td style="padding:6px 0;" colspan="3">${esc(formatQuotationDate(new Date()))}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Request ID</td>
        <td style="padding:6px 0;font-size:12px;color:#999;" colspan="3">${esc(quote.id)}</td>
      </tr>
    </table>
    <h2 style="font-size:15px;margin:20px 0 12px;color:#4a1155;">Machine Requirement</h2>
    <p>Machine: ${esc(quote.machineType)} · Model: ${esc(quote.model)} · Quantity: ${esc(quote.quantity)}</p>
    <p>Specifications: ${esc(quote.specifications || "Not provided")}</p>
    ${quote.message ? `<p style="margin-top:18px;padding:14px;background:#faf7fb;border-left:3px solid #66116f;font-size:13px;color:#444;">${esc(quote.message)}</p>` : ""}
    ${quote.attachment?.url ? `<p style="font-size:12px;color:#777;margin-top:12px;">📎 Attachment: <a href="${esc(quote.attachment.url)}" style="color:#66116f;">${esc(quote.attachment.name || "View file")}</a></p>` : ""}
    <p style="margin-top:24px;font-size:13px;color:#888;">Reply to this email to respond directly to the customer at <a href="mailto:${esc(quote.email)}" style="color:#66116f;">${esc(quote.email)}</a>.</p>
  </div>
  <div style="padding:14px 20px;color:#aaa;font-size:11px;text-align:center;">UnipackAuto · Packaging Automation Solutions · Bhiwadi, Rajasthan, India</div>
</div>
 </body></html>`,
    };
  }

  const info = await transporter.sendMail({
    from: `"UnipackAuto Enquiries" <${config.from}>`,
    to: config.to,
    replyTo: quote.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  const accepted = (info.accepted || []).map((r) =>
    typeof r === "string" ? r : r.address
  );
  if (!accepted.some((r) => r?.toLowerCase() === config.to.toLowerCase())) {
    throw Object.assign(
      new Error("SMTP did not accept the admin notification recipient."),
      { code: "RECIPIENT_NOT_ACCEPTED" }
    );
  }
  return {
    messageId: info.messageId,
    response: info.response,
    accepted,
    ...(totals ? { totals, quotationNumber: email.quotationNumber } : {}),
  };
}

/** SMTP connection test — sends a plain test message to ADMIN_EMAIL. */
export async function sendQuoteEmailTest() {
  const { config, transporter } = makeTransporter();
  const info = await transporter.sendMail({
    from: `"UnipackAuto Email Test" <${config.from}>`,
    to: config.to,
    subject: "UnipackAuto — SMTP delivery test",
    text: [
      "This is a test email from the UnipackAuto quote notification service.",
      `Recipient : ${config.to}`,
      "If you received this, the SMTP server accepted the message.",
      "Note: SMTP acceptance does not guarantee inbox delivery — also check Spam / All Mail.",
    ].join("\n"),
  });
  const accepted = (info.accepted || []).map((r) =>
    typeof r === "string" ? r : r.address
  );
  if (!accepted.some((r) => r?.toLowerCase() === config.to.toLowerCase())) {
    throw Object.assign(
      new Error("SMTP did not accept the configured notification recipient."),
      { code: "RECIPIENT_NOT_ACCEPTED" }
    );
  }
  return { recipient: config.to, messageId: info.messageId, response: info.response, accepted };
}
