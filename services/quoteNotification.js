import nodemailer from "nodemailer";

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

const COL_STYLE  = "padding:12px 10px;border-bottom:1px solid #eee6f0;font-size:13px;line-height:1.45;color:#243047;vertical-align:top;";
const HEAD_STYLE = "padding:12px 10px;background:#f7f2f8;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#4a1155;text-align:left;vertical-align:middle;";

const buildItemisedTable = (totals) => {
  const rows = totals.items
    .map((item, i) => `
      <tr style="page-break-inside:avoid;break-inside:avoid;background:${i % 2 ? "#fcfafd" : "#ffffff"};">
        <td style="${COL_STYLE}text-align:center;color:#687185;">${esc(i + 1)}</td>
        <td style="${COL_STYLE}font-weight:600;word-break:break-word;">${esc(item.name)}</td>
        <td style="${COL_STYLE}color:#50576a;word-break:break-word;">${esc(item.machine || "—")}</td>
        <td style="${COL_STYLE}color:#50576a;">${esc(item.itemCode || "—")}</td>
        <td style="${COL_STYLE}text-align:right;">${esc(item.quantity)}</td>
        <td style="${COL_STYLE}text-align:right;white-space:nowrap;">${formatINR(item.unitPricePaise)}</td>
        <td style="${COL_STYLE}text-align:right;white-space:nowrap;font-weight:600;">${formatINR(item.totalPaise)}</td>
      </tr>`)
    .join("");

  const summaryRow = (label, value) => `
    <tr style="page-break-inside:avoid;break-inside:avoid;">
      <td colspan="6" style="padding:9px 10px;text-align:right;font-size:13px;color:#687185;">${esc(label)}</td>
      <td style="padding:9px 10px;text-align:right;white-space:nowrap;font-size:13px;color:#243047;">${value}</td>
    </tr>`;

  return `
  <div class="table-wrap" style="margin:20px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <table role="table" cellspacing="0" cellpadding="0"
      style="width:100%;min-width:640px;table-layout:fixed;border-collapse:collapse;border:1px solid #ede8f0;">
      <colgroup>
        <col style="width:7%"><col style="width:29%"><col style="width:20%"><col style="width:10%">
        <col style="width:8%"><col style="width:13%"><col style="width:13%">
      </colgroup>
      <thead style="display:table-header-group;">
        <tr>
          <th style="${HEAD_STYLE}text-align:center;">S. No.</th>
          <th style="${HEAD_STYLE}">Spare Part Description</th>
          <th style="${HEAD_STYLE}">Machine / Application</th>
          <th style="${HEAD_STYLE}">Item Code</th>
          <th style="${HEAD_STYLE}text-align:right;">Qty</th>
          <th style="${HEAD_STYLE}text-align:right;">Unit Price (₹)</th>
          <th style="${HEAD_STYLE}text-align:right;">Total (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr><td colspan="7" style="height:0;border-top:2px solid #ede8f0;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
        ${summaryRow("Subtotal", formatINR(totals.subtotalPaise))}
        ${summaryRow("GST @ 18%", formatINR(totals.gstPaise))}
        <tr style="page-break-inside:avoid;break-inside:avoid;background:#faf5fb;">
          <td colspan="6" style="padding:14px 10px;text-align:right;font-weight:700;font-size:14px;border-top:2px solid #66116f;color:#66116f;">
            Grand Total (Including GST)
          </td>
          <td style="padding:14px 10px;text-align:right;white-space:nowrap;font-weight:800;font-size:17px;border-top:2px solid #66116f;color:#66116f;">
            ${formatINR(totals.grandTotalPaise)}
          </td>
        </tr>
      </tbody>
    </table>
  </div>`;
};

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
  return `UPK/Spare/Quote/${monthYear}/${String(requestId).slice(-10)}`;
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
  const subject = `Unipackauto Spare Parts Quote - ${quotationNumber}`;
  const textLines = [
    "Spare Part Quotation",
    `Quotation Number: ${quotationNumber}`,
    "",
    `Company: ${quote.company}`,
    `Email: ${quote.email}`,
    `Location: ${quote.city}, ${quote.state}`,
    `Request ID: ${quote.id}`,
    `Contact: ${quote.contactName}`,
    `Phone: ${quote.phone}`,
    `Date: ${date}`,
    "",
    "Dear Sir/Madam,",
    "",
    "Thank you for your enquiry regarding spare parts.",
    "Please find below our offer for the required spare parts:",
    "",
    "Spare Part Quotation",
    "S. No. | Spare Part Description | Machine/Application | Item Code | Quantity | Unit Price (₹) | Total (₹)",
    ...totals.items.map((item, index) =>
      `${index + 1} | ${item.name} | ${item.machine || "—"} | ${item.itemCode || "—"} | ${item.quantity} | ${formatINR(item.unitPricePaise)} | ${formatINR(item.totalPaise)}`
    ),
    `Subtotal: ${formatINR(totals.subtotalPaise)}`,
    `GST @ 18%: ${formatINR(totals.gstPaise)}`,
    `Grand Total (Including GST): ${formatINR(totals.grandTotalPaise)}`,
    "",
    "Commercial Terms & Conditions:",
    ...commercialTerms.map((term, index) => `${index + 1}. ${term}`),
    "",
    "Bank Details for Payment",
    ...bankDetails.map(([label, value]) => `${label}: ${value}`),
    "",
    "Kindly arrange the payment to enable us to process your order and dispatch the spare parts.",
    "For any further assistance or technical clarification, please feel free to contact our team.",
    "We look forward to your valuable order and assure you of our best services.",
    "",
    "Best regards,",
    "Spare Parts Division",
    "Unipackauto India Pvt. Ltd.",
    "Contact Numbers: 9215521314, 7232001235, 9991226074",
    "Email Addresses:",
    "info@unipackauto.in",
    "services.upa@gmail.com",
    "uniquepackagingandautomation@gmail.com",
  ];
  if (quote.message) textLines.push("", `Customer message: ${quote.message}`);
  if (quote.attachment?.url) textLines.push(`Attachment: ${quote.attachment.url}`);

  const termsHtml = commercialTerms
    .map((term) => {
      const separator = term.indexOf(":");
      return `<li style="margin:0 0 8px;"><strong style="color:#41104f;">${esc(term.slice(0, separator + 1))}</strong>${esc(term.slice(separator + 1))}</li>`;
    })
    .join("");
  const bankHtml = bankDetails
    .map(([label, value]) => `<tr><td style="padding:5px 12px 5px 0;color:#687185;">${esc(label)}</td><td style="padding:5px 0;font-weight:600;color:#243047;">${esc(value)}</td></tr>`)
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print {
      thead { display: table-header-group; }
      tr, li { page-break-inside: avoid; break-inside: avoid; }
      h2 { page-break-after: avoid; }
    }
    @media only screen and (max-width: 600px) {
      .main-pad { padding: 20px 14px !important; }
      .cust td { display: block !important; width: 100% !important; box-sizing: border-box; }
      .cust td.lbl { padding-bottom: 0 !important; border-bottom: 0 !important; font-size: 11px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f1f3f8;font-family:Arial,Helvetica,sans-serif;color:#243047;">
  <div style="max-width:820px;margin:0 auto;padding:28px 12px;">
    <div style="overflow:hidden;border:1px solid #e3e7ef;border-radius:16px;background:#fff;box-shadow:0 12px 36px rgba(31,42,68,.12);">
      <header style="padding:30px 28px 26px;text-align:center;background:#66116f;background-image:linear-gradient(135deg,#4a0d54,#76277c);color:#fff;">
        <div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#ead9ef;">Unipackauto India Pvt. Ltd.</div>
        <div style="display:inline-block;margin:14px 0 10px;padding:7px 16px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:rgba(255,255,255,.12);font-size:13px;color:#fff;word-break:break-all;">${esc(quotationNumber)}</div>
        <h1 style="margin:0 0 6px;font-size:30px;line-height:1.2;color:#fff;">Spare Part Quotation</h1>
        <div style="font-size:13px;color:#f3e9f5;">Date: ${esc(date)}</div>
      </header>
      <main class="main-pad" style="padding:28px 30px;">
        <table class="cust" role="presentation" cellspacing="0" cellpadding="0"
          style="width:100%;margin:0 0 24px;border-bottom:1px solid #eee6f0;font-size:13px;">
          <tr>
            <td class="lbl" style="width:18%;padding:8px 0;color:#8a8f9c;">Company Name</td>
            <td colspan="3" style="padding:8px 0;font-size:16px;font-weight:700;color:#243047;">${esc(quote.company)}</td>
          </tr>
          <tr>
            <td class="lbl" style="padding:8px 0;color:#8a8f9c;">Email</td>
            <td style="width:34%;padding:8px 8px 8px 0;"><a href="mailto:${esc(quote.email)}" style="color:#66116f;text-decoration:none;">${esc(quote.email)}</a></td>
            <td class="lbl" style="width:16%;padding:8px 0;color:#8a8f9c;">Phone</td>
            <td style="padding:8px 0;color:#243047;">${esc(quote.phone)}</td>
          </tr>
          <tr>
            <td class="lbl" style="padding:8px 0;color:#8a8f9c;">Location</td>
            <td style="padding:8px 8px 8px 0;color:#243047;">${esc(quote.city)}, ${esc(quote.state)}</td>
            <td class="lbl" style="padding:8px 0;color:#8a8f9c;">Contact Person</td>
            <td style="padding:8px 0;color:#243047;">${esc(quote.contactName)}</td>
          </tr>
          <tr>
            <td class="lbl" style="padding:8px 0 14px;color:#8a8f9c;">Request ID</td>
            <td colspan="3" style="padding:8px 0 14px;font-size:12px;color:#9aa0ad;word-break:break-all;">${esc(quote.id)}</td>
          </tr>
        </table>
        <p style="margin:0 0 10px;font-size:14px;color:#243047;">Dear Sir/Madam,</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#243047;">Thank you for your enquiry regarding spare parts.</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#243047;">Please find below our offer for the required spare parts.</p>
        <h2 style="margin:0 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:18px;">Spare Part Quotation</h2>
        ${buildItemisedTable(totals)}
        <h2 style="margin:28px 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:17px;">Commercial Terms &amp; Conditions</h2>
        <ol style="margin:0;padding-left:22px;font-size:13px;line-height:1.55;color:#243047;">${termsHtml}</ol>
        <h2 style="margin:28px 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:17px;">Bank Details for Payment</h2>
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;padding:12px;border:1px solid #e5e7ef;border-radius:10px;background:#faf9fc;font-size:13px;">${bankHtml}</table>
        <p style="margin:22px 0 8px;font-size:13px;line-height:1.55;color:#243047;">Kindly arrange the payment to enable us to process your order and dispatch the spare parts.</p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#243047;">For any further assistance or technical clarification, please feel free to contact our team.</p>
        <p style="margin:0 0 22px;font-size:13px;line-height:1.55;color:#243047;">We look forward to your valuable order and assure you of our best services.</p>
        ${quote.message ? `<p style="margin:18px 0;padding:14px;background:#faf7fb;border-left:3px solid #66116f;font-size:13px;color:#444;"><strong style="color:#41104f;">Customer message:</strong><br>${esc(quote.message)}</p>` : ""}
        ${quote.attachment?.url ? `<p style="font-size:12px;color:#777;margin-top:12px;">Attachment: <a href="${esc(quote.attachment.url)}" style="color:#66116f;">${esc(quote.attachment.name || "View file")}</a></p>` : ""}
        <p style="margin:0;font-size:13px;line-height:1.6;color:#243047;">Best regards,<br><strong style="color:#41104f;">Spare Parts Division</strong><br><strong style="color:#41104f;">Unipackauto India Pvt. Ltd.</strong></p>
      </main>
      <footer style="padding:22px 30px;text-align:center;background:#f7f5f9;border-top:1px solid #e9e4ed;font-size:12px;line-height:1.9;color:#50576a;">
        <strong style="font-size:14px;color:#41104f;">Unipackauto India Pvt. Ltd.</strong><br>
        <strong style="color:#50576a;">Phone:</strong> 9215521314, 7232001235, 9991226074<br>
        <a href="mailto:info@unipackauto.in" style="color:#63216f;text-decoration:none;">info@unipackauto.in</a> &nbsp;|&nbsp;
        <a href="mailto:services.upa@gmail.com" style="color:#63216f;text-decoration:none;">services.upa@gmail.com</a><br>
        <a href="mailto:uniquepackagingandautomation@gmail.com" style="color:#63216f;text-decoration:none;">uniquepackagingandautomation@gmail.com</a>
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
    <h1 style="margin:8px 0 0;font-size:22px;color:#fff;">Machine Quote Request</h1>
  </div>
  <div style="background:#fff;padding:24px 26px;border:1px solid #ede8f0;border-top:0;">
    <table role="presentation" cellspacing="0" cellpadding="0"
      style="width:100%;margin-bottom:20px;font-size:14px;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;color:#777;width:140px;">Company</td>
        <td style="padding:6px 0;font-weight:600;color:#29232b;">${esc(quote.company)}</td>
        <td style="padding:6px 0;color:#777;width:120px;">Contact</td>
        <td style="padding:6px 0;color:#29232b;">${esc(quote.contactName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Email</td>
        <td style="padding:6px 0;"><a href="mailto:${esc(quote.email)}" style="color:#66116f;">${esc(quote.email)}</a></td>
        <td style="padding:6px 0;color:#777;">Phone</td>
        <td style="padding:6px 0;color:#29232b;">${esc(quote.phone)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Location</td>
        <td style="padding:6px 0;color:#29232b;" colspan="3">${esc(quote.city)}, ${esc(quote.state)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Date</td>
        <td style="padding:6px 0;color:#29232b;" colspan="3">${esc(formatQuotationDate(new Date()))}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#777;">Request ID</td>
        <td style="padding:6px 0;font-size:12px;color:#999;" colspan="3">${esc(quote.id)}</td>
      </tr>
    </table>
    <h2 style="font-size:15px;margin:20px 0 12px;color:#4a1155;">Machine Requirement</h2>
    <p style="color:#29232b;">Machine: ${esc(quote.machineType)} · Model: ${esc(quote.model)} · Quantity: ${esc(quote.quantity)}</p>
    <p style="color:#29232b;">Specifications: ${esc(quote.specifications || "Not provided")}</p>
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