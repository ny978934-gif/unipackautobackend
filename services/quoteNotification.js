import nodemailer from "nodemailer";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getEmailConfiguration = (env = process.env) => {
  const gmailUser = env.GMAIL_USER?.trim();
  const gmailAppPassword = env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  const to = env.ADMIN_EMAIL?.trim();

  if (Boolean(gmailUser) !== Boolean(gmailAppPassword)) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must both be configured to use Gmail.");
  }

  if (gmailUser && gmailAppPassword) {
    if (!to || !emailPattern.test(gmailUser) || !emailPattern.test(to)) {
      throw new Error("Set GMAIL_USER and ADMIN_EMAIL to valid email addresses.");
    }
    if (gmailUser.toLowerCase() !== to.toLowerCase()) {
      throw new Error("GMAIL_USER and ADMIN_EMAIL must be the same Gmail address.");
    }
    return {
      transport: {
        service: "gmail",
        auth: { user: gmailUser, pass: gmailAppPassword },
      },
      to: gmailUser,
      from: gmailUser,
    };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = env;
  const from = env.EMAIL_FROM?.trim() || SMTP_USER?.trim();
  if (!SMTP_HOST || !to || !from) {
    throw new Error(
      "Email notification is not configured. Set GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL or configure SMTP_HOST, ADMIN_EMAIL, and EMAIL_FROM."
    );
  }
  if (Boolean(SMTP_USER) !== Boolean(SMTP_PASS)) {
    throw new Error("SMTP_USER and SMTP_PASS must either both be configured or both be empty.");
  }
  const port = Number(SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a number between 1 and 65,535.");
  }
  if (!emailPattern.test(to) || !emailPattern.test(from)) {
    throw new Error("ADMIN_EMAIL and EMAIL_FROM must be valid email addresses.");
  }
  return {
    transport: {
      host: SMTP_HOST,
      port,
      secure: String(SMTP_SECURE || "").toLowerCase() === "true",
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    },
    to,
    from,
  };
};

export const describeEmailFailure = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) {
    return "Gmail rejected authentication. Confirm GMAIL_USER is the sending Gmail address, 2-Step Verification is enabled, and GMAIL_APP_PASSWORD is a current 16-character App Password (not your Gmail password).";
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNREFUSED") {
    return "The server could not connect to Gmail SMTP. Check VPS outbound SMTP access and DNS/firewall rules; Gmail SMTP uses port 465 (TLS) or 587 (STARTTLS).";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "The server could not resolve Gmail SMTP. Check the VPS DNS configuration and internet access.";
  }
  if (error instanceof Error && error.message.startsWith("Email notification is not configured.")) {
    return "Gmail settings are missing. Set GMAIL_USER, GMAIL_APP_PASSWORD, and ADMIN_EMAIL in the backend .env, then restart PM2 with --update-env.";
  }
  if (error instanceof Error && error.message.startsWith("GMAIL_USER and GMAIL_APP_PASSWORD")) {
    return "Gmail settings are incomplete. Set both GMAIL_USER and GMAIL_APP_PASSWORD in the backend .env, then restart PM2 with --update-env.";
  }
  return "Email delivery failed. Use the admin email setup test and check PM2 logs for the provider error.";
};

const createQuoteTransporter = () => {
  const config = getEmailConfiguration();
  return {
    config,
    transporter: nodemailer.createTransport(config.transport),
  };
};

export async function verifyQuoteEmail() {
  const { config, transporter } = createQuoteTransporter();
  await transporter.verify();
  return { recipient: config.to };
}

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
  const { config, transporter } = createQuoteTransporter();
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
