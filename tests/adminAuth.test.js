import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminToken,
  hashPassword,
  verifyAdminToken,
  verifyPassword,
} from "../middleware/adminAuth.js";

test("stores admin passwords as salted scrypt hashes and verifies credentials", async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("creates signed, expiring admin tokens and rejects tampering", () => {
  process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
  const token = createAdminToken("507f1f77bcf86cd799439011");
  const [header, payload, signature] = token.split(".");
  const tamperedToken = `${header}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

  assert.equal(verifyAdminToken(token)?.sub, "507f1f77bcf86cd799439011");
  assert.equal(verifyAdminToken(tamperedToken), null);
  assert.equal(verifyAdminToken("not.a.jwt"), null);
});

test("rejects missing or undersized JWT secrets", () => {
  const configuredSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  assert.throws(() => createAdminToken("admin-id"), {
    message: "JWT_SECRET must be configured with at least 32 characters.",
    status: 503,
  });
  if (configuredSecret) process.env.JWT_SECRET = configuredSecret;
});
