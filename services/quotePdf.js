import { formatINR } from "./quoteNotification.js";

const pdfText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const wrapText = (value, maxLength = 92) => {
  const words = String(value ?? "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

const money = (paise) => formatINR(paise).replace("\u20B9", "Rs ");

const createQuotationLines = (quote, totals) => {
  const lines = [
    "UNIPACKAUTO INDIA PRIVATE LIMITED",
    "SPARE PART QUOTATION",
    `Quotation: ${quote.quotation?.number || "Pending"}`,
    `Date: ${quote.quotation?.sentAt ? new Date(quote.quotation.sentAt).toLocaleDateString("en-IN") : "—"}`,
    "",
    `Company: ${quote.company}`,
    `Contact: ${quote.contactName}`,
    `Email: ${quote.email}`,
    `Phone: ${quote.phone}`,
    `Location: ${quote.city}, ${quote.state}`,
    `Request ID: ${quote.id || quote._id}`,
    "",
    "ITEMS",
    "No. | Spare part | Machine / application | Item code | Qty | Unit price | Amount",
  ];

  totals.items.forEach((item, index) => {
    lines.push(...wrapText(
      `${index + 1}. ${item.name} | ${item.machine || "-"} | ${item.itemCode || "-"} | ${item.quantity} | ${money(item.unitPricePaise)} | ${money(item.totalPaise)}`,
      92
    ));
  });

  const discountDescription = totals.discountType === "percentage"
    ? `Discount (${totals.discountValue}%): ${money(totals.discountPaise)}`
    : totals.discountType === "fixed"
      ? `Discount (${money(totals.discountValuePaise)}): ${money(totals.discountPaise)}`
      : `Discount: ${money(totals.discountPaise)}`;
  lines.push(
    "",
    `Subtotal: ${money(totals.subtotalPaise)}`,
    `GST @ 18%: ${money(totals.gstPaise)}`,
    `Total including GST: ${money(totals.grandTotalPaise)}`,
    discountDescription,
    `FINAL AMOUNT DUE: ${money(totals.finalTotalPaise)}`,
    "",
    "Discount is applied after GST.",
    "",
    "Commercial Terms & Conditions:",
    "1. GST: 18% Extra or as actual as per Govt. Norms.",
    "2. Freight charges: Extra, as applicable.",
    "3. Payment terms: 100% advance payment against the proforma invoice.",
    "4. Dispatch after receipt of payment confirmation.",
    "5. Contact our technical team for assistance or clarification.",
    "",
    "Bank Details for Payment",
    "Account Holder: UNIPACKAUTO INDIA PRIVATE LIMITED",
    "Bank: ICICI Bank | Branch: Tapukera",
    "Account No.: 174405500608 | IFSC: ICIC0001744",
    "",
    "Unipackauto India Pvt. Ltd. | 9215521314, 7232001235, 9991226074",
    "info@unipackauto.in"
  );
  return lines.flatMap((line) => wrapText(line));
};

const createPageStream = (lines) => {
  const commands = ["BT", "/F1 9 Tf", "50 790 Td", "12 TL"];
  for (const line of lines) {
    commands.push(`(${pdfText(line)}) Tj`, "T*");
  }
  commands.push("ET");
  return Buffer.from(commands.join("\n"), "ascii");
};

export const buildQuotationPdf = (quote, totals) => {
  const allLines = createQuotationLines(quote, totals);
  const linesPerPage = 61;
  const pages = [];
  for (let index = 0; index < allLines.length; index += linesPerPage) {
    pages.push(allLines.slice(index, index + linesPerPage));
  }
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    null,
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"),
  ];
  const pageObjectIds = [];

  for (const lines of pages) {
    const stream = createPageStream(lines);
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageObjectIds.push(`${pageId} 0 R`);
    objects.push(
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`, "ascii"),
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("\nendstream", "ascii"),
      ])
    );
  }

  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.join(" ")}] /Count ${pages.length} >>`, "ascii");
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let byteLength = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(wrapped);
    byteLength += wrapped.length;
  });

  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
};
