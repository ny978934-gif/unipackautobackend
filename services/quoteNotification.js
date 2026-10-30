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
export const calculateQuotationTotalsFromPaise = (items, discount = {}) => {
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
    const unitPricePaise = item.unitPricePaise ?? toPaise(item.unitPrice);
    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) {
      throw Object.assign(
        new Error(`Part ${i + 1}: unit price must be a valid non-negative number.`),
        { status: 422 }
      );
    }

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

  const discountType = discount.type || "none";
  const discountValue = discount.value === undefined ? 0 : Number(discount.value);
  if (!["none", "percentage", "fixed"].includes(discountType)) {
    throw Object.assign(new Error("Choose a percentage or fixed-amount discount."), { status: 400 });
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw Object.assign(new Error("Discount must be a non-negative number."), { status: 400 });
  }
  if (discountType === "percentage" && discountValue > 100) {
    throw Object.assign(new Error("Percentage discount cannot exceed 100%."), { status: 400 });
  }
  if (discountType === "none" && discountValue !== 0) {
    throw Object.assign(new Error("A no-discount quotation must have a discount value of zero."), { status: 400 });
  }

  const discountValuePaise = discountType === "fixed" ? toPaise(discountValue) : 0;
  const discountPaise = discountType === "percentage"
    ? Number((BigInt(grandTotalPaise) * BigInt(Math.round(discountValue * 100)) + 5000n) / 10000n)
    : discountType === "fixed"
      ? discountValuePaise
      : 0;
  if (!Number.isSafeInteger(discountPaise) || discountPaise > grandTotalPaise) {
    throw Object.assign(new Error("Discount cannot exceed the total including GST."), { status: 400 });
  }
  const finalTotalPaise = grandTotalPaise - discountPaise;

  return {
    items: priced,
    subtotalPaise,
    gstPaise,
    grandTotalPaise,
    discountType,
    discountValue,
    discountValuePaise,
    discountPaise,
    finalTotalPaise,
  };
};

export const calculateQuotationTotals = (items, discount = {}) =>
  calculateQuotationTotalsFromPaise(
    Array.isArray(items)
      ? items.map((item) => ({ ...item, unitPricePaise: toPaise(item.unitPrice) }))
      : items,
    discount
  );

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
      <tr>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" align="center" valign="top" style="${COL_STYLE}color:#687185;">${esc(i + 1)}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" valign="top" style="${COL_STYLE}font-weight:bold;word-break:break-word;">${esc(item.name)}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" valign="top" style="${COL_STYLE}color:#50576a;word-break:break-word;">${esc(item.machine || "—")}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" valign="top" style="${COL_STYLE}color:#50576a;">${esc(item.itemCode || "—")}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" align="right" valign="top" style="${COL_STYLE}">${esc(item.quantity)}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" align="right" valign="top" style="${COL_STYLE}white-space:nowrap;">${formatINR(item.unitPricePaise)}</td>
        <td bgcolor="${i % 2 ? "#fcfafd" : "#ffffff"}" align="right" valign="top" style="${COL_STYLE}white-space:nowrap;font-weight:bold;">${formatINR(item.totalPaise)}</td>
      </tr>`)
    .join("");

  const summaryRow = (label, value) => `
    <tr>
      <td colspan="6" align="right" style="padding:9px 10px;font-size:13px;color:#687185;border-top:1px solid #eee6f0;">${esc(label)}</td>
      <td align="right" style="padding:9px 10px;white-space:nowrap;font-size:13px;color:#243047;border-top:1px solid #eee6f0;">${value}</td>
    </tr>`;

  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:20px 0;border-collapse:collapse;border:1px solid #ede8f0;">
    <thead>
      <tr>
        <th width="7%"  align="center" bgcolor="#f7f2f8" style="${HEAD_STYLE}">S. No.</th>
        <th width="29%" align="left"   bgcolor="#f7f2f8" style="${HEAD_STYLE}">Spare Part Description</th>
        <th width="20%" align="left"   bgcolor="#f7f2f8" style="${HEAD_STYLE}">Machine / Application</th>
        <th width="10%" align="left"   bgcolor="#f7f2f8" style="${HEAD_STYLE}">Item Code</th>
        <th width="8%"  align="right"  bgcolor="#f7f2f8" style="${HEAD_STYLE}">Qty</th>
        <th width="13%" align="right"  bgcolor="#f7f2f8" style="${HEAD_STYLE}">Unit Price (₹)</th>
        <th width="13%" align="right"  bgcolor="#f7f2f8" style="${HEAD_STYLE}">Total (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      ${summaryRow("Subtotal", formatINR(totals.subtotalPaise))}
      ${summaryRow("GST @ 18%", formatINR(totals.gstPaise))}
      ${summaryRow("Grand Total (Including GST)", formatINR(totals.grandTotalPaise))}
      ${summaryRow(
        totals.discountType === "percentage"
          ? `Discount (${totals.discountValue}%)`
          : totals.discountType === "fixed"
            ? `Discount (${formatINR(totals.discountValuePaise)})`
            : "Discount",
        `-${formatINR(totals.discountPaise)}`
      )}
      <tr>
        <td colspan="6" align="right" bgcolor="#faf5fb" style="padding:14px 10px;font-weight:bold;font-size:14px;border-top:2px solid #66116f;color:#66116f;">Final Amount Due</td>
        <td align="right" bgcolor="#faf5fb" style="padding:14px 10px;white-space:nowrap;font-weight:bold;font-size:17px;border-top:2px solid #66116f;color:#66116f;">${formatINR(totals.finalTotalPaise)}</td>
      </tr>
    </tbody>
  </table>`;
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
    `Discount${totals.discountType === "percentage" ? ` (${totals.discountValue}%)` : totals.discountType === "fixed" ? ` (${formatINR(totals.discountValuePaise)})` : ""}: -${formatINR(totals.discountPaise)}`,
    `Final Amount Due: ${formatINR(totals.finalTotalPaise)}`,
    "Discount is applied after GST.",
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
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print { thead { display: table-header-group; } tr { page-break-inside: avoid; break-inside: avoid; } }
    @media only screen and (max-width: 600px) {
      .main-pad { padding: 20px 14px !important; }
      .cust td { display: block !important; width: 100% !important; box-sizing: border-box; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f3f8;font-family:Arial,Helvetica,sans-serif;color:#243047;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f3f8" style="background-color:#f1f3f8;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="800" cellspacing="0" cellpadding="0" border="0" align="center" bgcolor="#ffffff" style="width:100%;max-width:800px;background-color:#ffffff;border:1px solid #e3e7ef;">

    <!-- HEADER -->
    <tr>
      <td align="center" bgcolor="#66116f" style="padding:30px 28px 26px;background-color:#66116f;">
        <div style="font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#ead9ef;">Unipackauto India Pvt. Ltd.</div>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:14px auto 10px;">
          <tr><td align="center" bgcolor="#7d2f86" style="padding:7px 16px;border:1px solid #b58bbb;background-color:#7d2f86;font-size:13px;color:#ffffff;word-break:break-all;">${esc(quotationNumber)}</td></tr>
        </table>
        <div style="margin:0 0 6px;font-size:30px;line-height:36px;font-weight:bold;color:#ffffff;">Spare Part Quotation</div>
        <div style="font-size:13px;color:#f3e9f5;">Date: ${esc(date)}</div>
      </td>
    </tr>

    <!-- BODY -->
    <tr>
      <td class="main-pad" bgcolor="#ffffff" style="padding:28px 30px;background-color:#ffffff;">
        <table class="cust" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 24px;border-bottom:1px solid #eee6f0;font-size:13px;">
          <tr>
            <td width="18%" style="width:18%;padding:8px 0;color:#8a8f9c;">Company Name</td>
            <td colspan="3" style="padding:8px 0;font-size:16px;font-weight:bold;color:#243047;">${esc(quote.company)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a8f9c;">Email</td>
            <td width="34%" style="width:34%;padding:8px 8px 8px 0;"><a href="mailto:${esc(quote.email)}" style="color:#66116f;text-decoration:none;">${esc(quote.email)}</a></td>
            <td width="16%" style="width:16%;padding:8px 0;color:#8a8f9c;">Phone</td>
            <td style="padding:8px 0;color:#243047;">${esc(quote.phone)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#8a8f9c;">Location</td>
            <td style="padding:8px 8px 8px 0;color:#243047;">${esc(quote.city)}, ${esc(quote.state)}</td>
            <td style="padding:8px 0;color:#8a8f9c;">Contact Person</td>
            <td style="padding:8px 0;color:#243047;">${esc(quote.contactName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0 14px;color:#8a8f9c;">Request ID</td>
            <td colspan="3" style="padding:8px 0 14px;font-size:12px;color:#9aa0ad;word-break:break-all;">${esc(quote.id)}</td>
          </tr>
        </table>
        <p style="margin:0 0 10px;font-size:14px;color:#243047;">Dear Sir/Madam,</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#243047;">Thank you for your enquiry regarding spare parts.</p>
        <p style="margin:0 0 22px;font-size:14px;line-height:22px;color:#243047;">Please find below our offer for the required spare parts.</p>
        <h2 style="margin:0 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:18px;">Spare Part Quotation</h2>
        ${buildItemisedTable(totals)}
        <p style="margin:12px 0;font-size:12px;color:#687185;">Discount is applied after GST.</p>
        <h2 style="margin:28px 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:17px;">Commercial Terms &amp; Conditions</h2>
        <ol style="margin:0;padding-left:22px;font-size:13px;line-height:20px;color:#243047;">${termsHtml}</ol>
        <h2 style="margin:28px 0 12px;padding-bottom:9px;border-bottom:2px solid #eee6f0;color:#41104f;font-size:17px;">Bank Details for Payment</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="8" border="0" bgcolor="#faf9fc" style="width:100%;border:1px solid #e5e7ef;background-color:#faf9fc;font-size:13px;">${bankHtml}</table>
        <p style="margin:22px 0 8px;font-size:13px;line-height:20px;color:#243047;">Kindly arrange the payment to enable us to process your order and dispatch the spare parts.</p>
        <p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#243047;">For any further assistance or technical clarification, please feel free to contact our team.</p>
        <p style="margin:0 0 22px;font-size:13px;line-height:20px;color:#243047;">We look forward to your valuable order and assure you of our best services.</p>
        ${quote.message ? `<p style="margin:18px 0;padding:14px;background-color:#faf7fb;border-left:3px solid #66116f;font-size:13px;color:#444444;"><strong style="color:#41104f;">Customer message:</strong><br>${esc(quote.message)}</p>` : ""}
        ${quote.attachment?.url ? `<p style="font-size:12px;color:#777777;margin-top:12px;">Attachment: <a href="${esc(quote.attachment.url)}" style="color:#66116f;">${esc(quote.attachment.name || "View file")}</a></p>` : ""}
        <p style="margin:0;font-size:13px;line-height:21px;color:#243047;">Best regards,<br><strong style="color:#41104f;">Spare Parts Division</strong><br><strong style="color:#41104f;">Unipackauto India Pvt. Ltd.</strong></p>
      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td align="center" bgcolor="#f7f5f9" style="padding:22px 30px;background-color:#f7f5f9;border-top:1px solid #e9e4ed;font-size:12px;line-height:23px;color:#50576a;">
        <strong style="font-size:14px;color:#41104f;">Unipackauto India Pvt. Ltd.</strong><br>
        <strong style="color:#50576a;">Phone:</strong> 9215521314, 7232001235, 9991226074<br>
        <a href="mailto:info@unipackauto.in" style="color:#63216f;text-decoration:none;">info@unipackauto.in</a> &nbsp;|&nbsp;
        <a href="mailto:services.upa@gmail.com" style="color:#63216f;text-decoration:none;">services.upa@gmail.com</a><br>
        <a href="mailto:uniquepackagingandautomation@gmail.com" style="color:#63216f;text-decoration:none;">uniquepackagingandautomation@gmail.com</a>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text: textLines.join("\n"), html, date, quotationNumber };
};

// ── SMTP transport factory ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getEmailConfiguration = (env = process.env) => {
  const adminEmail = env.ADMIN_EMAIL?.trim();
  const smtpUser = env.SMTP_USER?.trim();
  const ownerEmail = smtpUser || adminEmail;

  // ── 1. Gmail shorthand takes precedence over stale generic SMTP settings ─────
  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPass = env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

  if (gmailUser || gmailPass) {
    if (!gmailUser || !gmailPass)
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must both be set.");
    if (!EMAIL_RE.test(gmailUser))
      throw new Error("GMAIL_USER must be a valid Gmail address.");
    const to = ownerEmail || gmailUser;
    if (!EMAIL_RE.test(to))
      throw new Error("SMTP_USER, ADMIN_EMAIL, or GMAIL_USER must be a valid email address.");
    return {
      transport: { service: "gmail", auth: { user: gmailUser, pass: gmailPass } },
      from: gmailUser,
      to,
    };
  }

  // ── 2. Generic SMTP (smtp.gmail.com or any other host) ──────────────────────
  if (env.SMTP_HOST?.trim()) {
    const host   = env.SMTP_HOST.trim();
    const port   = Number(env.SMTP_PORT || 587);
    const secure = String(env.SMTP_SECURE || "").toLowerCase() === "true";
    const user   = smtpUser;
    const pass   = env.SMTP_PASS?.trim();
    const from   = (env.EMAIL_FROM?.trim()) || user;

    if (!ownerEmail || !EMAIL_RE.test(ownerEmail))
      throw new Error("SMTP_USER or ADMIN_EMAIL must be a valid email address.");
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
      to: ownerEmail,
    };
  }

  // ── 3. Nothing configured ────────────────────────────────────────────────────
  throw new Error(
    "Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD, or configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM. SMTP_USER is used as the owner notification recipient; ADMIN_EMAIL is the fallback."
  );
};

export const describeEmailFailure = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const rc   = Number(error?.responseCode || 0);

  if (code === "RECIPIENT_DELIVERY_FAILED") {
    return (error.deliveryFailures || [])
      .map(({ recipient, error: failure }) =>
        `Could not deliver email to ${recipient}: ${describeEmailFailure(failure)}`
      )
      .join(" ");
  }

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

  if (code === "RECIPIENT_NOT_ACCEPTED")
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

export async function deliverEmailToRecipients(transporter, message, recipients) {
  const uniqueRecipients = [...new Map(
    recipients.map((recipient) => [recipient.trim().toLowerCase(), recipient.trim()])
  ).values()];
  const results = await Promise.allSettled(uniqueRecipients.map(async (recipient) => {
    const info = await transporter.sendMail({ ...message, to: recipient });
    const accepted = (info.accepted || []).map((address) =>
      typeof address === "string" ? address : address.address
    );
    if (!accepted.some((address) => address?.toLowerCase() === recipient.toLowerCase())) {
      throw Object.assign(
        new Error(`SMTP did not accept the recipient ${recipient}.`),
        { code: "RECIPIENT_NOT_ACCEPTED" }
      );
    }
    return { recipient, info, accepted };
  }));
  const deliveryFailures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ recipient: uniqueRecipients[index], error: result.reason }]
      : []
  );
  if (deliveryFailures.length) {
    throw Object.assign(
      new Error("The quotation email could not be delivered to every recipient."),
      {
        code: "RECIPIENT_DELIVERY_FAILED",
        deliveryFailures,
        deliverySuccesses: results.flatMap((result, index) =>
          result.status === "fulfilled" ? [uniqueRecipients[index]] : []
        ),
      }
    );
  }

  const deliveries = results.map((result) => result.value);
  return {
    messageId: deliveries[0]?.info.messageId,
    response: deliveries[0]?.info.response,
    accepted: deliveries.flatMap((delivery) => delivery.accepted),
    deliveries: deliveries.map(({ recipient, info }) => ({
      recipient,
      messageId: info.messageId,
      response: info.response,
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Verify SMTP credentials without sending a message. */
export async function verifyQuoteEmail() {
  const { config, transporter } = makeTransporter();
  await transporter.verify();
  return { recipient: config.to };
}

/**
 * Build the short acknowledgement sent when a customer submits a request.
 */
export const buildQuoteRequestConfirmationEmail = (quote) => ({
  subject: "We received your spare parts quotation request",
  text: [
    `Hello ${quote.contactName},`,
    "",
    `We have received the spare parts quotation request for ${quote.company}.`,
    "Our team will review your request and contact you with a quotation.",
    "",
    `Request ID: ${quote.id || quote._id}`,
    "",
    "Thank you,",
    "Unipackauto India Pvt. Ltd.",
  ].join("\n"),
  html: `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f4f3f5;font-family:Arial,Helvetica,sans-serif;color:#243047;"><table role="presentation" style="max-width:600px;margin:auto;background:#fff;border:1px solid #e8e4eb;border-radius:8px;" cellspacing="0" cellpadding="0" width="100%"><tr><td style="padding:24px 28px;background:#66116f;color:#fff;font-size:20px;font-weight:bold;">Request received</td></tr><tr><td style="padding:28px;line-height:1.6;"><p>Hello ${esc(quote.contactName)},</p><p>We have received the spare parts quotation request for <strong>${esc(quote.company)}</strong>.</p><p>Our team will review your request and contact you with a quotation.</p><p style="color:#777;font-size:13px;">Request ID: ${esc(quote.id || quote._id)}</p><p>Thank you,<br><strong>Unipackauto India Pvt. Ltd.</strong></p></td></tr></table></body></html>`,
});

export const buildQuoteRequestOwnerEmail = (quote, totals) => {
  const requestId = quote.id || quote._id;
  const pricedItems = totals?.items || [];
  const parts = pricedItems.map((item, index) =>
    `${index + 1}. ${item.name} | ${item.machine || "—"} | Item code: ${item.itemCode || "—"} | Quantity: ${item.quantity} | Unit price: ${formatINR(item.unitPricePaise)} | Line total: ${formatINR(item.totalPaise)}`
  );
  const attachmentText = quote.attachment?.url
    ? `\nAttachment: ${quote.attachment.name || quote.attachment.url}\n${quote.attachment.url}`
    : "";
  const text = [
    "New spare parts quotation request",
    `Request ID: ${requestId}`,
    "",
    `Company: ${quote.company}`,
    `Contact: ${quote.contactName}`,
    `Email: ${quote.email}`,
    `Phone: ${quote.phone}`,
    `Location: ${quote.city}, ${quote.state}`,
    "",
    "Requested spare parts:",
    ...parts,
    "",
    `Subtotal: ${formatINR(totals.subtotalPaise)}`,
    `GST @ 18%: ${formatINR(totals.gstPaise)}`,
    `Estimated total including GST: ${formatINR(totals.grandTotalPaise)}`,
    "Estimate only; the final quotation and any discount will be confirmed by an admin.",
    "",
    "Commercial guidelines:",
    ...commercialTerms.map((term, index) => `${index + 1}. ${term}`),
    ...(quote.message ? ["", `Customer message: ${quote.message}`] : []),
    ...(attachmentText ? [attachmentText] : []),
  ].join("\n");
  const partRows = pricedItems.map((item, index) => `
    <tr>
      <td style="${COL_STYLE}">${index + 1}</td>
      <td style="${COL_STYLE}">${esc(item.name)}</td>
      <td style="${COL_STYLE}">${esc(item.machine || "—")}</td>
      <td style="${COL_STYLE}">${esc(item.itemCode || "—")}</td>
      <td align="right" style="${COL_STYLE}">${esc(item.quantity)}</td>
      <td align="right" style="${COL_STYLE}">${formatINR(item.unitPricePaise)}</td>
      <td align="right" style="${COL_STYLE}">${formatINR(item.totalPaise)}</td>
    </tr>`).join("");
  const termsHtml = commercialTerms.map((term) => {
    const separator = term.indexOf(":");
    return `<li><strong>${esc(term.slice(0, separator + 1))}</strong>${esc(term.slice(separator + 1))}</li>`;
  }).join("");
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f4f3f5;font-family:Arial,Helvetica,sans-serif;color:#243047;"><table role="presentation" style="max-width:900px;margin:auto;background:#fff;border:1px solid #e8e4eb;border-radius:8px;" cellspacing="0" cellpadding="0" width="100%"><tr><td style="padding:24px 28px;background:#66116f;color:#fff;font-size:20px;font-weight:bold;">New spare parts quotation request</td></tr><tr><td style="padding:28px;line-height:1.6;"><p><strong>Request ID:</strong> ${esc(requestId)}</p><p><strong>Company:</strong> ${esc(quote.company)}<br><strong>Contact:</strong> ${esc(quote.contactName)}<br><strong>Email:</strong> ${esc(quote.email)}<br><strong>Phone:</strong> ${esc(quote.phone)}<br><strong>Location:</strong> ${esc(quote.city)}, ${esc(quote.state)}</p><h2 style="font-size:17px;">Requested spare parts and catalogue pricing</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><thead><tr><th style="${HEAD_STYLE}">#</th><th style="${HEAD_STYLE}">Spare part</th><th style="${HEAD_STYLE}">Machine / application</th><th style="${HEAD_STYLE}">Item code</th><th style="${HEAD_STYLE}">Quantity</th><th style="${HEAD_STYLE}">Unit price</th><th style="${HEAD_STYLE}">Line total</th></tr></thead><tbody>${partRows}</tbody><tfoot><tr><td colspan="6" align="right" style="${COL_STYLE}">Subtotal</td><td align="right" style="${COL_STYLE}">${formatINR(totals.subtotalPaise)}</td></tr><tr><td colspan="6" align="right" style="${COL_STYLE}">GST @ 18%</td><td align="right" style="${COL_STYLE}">${formatINR(totals.gstPaise)}</td></tr><tr><td colspan="6" align="right" style="${COL_STYLE}font-weight:bold;">Estimated total including GST</td><td align="right" style="${COL_STYLE}font-weight:bold;">${formatINR(totals.grandTotalPaise)}</td></tr></tfoot></table><p style="font-size:12px;color:#687185;">Estimate only; the final quotation and any discount will be confirmed by an admin.</p><h2 style="font-size:17px;">Commercial guidelines</h2><ol>${termsHtml}</ol>${quote.message ? `<p><strong>Customer message:</strong><br>${esc(quote.message)}</p>` : ""}${quote.attachment?.url ? `<p><strong>Customer attachment:</strong> <a href="${esc(quote.attachment.url)}">${esc(quote.attachment.name || "View attachment")}</a></p>` : ""}</td></tr></table></body></html>`;
  return {
    subject: `New spare parts quotation request - ${requestId}`,
    text,
    html,
  };
};

export async function sendQuoteRequestNotification(quote, totals) {
  if (quote.quoteType !== "sparePart") {
    throw new Error("Only spare-part quote notifications are supported.");
  }
  const customerEmail = String(quote.email || "").trim();
  if (!EMAIL_RE.test(customerEmail)) {
    throw Object.assign(new Error("A valid customer email address is required for the quotation."), {
      status: 400,
    });
  }
  const { config, transporter } = makeTransporter();
  if (!totals?.items?.length) {
    throw new Error("Catalogue prices are required for the initial owner quotation email.");
  }
  const ownerEmail = buildQuoteRequestOwnerEmail(quote, totals);
  const customerEmailMessage = buildQuoteRequestConfirmationEmail(quote);
  const commonHeaders = {
    from: `"UnipackAuto Enquiries" <${config.from}>`,
    replyTo: quote.email,
  };

  if (config.to.toLowerCase() === customerEmail.toLowerCase()) {
    return deliverEmailToRecipients(transporter, {
      ...commonHeaders,
      ...ownerEmail,
    }, [config.to]);
  }

  const [ownerDelivery, customerDelivery] = await Promise.all([
    deliverEmailToRecipients(transporter, {
      ...commonHeaders,
      ...ownerEmail,
    }, [config.to]),
    deliverEmailToRecipients(transporter, {
      ...commonHeaders,
      ...customerEmailMessage,
    }, [customerEmail]),
  ]);
  return {
    deliveries: [...ownerDelivery.deliveries, ...customerDelivery.deliveries],
    accepted: [...ownerDelivery.accepted, ...customerDelivery.accepted],
  };
}

export async function sendFinalQuotation(quote, totals, { quotationNumber, issuedAt }) {
  if (quote.quoteType !== "sparePart") {
    throw new Error("Only spare-part quotations are supported.");
  }
  const customerEmail = String(quote.email || "").trim();
  if (!EMAIL_RE.test(customerEmail)) {
    throw Object.assign(new Error("A valid customer email address is required for the quotation."), {
      status: 400,
    });
  }
  const { config, transporter } = makeTransporter();
  const email = buildSparePartsQuotationEmail(quote, totals, quotationNumber, issuedAt);
  const delivery = await deliverEmailToRecipients(transporter, {
    from: `"UnipackAuto Enquiries" <${config.from}>`,
    replyTo: quote.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  }, [config.to, customerEmail]);
  return {
    ...delivery,
    totals,
    quotationNumber: email.quotationNumber,
  };
}

/** SMTP connection test — sends a plain test message to the configured owner recipient. */
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