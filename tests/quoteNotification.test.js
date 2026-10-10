import assert from "node:assert/strict";
import test from "node:test";
import {
  describeEmailFailure,
  getEmailConfiguration,
} from "../services/quoteNotification.js";

test("configures Gmail notifications and removes spaces from grouped app passwords", () => {
  const config = getEmailConfiguration({
    GMAIL_USER: "quotes@unipackauto.in",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    ADMIN_EMAIL: "quotes@unipackauto.in",
    SMTP_HOST: "smtp.old-provider.example",
    SMTP_USER: "old-sender@example.com",
    SMTP_PASS: "old-password",
  });

  assert.deepEqual(config.transport, {
    service: "gmail",
    auth: { user: "quotes@unipackauto.in", pass: "abcdefghijklmnop" },
  });
  assert.equal(config.from, "quotes@unipackauto.in");
  assert.equal(config.to, "quotes@unipackauto.in");
});

test("rejects partially configured Gmail credentials", () => {
  assert.throws(
    () => getEmailConfiguration({ GMAIL_USER: "quotes@unipackauto.in", ADMIN_EMAIL: "sales@unipackauto.in" }),
    /GMAIL_USER and GMAIL_APP_PASSWORD/
  );
});

test("rejects a Gmail recipient that differs from the sending Gmail account", () => {
  assert.throws(
    () => getEmailConfiguration({
      GMAIL_USER: "quotes@unipackauto.in",
      GMAIL_APP_PASSWORD: "abcdefghijklmnop",
      ADMIN_EMAIL: "sales@unipackauto.in",
    }),
    /GMAIL_USER and ADMIN_EMAIL must be the same/
  );
});

test("retains custom SMTP configuration when Gmail credentials are not set", () => {
  const config = getEmailConfiguration({
    ADMIN_EMAIL: "sales@unipackauto.in",
    EMAIL_FROM: "quotes@unipackauto.in",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-password",
  });

  test("gives actionable guidance for common Gmail authentication and VPS network failures", () => {
    assert.match(
      describeEmailFailure(Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 })),
      /App Password/
    );
    assert.match(
      describeEmailFailure(Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" })),
      /outbound SMTP/
    );
  });

  assert.deepEqual(config.transport, {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "smtp-user", pass: "smtp-password" },
  });
});
