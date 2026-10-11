import nodemailer from "nodemailer";

// ── Number helpers ─────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Format integer paise as ₹X,XX,XXX.XX */
export const formatINR = (paise) => {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw Object.assign(
      new Error("Currency amount must be a non-negative integer (paise)."),
      { status: 422 }
    );
  }
  const rupees = Math.floor(paise / 100);
  const paiseStr = String(paise % 100).padStart(2, "0");
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
 * Returns { items (with unitPaiseCents + totalPaise), subtotalPaise, gstPaise, grandTotalPaise }
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

    const unitPaise = toPaise(item.unitPrice);
    const totalPaise = unitPaise * qty;

    if (!Number.isSafeInteger(unitPaise) || !Number.isSafeInteger(totalPaise)) {
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

    return { ...item, unitPaise, totalPaise };
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

const buildItemisedTable = (totals) => {
  const rows = totals.items
    .map(
      (item, i) => `
      <tr>
        <td style="${COL_STYLE}">${esc(i + 1)}</td>
        <td style="${COL_STYLE}">${esc(item.name)}</td>
        <td style="${COL_STYLE}">${esc(item.machine || "—")}</td>
        <td style="${COL_STYLE}">${esc(item.itemCode || "—")}</td>
        <td style="${COL_STYLE}text-align:right;">${esc(item.quantity)}</td>
        <td style="${COL_STYLE}text-align:right;white-space:nowrap;">${
          item.unitPrice > 0 ? formatINR(item.unitPaise) : "<em style='color:#999;'>On request</em>"
        }</td>
        <td style="${COL_STYLE}text-align:right;white-space:nowrap;">${
          item.unitPrice > 0 ? formatINR(item.totalPaise) : "<em style='color:#999;'>—</em>"
        }</td>
      </tr>`
    )
    .join("");

  const summaryRow = (label, value) => `
    <tr>
      <td colspan="6" style="padding:8px 12px;text-align:right;font-size:13px;color:#555;">${esc(label)}</td>
      <td style="padding:8px 12px;text-align:right;white-space:nowrap;font-size:13px;">${value}</td>
    </tr>`;

  const hasPrices = totals.items.some((item) => item.unitPrice > 0);

  return `
  <div style="overflow-x:auto;margin:20px 0;">
    <table role="table" cellspacing="0" cellpadding="0"
      style="width:100%;min-width:680px;border-collapse:collapse;border:1px solid #ede8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr>
          <th style="${HEAD_STYLE}">#</th>
          <th style="${HEAD_STYLE}">Spare Part Name</th>
          <th style="${HEAD_STYLE}">Machine</th>
          <th style="${HEAD_STYLE}">Item Code</th>
          <th style="${HEAD_STYLE}text-align:right;">Qty</th>
          <th style="${HEAD_STYLE}text-align:right;">Unit Price</th>
          <th style="${HEAD_STYLE}text-align:right;">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      ${hasPrices ? `
      <tfoot style="border-top:2px solid #ede8f0;">
        ${summaryRow("Subtotal (before GST)", formatINR(totals.subtotalPaise))}
        ${summaryRow("GST @ 18%", formatINR(totals.gstPaise))}
        <tr>
          <td colspan="6" style="padding:12px;text-align:right;font-weight:700;font-size:14px;border-top:2px solid #66116f;color:#66116f;">
            Grand Total (incl. GST)
          </td>
          <td style="padding:12px;text-align:right;white-space:nowrap;font-weight:800;font-size:17px;border-top:2px solid #66116f;color:#66116f;">
            ${formatINR(totals.grandTotalPaise)}
          </td>
        </tr>
      </tfoot>` : ""}
    </table>
  </div>`;
};

const buildItemisedText = (totals) => {
  const DIVIDER = "-".repeat(86);
  const col = (v, w) => String(v ?? "").padEnd(w).slice(0, w);

  const header = `${col("#", 3)}${col("Spare Part Name", 28)}${col("Machine", 22)}${col("Item Code", 14)}${col("Qty", 6)}${col("Unit Price", 13)}${"Line Total"}`;
  const rows = totals.items.map((item, i) =>
    `${col(i + 1, 3)}${col(item.name, 28)}${col(item.machine || "—", 22)}${col(item.itemCode || "—", 14)}${col(item.quantity, 6)}${col(
      item.unitPrice > 0 ? formatINR(item.unitPaise) : "On request", 13
    )}${item.unitPrice > 0 ? formatINR(item.totalPaise) : "—"}`
  );

  const hasPrices = totals.items.some((item) => item.unitPrice > 0);

  return [
    DIVIDER,
    header,
    DIVIDER,
    ...rows,
    DIVIDER,
    ...(hasPrices
      ? [
          `${"Subtotal (before GST):".padStart(58)} ${formatINR(totals.subtotalPaise)}`,
          `${"GST @ 18%:".padStart(58)} ${formatINR(totals.gstPaise)}`,
          `${"Grand Total (incl. GST):".padStart(58)} ${formatINR(totals.grandTotalPaise)}`,
          DIVIDER,
        ]
      : []),
  ].join("\n");
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
 *   Each item: { name, itemCode, quantity, unitPrice (rupees float, 0 = unknown) }
 */
export async function sendQuoteNotification(quote, pricedItems) {
  const { config, transporter } = makeTransporter();

  const isSparePart = quote.quoteType === "sparePart";

  // ── Build totals (only meaningful for spare-part quotes with items) ──────────
  let totals = null;
  if (isSparePart && Array.isArray(pricedItems) && pricedItems.length > 0) {
    try {
      totals = calculateQuotationTotals(pricedItems);
    } catch {
      // price lookup failed — still send without totals
      totals = null;
    }
  }

  // ── Plain-text body ──────────────────────────────────────────────────────────
  const textLines = [
    "A new quote request was submitted on the UnipackAuto website.",
    "",
    `Company    : ${quote.company}`,
    `Contact    : ${quote.contactName}`,
    `Email      : ${quote.email}`,
    `Phone      : ${quote.phone}`,
    `Location   : ${quote.city}, ${quote.state}`,
    `Request ID : ${quote.id}`,
  ];

  if (isSparePart && totals) {
    textLines.push("", "── Spare Parts & Pricing ────────────────────────────────────────────────");
    textLines.push(buildItemisedText(totals));
  } else if (isSparePart && Array.isArray(pricedItems)) {
    textLines.push("", "── Spare Parts ─────────────────────────────────────────────────────────");
    pricedItems.forEach((p, i) => {
      textLines.push(`${i + 1}. ${p.name} | Code: ${p.itemCode || "—"} | Qty: ${p.quantity}`);
    });
  } else if (!isSparePart) {
    textLines.push(
      "", "── Machine Requirement ─────────────────────────────────────────────────",
      `Machine type   : ${quote.machineType}`,
      `Model          : ${quote.model}`,
      `Quantity       : ${quote.quantity}`,
      `Specifications : ${quote.specifications || "Not provided"}`,
    );
  }

  if (quote.message) textLines.push("", `Message : ${quote.message}`);
  if (quote.attachment?.url) textLines.push(`Attachment : ${quote.attachment.url}`);
  textLines.push("", "Reply to this email to respond directly to the customer.");

  // ── HTML body ────────────────────────────────────────────────────────────────
  const tableHtml = totals
    ? buildItemisedTable(totals)
    : isSparePart && Array.isArray(pricedItems)
    ? `<ul style="margin:0;padding:0 0 0 18px;">${pricedItems
        .map((p) => `<li style="margin:4px 0;">${esc(p.name)} &nbsp;·&nbsp; Code: ${esc(p.itemCode || "—")} &nbsp;·&nbsp; Qty: ${esc(p.quantity)}</li>`)
        .join("")}</ul>`
    : `<p style="color:#555;">
        Machine: ${esc(quote.machineType)} &nbsp;·&nbsp;
        Model: ${esc(quote.model)} &nbsp;·&nbsp;
        Qty: ${esc(quote.quantity)}
       </p>`;

  const htmlBody = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f3f6;font-family:Arial,Helvetica,sans-serif;color:#29232b;">
<div style="max-width:740px;margin:24px auto;padding:0 12px;">

  <!-- Header -->
  <div style="background:#66116f;color:#fff;padding:22px 26px;border-radius:12px 12px 0 0;">
    <div style="font-size:11px;letter-spacing:2px;opacity:.8;text-transform:uppercase;">UnipackAuto · New Quote Request</div>
    <h1 style="margin:8px 0 0;font-size:22px;">
      ${esc(isSparePart ? "Spare Part Quote Request" : "Machine Quote Request")}
    </h1>
  </div>

  <!-- Body -->
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
        <td style="padding:6px 0;color:#777;">Request ID</td>
        <td style="padding:6px 0;font-size:12px;color:#999;" colspan="3">${esc(quote.id)}</td>
      </tr>
    </table>

    <h2 style="font-size:15px;margin:20px 0 12px;color:#4a1155;border-bottom:2px solid #f0e8f4;padding-bottom:8px;">
      ${esc(isSparePart ? "Spare Parts & Pricing" : "Machine Requirement")}
    </h2>

    ${tableHtml}

    ${quote.message ? `<p style="margin-top:18px;padding:14px;background:#faf7fb;border-left:3px solid #66116f;font-size:13px;color:#444;">${esc(quote.message)}</p>` : ""}
    ${quote.attachment?.url ? `<p style="font-size:12px;color:#777;margin-top:12px;">📎 Attachment: <a href="${esc(quote.attachment.url)}" style="color:#66116f;">${esc(quote.attachment.name || "View file")}</a></p>` : ""}

    <p style="margin-top:24px;font-size:13px;color:#888;">
      Reply to this email to respond directly to the customer at
      <a href="mailto:${esc(quote.email)}" style="color:#66116f;">${esc(quote.email)}</a>.
    </p>
  </div>

  <!-- Footer -->
  <div style="padding:14px 20px;color:#aaa;font-size:11px;text-align:center;">
    UnipackAuto · Packaging Automation Solutions · Bhiwadi, Rajasthan, India
  </div>
</div>
</body></html>`;

  const info = await transporter.sendMail({
    from: `"UnipackAuto Enquiries" <${config.from}>`,
    to: config.to,
    replyTo: quote.email,
    subject: `New ${isSparePart ? "spare-part" : "machine"} quote from ${String(quote.company || "").replace(/[\r\n]/g, " ")} — ${quote.id}`,
    text: textLines.join("\n"),
    html: htmlBody,
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
  return { messageId: info.messageId, response: info.response, accepted };
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
