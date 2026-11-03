import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bankDetails, commercialTerms, formatINR } from "./quoteNotification.js";

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLogoPath = path.resolve(serverDirectory, "..", "client", "src", "assests", "logo.jpeg");
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 35;
const FOOTER_TOP = 194;
const BODY_BOTTOM = FOOTER_TOP + 16;
const COLORS = {
  black: "0.035 0.035 0.035",
  yellow: "1 0.78 0",
  ink: "0.12 0.15 0.20",
  muted: "0.38 0.41 0.46",
  line: "0.67 0.69 0.72",
  pale: "0.96 0.96 0.97",
  white: "1 1 1",
  purple: "0.25 0.06 0.31",
};

const pdfText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const money = (paise) => formatINR(paise).replace("\u20B9", "Rs ");
const moneyValue = (paise) => money(paise).replace(/^Rs\s*/, "");

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
  return String(value ?? "").split(/\r?\n/).flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean).flatMap((word) => {
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
  });
};

const formatDate = (date) => new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
}).format(date);

const escapeBytes = (buffer) => Buffer.from(buffer);

const drawHeader = (commands, quote, logoDimensions) => {
  const logoX = PAGE_MARGIN;
  const logoWidth = 194;
  const logoHeight = logoWidth * logoDimensions.height / logoDimensions.width;
  const logoY = 817 - logoHeight;
  commands.push(commandRect(logoX, logoY, logoWidth, logoHeight, {
    fill: COLORS.black,
    stroke: COLORS.black,
    lineWidth: 0,
  }));
  commands.push(`q ${logoWidth} 0 0 ${logoHeight} ${logoX} ${logoY} cm /Im1 Do Q`);
  commands.push(commandText("GSTIN:", 330, 808, { font: "F2", size: 7.5 }));
  commands.push(commandText("RAJ: 08AACCU9248D1Z6", 330, 795, { size: 7.2 }));
  commands.push(commandText("HR: 06AACCU9248D1ZA", 330, 782, { size: 7.2 }));
  commands.push(commandText("CIN: U29268HR2021PTC097744", 330, 769, { size: 7.2 }));
  commands.push(commandLine(PAGE_MARGIN, 746, PAGE_WIDTH - PAGE_MARGIN, 746, COLORS.yellow, 2));
  commands.push(commandText("SPARE PARTS QUOTATION", PAGE_MARGIN, 727, { font: "F2", size: 13, color: COLORS.purple }));
  commands.push(rightText(`Quotation No.: ${quote.quotation?.number || "Pending"}`, PAGE_WIDTH - PAGE_MARGIN, 727, { font: "F2", size: 7.2 }));
  commands.push(rightText(`Date: ${formatDate(quote.quotation?.sentAt || new Date())}`, PAGE_WIDTH - PAGE_MARGIN, 714, { size: 7 }));

  const boxTop = 704;
  const divider = 300;
  const billToLines = [
    ...wrapText(`Company: ${quote.company}`, 75),
    ...wrapText(`Contact: ${quote.contactName}`, 75),
    ...wrapText(`Email: ${quote.email}`, 75),
    ...wrapText(`Location: ${quote.city}, ${quote.state}`, 75),
  ];
  const boxBottom = Math.min(624, 678 - (billToLines.length - 1) * 8.5 - 18);
  commands.push(commandRect(PAGE_MARGIN, boxBottom, PAGE_WIDTH - PAGE_MARGIN * 2, boxTop - boxBottom));
  commands.push(commandLine(divider, boxBottom, divider, boxTop));
  commands.push(commandText("BILL TO", PAGE_MARGIN + 8, 691, { font: "F2", size: 7.2, color: COLORS.purple }));
  billToLines.forEach((line, index) => {
    commands.push(commandText(line, PAGE_MARGIN + 8, 678 - index * 8.5, {
      font: index === 0 ? "F2" : "F1",
      size: 6.2,
    }));
  });
  commands.push(commandText("QUOTATION DETAILS", divider + 10, 691, { font: "F2", size: 7.2, color: COLORS.purple }));
  commands.push(commandText(`Quotation No.: ${quote.quotation?.number || "Pending"}`, divider + 10, 678, { size: 6.8 }));
  commands.push(commandText(`Date: ${formatDate(quote.quotation?.sentAt || new Date())}`, divider + 10, 665, { size: 6.8 }));
  commands.push(commandText(`Request ID: ${quote.id || quote._id}`, divider + 10, 652, { size: 6.8 }));
  commands.push(commandText(`Phone: ${quote.phone}`, divider + 10, 639, { size: 6.8 }));
  return boxBottom - 36;
};

const columns = [
  { key: "number", label: ["S.No."], x: 35, width: 30, align: "center" },
  { key: "name", label: ["Item Name"], x: 65, width: 163, align: "left" },
  { key: "unitPrice", label: ["Unit Price", "(Rs.)"], x: 228, width: 62, align: "center" },
  { key: "quantity", label: ["Quantity"], x: 290, width: 42, align: "center" },
  { key: "discountPercentage", label: ["Discount", "(%)"], x: 332, width: 55, align: "center" },
  { key: "discountAmount", label: ["Discount Amount", "(Rs.)"], x: 387, width: 92, align: "center" },
  { key: "netAmount", label: ["Net Total", "(Rs.)"], x: 479, width: 81, align: "center" },
];
const cellCharacterWidths = {
  number: 5,
  name: 48,
  quantity: 8,
  unitPrice: 12,
  discountPercentage: 10,
  discountAmount: 18,
  netAmount: 15,
};

const drawTableHeader = (commands, y) => {
  commands.push(commandRect(PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN * 2, 30, {
    fill: COLORS.purple,
    stroke: COLORS.ink,
    lineWidth: 0.7,
  }));
  for (const column of columns) {
    column.label.forEach((label, lineIndex) => {
      const size = 6.1;
      const x = column.align === "center"
        ? column.x + (column.width - estimateTextWidth(label, size)) / 2
        : column.x + 4;
      commands.push(commandText(label, x, y + 19 - lineIndex * 9, {
        font: "F2",
        size,
        color: COLORS.white,
      }));
    });
  }
};

const drawRow = (commands, item, index, y, rowHeight) => {
  const values = {
    number: String(index + 1),
    name: [
      item.name,
      item.machine ? `Machine: ${item.machine}` : "",
      item.itemCode ? `Code: ${item.itemCode}` : "",
    ].filter(Boolean).join("\n"),
    quantity: `${item.quantity}${item.uom ? ` ${item.uom}` : ""}`,
    unitPrice: moneyValue(item.unitPricePaise),
    discountPercentage: `${item.discountPercentage.toFixed(2)}%`,
    discountAmount: moneyValue(item.discountPaise),
    netAmount: moneyValue(item.netTotalPaise),
  };
  commands.push(commandRect(PAGE_MARGIN, y - rowHeight, PAGE_WIDTH - PAGE_MARGIN * 2, rowHeight, {
    fill: index % 2 ? COLORS.pale : COLORS.white,
    stroke: COLORS.line,
    lineWidth: 0.35,
  }));
  for (const column of columns) {
    const text = values[column.key];
    const lines = wrapText(text, cellCharacterWidths[column.key]);
    lines.forEach((line, lineIndex) => {
      const x = column.align === "right"
        ? column.x + column.width - 4 - estimateTextWidth(line, 6.2)
        : column.align === "center"
          ? column.x + (column.width - estimateTextWidth(line, 6.2)) / 2
          : column.x + 4;
      commands.push(commandText(line, x, y - 12 - lineIndex * 8, { size: 6.2 }));
    });
  }
  for (const column of columns.slice(1)) {
    commands.push(commandLine(column.x, y - rowHeight, column.x, y, COLORS.line, 0.35));
  }
};

const drawSummary = (commands, totals, y) => {
  const rows = [
    { label: "Total", amount: money(totals.subtotalPaise) },
    { label: "GST (18%)", amount: money(totals.gstPaise) },
  ];
  let cursorY = y;
  for (const { label, amount } of rows) {
    cursorY -= 13;
    commands.push(rightText(label, 450, cursorY, { size: 7.5, color: COLORS.muted }));
    commands.push(rightText(amount, 556, cursorY, { font: "F2", size: 7.5 }));
  }
  cursorY -= 7;
  commands.push(commandRect(330, cursorY - 5, 230, 25, {
    fill: "0.98 0.94 0.77",
    stroke: COLORS.yellow,
    lineWidth: 0.8,
  }));
  commands.push(commandText("Final Amount", 338, cursorY + 3, { font: "F2", size: 7.5 }));
  commands.push(rightText(money(totals.finalTotalPaise), 552, cursorY + 3, { font: "F2", size: 8.5 }));
  return cursorY - 22;
};

const drawFooter = (commands, pageNumber, pageCount) => {
  commands.push(commandLine(PAGE_MARGIN, FOOTER_TOP, PAGE_WIDTH - PAGE_MARGIN, FOOTER_TOP, COLORS.black, 0.8));
  commands.push(commandText("BANK DETAILS", PAGE_MARGIN, 181, { font: "F2", size: 6.5, color: COLORS.purple }));
  commands.push(commandText("TERMS & CONDITIONS", 210, 181, { font: "F2", size: 6.5, color: COLORS.purple }));
  commands.push(commandText("Authorised Signatory", 455, 181, { font: "F2", size: 6.5, color: COLORS.purple }));

  bankDetails.forEach(([label, value], index) => {
    commands.push(commandText(`${label}: ${value}`, PAGE_MARGIN, 168 - index * 9, { size: 5.7 }));
  });
  let termY = 168;
  commercialTerms.forEach((term, index) => {
    for (const line of wrapText(`${index + 1}. ${term}`, 82)) {
      commands.push(commandText(line, 210, termY, { size: 5.5 }));
      termY -= 8;
    }
  });

  commands.push(commandLine(455, 137, 560, 137, COLORS.line, 0.6));
  commands.push(commandText("For UNIPACKAUTO INDIA PVT. LTD.", 455, 124, { font: "F2", size: 5.6 }));
  commands.push(commandLine(PAGE_MARGIN, 68, PAGE_WIDTH - PAGE_MARGIN, 68, COLORS.line, 0.6));
  commands.push(commandText("Place & PO: UNIPACKAUTO INDIA PRIVATE LIMITED", PAGE_MARGIN, 57, { font: "F2", size: 6.2 }));
  commands.push(commandText("Plot-02, Behind Shiv Shakti Oil Mill, Tehran-Thada Road, Vill. Thada, Bhiwadi, Distt. Alwar - 301019, Rajasthan.", PAGE_MARGIN, 47, { size: 5.6 }));
  commands.push(commandText("UDYAM: UDYAM-HR-14-00137 | Email: uniquepackagingandautomation@gmail.com; info@unipackauto.in", PAGE_MARGIN, 37, { size: 5.6 }));
  commands.push(commandText("Website: www.unipackauto.in / www.unipackauto.com | Call: 9215521314, 9991226074, 7232001235", PAGE_MARGIN, 27, { size: 5.6 }));
  commands.push(rightText(`Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - PAGE_MARGIN, 12, { size: 5.2, color: COLORS.muted }));
};

const itemRowHeight = (item) => {
  const cells = {
    name: [
      item.name,
      item.machine ? `Machine: ${item.machine}` : "",
      item.itemCode ? `Code: ${item.itemCode}` : "",
    ].filter(Boolean).join("\n"),
    quantity: `${item.quantity}${item.uom ? ` ${item.uom}` : ""}`,
    unitPrice: moneyValue(item.unitPricePaise),
    discountPercentage: `${item.discountPercentage.toFixed(2)}%`,
    discountAmount: moneyValue(item.discountPaise),
    netAmount: moneyValue(item.netTotalPaise),
  };
  const maximumLines = Math.max(
    1,
    ...Object.entries(cells).map(([key, value]) => wrapText(value, cellCharacterWidths[key]).length)
  );
  return Math.max(27, maximumLines * 8 + 14);
};

const createPages = (quote, totals, logoDimensions) => {
  const pages = [];
  let page = { commands: [], y: 0 };
  const startPage = () => {
    page = { commands: [], y: 0 };
    page.y = drawHeader(page.commands, quote, logoDimensions);
    drawTableHeader(page.commands, page.y);
    pages.push(page);
  };
  startPage();

  totals.items.forEach((item, index) => {
    const rowHeight = itemRowHeight(item);
    if (page.y - rowHeight - 80 < BODY_BOTTOM) startPage();
    drawRow(page.commands, item, index, page.y, rowHeight);
    page.y -= rowHeight;
  });

  if (page.y - 60 < BODY_BOTTOM) startPage();
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
  return createPdf(
    createPages(quote, totals, quotationLogo.dimensions),
    quotationLogo.buffer,
    quotationLogo.dimensions
  );
};
