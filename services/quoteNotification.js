import nodemailer from "nodemailer";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
