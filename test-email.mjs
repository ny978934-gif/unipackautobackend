/**
 * Quick email test — run with: node test-email.mjs
 * Uses the same Gmail/SMTP configuration as quote notifications.
 */
import "dotenv/config";
import { sendQuoteEmailTest } from "./services/quoteNotification.js";

try {
  const result = await sendQuoteEmailTest();
  console.log("SMTP accepted the test email.", {
    recipient: result.recipient,
    messageId: result.messageId,
    accepted: result.accepted,
  });
  console.log("SMTP acceptance does not guarantee Inbox placement. Check Sent, All Mail, Spam, and Gmail filters.");
} catch (error) {
  console.error("Email test failed:", error.message);
  if (error.code) console.error("Error code:", error.code);
  process.exitCode = 1;
}
