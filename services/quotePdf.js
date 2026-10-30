import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiscountPercentage, formatINR } from "./quoteNotification.js";

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLogoPath = path.resolve(serverDirectory, "..", "client", "src", "assests", "logo.jpeg");
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 35;
const FOOTER_TOP = 126;
const TABLE_HEADER_Y = 618;
const BODY_BOTTOM = FOOTER_TOP + 16;
const COLORS = {
  black: "0.035 0.035 0.035",
  yellow: "1 0.78 0",
  ink: "0.12 0.15 0.20",
  muted: "0.38 0.41 0.46",
  line: "0.67 0.69 0.72",
  pale: "0.96 0.96 0.97",
  white: "1 1 1",
};

const pdfText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const money = (paise) => formatINR(paise).replace("\u20B9", "Rs ");

const findJpegDimensions = (buffer, logoPath) => {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        components: buffer[offset + 9],
      };
    }
    offset += segmentLength + 2;
  }
  throw new Error(`Quotation logo is not a supported JPEG image: ${logoPath}`);
};

const loadLogo = () => {
  const logoPath = path.resolve(process.env.QUOTATION_LOGO_PATH || defaultLogoPath);
  const buffer = readFileSync(logoPath);
  return { buffer, dimensions: findJpegDimensions(buffer, logoPath) };
};

const commandText = (text, x, y, { font = "F1", size = 8, color = COLORS.ink } = {}) =>
  `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(text)}) Tj ET`;

const commandLine = (x1, y1, x2, y2, color = COLORS.line, width = 0.6) =>
  `${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;

const commandRupeeGlyph = (x, y, size = 8, color = COLORS.muted) => {
  const width = size * 0.72;
  const height = size;
  const strokeWidth = size * 0.08;
  return [
    `${color} RG ${strokeWidth.toFixed(2)} w`,
    `${x.toFixed(2)} ${(y + height).toFixed(2)} m ${(x + width).toFixed(2)} ${(y + height).toFixed(2)} l S`,
    `${x.toFixed(2)} ${(y + height - size * 0.2).toFixed(2)} m ${(x + width).toFixed(2)} ${(y + height - size * 0.2).toFixed(2)} l S`,
    `${(x + size * 0.08).toFixed(2)} ${(y + height - size * 0.05).toFixed(2)} m ${(x + width * 0.62).toFixed(2)} ${(y + height - size * 0.05).toFixed(2)} l ${(x + width).toFixed(2)} ${(y + height - size * 0.3).toFixed(2)} l ${(x + width * 0.62).toFixed(2)} ${(y + height - size * 0.52).toFixed(2)} l ${(x + size * 0.08).toFixed(2)} ${(y + height - size * 0.52).toFixed(2)} l ${(x + width).toFixed(2)} ${y.toFixed(2)} l S`,
    `${x.toFixed(2)} ${(y + size * 0.23).toFixed(2)} m ${(x + width).toFixed(2)} ${(y + size * 0.23).toFixed(2)} l S`,
  ].join("\n");
};

const commandRect = (x, y, width, height, { fill, stroke = COLORS.line, lineWidth = 0.6 } = {}) => {
  const commands = [];
  if (fill) commands.push(`${fill} rg`);
  if (stroke) commands.push(`${stroke} RG ${lineWidth} w`);
  commands.push(`${x} ${y} ${width} ${height} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  return commands.join("\n");
};

const estimateTextWidth = (text, size) => String(text).length * size * 0.5;

const rightText = (text, right, y, options = {}) =>
  commandText(text, right - estimateTextWidth(text, options.size || 8), y, options);

const wrapText = (value, maxCharacters) => {
  const words = String(value ?? "").split(/\s+/).filter(Boolean).flatMap((word) => {
    const segments = [];
    while (word.length > maxCharacters) {
      segments.push(word.slice(0, maxCharacters));
      word = word.slice(maxCharacters);
    }
    if (word) segments.push(word);
    return segments;
  });
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
};

const formatDate = (date) => new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
}).format(date);

const escapeBytes = (buffer) => Buffer.from(buffer);

const drawHeader = (commands, quote) => {
  commands.push(commandText("DELIVERY CHALLAN", PAGE_MARGIN, 817, { font: "F2", size: 9 }));
  commands.push(commandRect(PAGE_MARGIN, 746, PAGE_WIDTH - PAGE_MARGIN * 2, 64, {
    fill: COLORS.black,
    stroke: COLORS.black,
    lineWidth: 0,
  }));
  commands.push(`${COLORS.yellow} rg ${PAGE_MARGIN + 22} 810 m ${PAGE_WIDTH - PAGE_MARGIN - 8} 810 l ${PAGE_WIDTH - PAGE_MARGIN - 45} 797 l ${PAGE_MARGIN + 22} 797 l f`);
  commands.push(`q 218 0 0 73 ${PAGE_MARGIN + 9} 741 cm /Im1 Do Q`);
  commands.push(commandText("Packaging Automation", 365, 779, { font: "F2", size: 9, color: COLORS.white }));
  commands.push(commandText("Bhiwadi, Rajasthan, India", 365, 765, { size: 7, color: COLORS.white }));
  commands.push(commandText("Phone: 9215521314, 7232001235", 365, 752, { size: 6.5, color: COLORS.white }));
  commands.push(commandText("UNIPACKAUTO INDIA PRIVATE LIMITED", PAGE_MARGIN, 728, { font: "F2", size: 14 }));
  commands.push(commandLine(PAGE_MARGIN, 720, PAGE_WIDTH - PAGE_MARGIN, 720, COLORS.black, 1));

  const boxTop = 710;
  const boxBottom = 664;
  const divider = 365;
  commands.push(commandRect(PAGE_MARGIN, boxBottom, PAGE_WIDTH - PAGE_MARGIN * 2, boxTop - boxBottom));
  commands.push(commandLine(divider, boxBottom, divider, boxTop));
  commands.push(commandText("BILL TO", PAGE_MARGIN + 7, 699, { font: "F2", size: 7 }));
  commands.push(commandText(quote.company, PAGE_MARGIN + 7, 687, { font: "F2", size: 8 }));
  commands.push(commandText(`Contact: ${quote.contactName}`, PAGE_MARGIN + 7, 676, { size: 7 }));
  commands.push(commandText(`${quote.city}, ${quote.state}`, PAGE_MARGIN + 7, 666, { size: 7 }));
  commands.push(commandText("Quotation No.", divider + 9, 699, { font: "F2", size: 7 }));
  commands.push(commandText(quote.quotation?.number || "Pending", divider + 75, 699, { size: 7 }));
  commands.push(commandText("Quotation Date", divider + 9, 684, { font: "F2", size: 7 }));
  commands.push(commandText(formatDate(quote.quotation?.sentAt || new Date()), divider + 75, 684, { size: 7 }));
  commands.push(commandText("Request ID", divider + 9, 669, { font: "F2", size: 7 }));
  commands.push(commandText(quote.id || quote._id, divider + 75, 669, { size: 7 }));
  commands.push(commandText(`Email: ${quote.email}`, PAGE_MARGIN, 650, { size: 7, color: COLORS.muted }));
  commands.push(commandText(`Phone: ${quote.phone}`, PAGE_MARGIN + 260, 650, { size: 7, color: COLORS.muted }));
};

const columns = [
  { key: "number", label: "No.", x: 35, width: 25, align: "center" },
  { key: "name", label: "ITEM DESCRIPTION", x: 60, width: 200, align: "left" },
  { key: "code", label: "ITEM CODE", x: 260, width: 58, align: "left" },
  { key: "quantity", label: "QUANTITY", x: 318, width: 38, align: "right" },
  { key: "unitPrice", label: "RATE (Rs)", x: 356, width: 68, align: "right" },
  { key: "amount", label: "NET TOTAL (Rs)", x: 424, width: 136, align: "right" },
];
const cellCharacterWidths = {
  number: 4,
  name: 49,
  code: 12,
  quantity: 6,
  unitPrice: 12,
  amount: 13,
};

const drawTableHeader = (commands) => {
  const y = TABLE_HEADER_Y;
  commands.push(commandRect(PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN * 2, 20, {
    fill: "0.91 0.89 0.95",
    stroke: COLORS.ink,
    lineWidth: 0.7,
  }));
  for (const column of columns) {
    const textY = y + 7;
    const x = column.align === "right"
      ? column.x + column.width - 4 - estimateTextWidth(column.label, 6)
      : column.align === "center"
        ? column.x + (column.width - estimateTextWidth(column.label, 6)) / 2
        : column.x + 4;
    commands.push(commandText(column.label, x, textY, { font: "F2", size: 6 }));
  }
};

const drawRow = (commands, item, index, y, rowHeight) => {
  const values = {
    number: String(index + 1),
    name: item.name,
    code: item.itemCode || "—",
    quantity: String(item.quantity),
    unitPrice: money(item.unitPricePaise),
    amount: money(item.totalPaise),
  };
  commands.push(commandRect(PAGE_MARGIN, y - rowHeight, PAGE_WIDTH - PAGE_MARGIN * 2, rowHeight, {
    fill: index % 2 ? COLORS.pale : COLORS.white,
    stroke: COLORS.line,
    lineWidth: 0.35,
  }));
  for (const column of columns) {
    const text = column.key === "name" && item.machine
      ? `${values[column.key]} (${item.machine})`
      : values[column.key];
    const lines = wrapText(text, cellCharacterWidths[column.key]);
    lines.forEach((line, lineIndex) => {
      const x = column.align === "right"
        ? column.x + column.width - 4 - estimateTextWidth(line, 6.5)
        : column.align === "center"
          ? column.x + (column.width - estimateTextWidth(line, 6.5)) / 2
          : column.x + 4;
      commands.push(commandText(line, x, y - 12 - lineIndex * 9, { size: 6.5 }));
    });
  }
  for (const column of columns.slice(1)) {
    commands.push(commandLine(column.x, y - rowHeight, column.x, y, COLORS.line, 0.35));
  }
};

const drawSummary = (commands, totals, y) => {
  const rows = [
    { label: "NET TOTAL", amount: money(totals.subtotalPaise) },
    { label: "GST @ 18%", amount: money(totals.gstPaise) },
    { label: "GROSS TOTAL", amount: money(totals.grandTotalPaise) },
    { label: "DISCOUNT PERCENTAGE (%)", amount: formatDiscountPercentage(totals) },
    { label: "DISCOUNT AMOUNT", amount: money(totals.discountPaise), currency: true },
  ];
  let cursorY = y;
  for (const { label, amount, currency } of rows) {
    cursorY -= 13;
    if (currency) {
      const labelPrefix = `${label} (`;
      const labelX = 475 - estimateTextWidth(labelPrefix, 8) - 7 - estimateTextWidth(")", 8);
      commands.push(commandText(labelPrefix, labelX, cursorY, { size: 8, color: COLORS.muted }));
      commands.push(commandRupeeGlyph(labelX + estimateTextWidth(labelPrefix, 8) + 1, cursorY - 1));
      commands.push(commandText(")", labelX + estimateTextWidth(labelPrefix, 8) + 8, cursorY, { size: 8, color: COLORS.muted }));

      const amountValue = amount.replace(/^Rs\s*/, "");
      const amountX = 556 - estimateTextWidth(amountValue, 8) - estimateTextWidth("-", 8) - 8;
      commands.push(commandText("-", amountX, cursorY, { font: "F2", size: 8 }));
      commands.push(commandRupeeGlyph(amountX + estimateTextWidth("-", 8), cursorY - 1));
      commands.push(commandText(amountValue, amountX + estimateTextWidth("-", 8) + 8, cursorY, { font: "F2", size: 8 }));
    } else {
      commands.push(rightText(label, 475, cursorY, { size: 8, color: COLORS.muted }));
      commands.push(rightText(amount, 556, cursorY, { font: "F2", size: 8 }));
    }
  }
  cursorY -= 7;
  commands.push(commandRect(355, cursorY - 5, 205, 23, {
    fill: "0.98 0.94 0.77",
    stroke: COLORS.yellow,
    lineWidth: 0.8,
  }));
  commands.push(commandText("FINAL PAYABLE AMOUNT", 362, cursorY + 3, { font: "F2", size: 8 }));
  commands.push(rightText(money(totals.finalTotalPaise), 552, cursorY + 3, { font: "F2", size: 9 }));
  commands.push(commandText("Discount is applied after GST.", 355, cursorY - 15, { size: 6.5, color: COLORS.muted }));
  return cursorY - 22;
};

const terms = [
  "GST: 18% Extra or as actual as per Govt. Norms.",
  "Freight charges: Extra, as applicable.",
  "Payment terms: 100% advance payment against the proforma invoice.",
  "Dispatch after receipt of payment confirmation.",
  "Contact our technical team for assistance or clarification.",
];

const drawFooter = (commands, pageNumber, pageCount) => {
  commands.push(commandLine(PAGE_MARGIN, FOOTER_TOP, PAGE_WIDTH - PAGE_MARGIN, FOOTER_TOP, COLORS.black, 0.8));
  commands.push(commandText("BANK DETAILS", PAGE_MARGIN, 113, { font: "F2", size: 6.5 }));
  commands.push(commandText("UNIPACKAUTO INDIA PRIVATE LIMITED", PAGE_MARGIN, 103, { font: "F2", size: 6 }));
  commands.push(commandText("ICICI Bank | Account: 174405500608 | IFSC: ICIC0001744", PAGE_MARGIN, 94, { size: 5.7 }));
  commands.push(commandText("Branch: Tapukera", PAGE_MARGIN, 85, { size: 5.7 }));
  commands.push(commandText("TERMS & CONDITIONS", 330, 113, { font: "F2", size: 6.5 }));
  terms.forEach((term, index) => {
    commands.push(commandText(`${index + 1}. ${term}`, 330, 103 - index * 8, { size: 5.2 }));
  });
  commands.push(commandLine(PAGE_MARGIN, 46, PAGE_WIDTH - PAGE_MARGIN, 46, COLORS.line, 0.5));
  commands.push(commandText("Office No. 2, Behind Shiv Shakti Oil Meal, Thada - Trehan Road, Alwar Road, Bhiwadi, Rajasthan - 301018", PAGE_MARGIN, 35, { size: 5.5 }));
  commands.push(commandText("Phone: 9215521314, 7232001235, 9991226074 | info@unipackauto.in | services.upa@gmail.com | uniquepackagingandautomation@gmail.com", PAGE_MARGIN, 25, { size: 4.7 }));
  commands.push(rightText(`Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - PAGE_MARGIN, 14, { size: 5.5, color: COLORS.muted }));
};

const itemRowHeight = (item) => {
  const cells = {
    name: item.machine ? `${item.name} (${item.machine})` : item.name,
    code: item.itemCode || "—",
    quantity: item.quantity,
    totalQuantity: item.quantity,
    unitPrice: money(item.unitPricePaise),
    amount: money(item.totalPaise),
  };
  const maximumLines = Math.max(
    1,
    ...Object.entries(cells).map(([key, value]) => wrapText(value, cellCharacterWidths[key]).length)
  );
  return Math.max(25, maximumLines * 9 + 12);
};

const createPages = (quote, totals) => {
  const pages = [];
  let page = { commands: [], y: TABLE_HEADER_Y };
  const startPage = () => {
    page = { commands: [], y: TABLE_HEADER_Y };
    drawHeader(page.commands, quote);
    drawTableHeader(page.commands);
    pages.push(page);
  };
  startPage();

  totals.items.forEach((item, index) => {
    const rowHeight = itemRowHeight(item);
    if (page.y - rowHeight - 100 < BODY_BOTTOM) startPage();
    drawRow(page.commands, item, index, page.y, rowHeight);
    page.y -= rowHeight;
  });

  if (page.y - 100 < BODY_BOTTOM) startPage();
  drawSummary(page.commands, totals, page.y - 4);
  pages.forEach(({ commands }, index) => drawFooter(commands, index + 1, pages.length));
  return pages;
};

const createImageObject = (logo, logoDimensions) => {
  const colorSpace = logoDimensions.components === 1 ? "/DeviceGray" : "/DeviceRGB";
  return Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${logoDimensions.width} /Height ${logoDimensions.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`,
      "ascii"
    ),
    escapeBytes(logo),
    Buffer.from("\nendstream", "ascii"),
  ]);
};

const createPdf = (pages, logo, logoDimensions) => {
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    null,
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>", "ascii"),
    createImageObject(logo, logoDimensions),
  ];
  const pageObjectIds = [];

  for (const page of pages) {
    const stream = Buffer.from(page.commands.join("\n"), "ascii");
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageObjectIds.push(`${pageId} 0 R`);
    objects.push(
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents ${contentId} 0 R >>`, "ascii"),
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

export const buildQuotationPdf = (quote, totals) => {
  const quotationLogo = loadLogo();
  return createPdf(createPages(quote, totals), quotationLogo.buffer, quotationLogo.dimensions);
};
