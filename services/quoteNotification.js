import nodemailer from "nodemailer";

const getEmailConfiguration = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  const to = process.env.ADMIN_EMAIL?.trim();
  const from = process.env.EMAIL_FROM?.trim() || SMTP_USER?.trim();
  if (!SMTP_HOST || !to || !from) {
    throw new Error("Email notification is not configured. Set SMTP_HOST, ADMIN_EMAIL, and EMAIL_FROM (or SMTP_USER).");
  }
  if (Boolean(SMTP_USER) !== Boolean(SMTP_PASS)) {
    throw new Error("SMTP_USER and SMTP_PASS must either both be configured or both be empty.");
  }
  const port = Number(SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a number between 1 and 65,535.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw new Error("ADMIN_EMAIL and EMAIL_FROM must be valid email addresses.");
  }
  return {
    host: SMTP_HOST,
    port,
    secure: String(SMTP_SECURE || "").toLowerCase() === "true",
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    to,
    from,
  };
};

const getQuoteSummary = (quote) => {
  if (quote.quoteType === "machine") {
    return [
      `Machine type: ${quote.machineType}`,
      `Model: ${quote.model}`,
      `Quantity: ${quote.quantity}`,
      `Specifications: ${quote.specifications || "Not provided"}`,
    ].join("\n");
  }
  return quote.parts.map((part, index) => [
    `Part ${index + 1}: ${part.partName}`,
    `Machine category / name: ${part.machine || [part.machineCategory, part.machineName].filter(Boolean).join(" / ")}`,
    `Item code: ${part.itemCode || "Not provided"}`,
    `Quantity: ${part.quantity}`,
  ].join("\n")).join("\n\n");
};

export async function sendQuoteNotification(quote) {
  const config = getEmailConfiguration();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.auth ? { auth: config.auth } : {}),
  });
  const attachmentLine = quote.attachment
    ? `Attachment: ${quote.attachment.url}`
    : "Attachment: None";
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    replyTo: quote.email,
    subject: `New ${quote.quoteType === "machine" ? "machine" : "spare part"} quote request from ${quote.company.replace(/[\r\n]/g, " ")}`,
    text: [
      "A new quote request was submitted on the UnipackAuto website.",
      "",
      `Company: ${quote.company}`,
      `Contact: ${quote.contactName}`,
      `Email: ${quote.email}`,
      `Phone: ${quote.phone}`,
      `Location: ${quote.city}, ${quote.state}`,
      "",
      "Requirement:",
      getQuoteSummary(quote),
      "",
      `Message: ${quote.message || "Not provided"}`,
      attachmentLine,
      "",
      `Request ID: ${quote.id}`,
    ].join("\n"),
  });
}
