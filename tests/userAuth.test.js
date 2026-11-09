import assert from "node:assert/strict";
import test from "node:test";
import { createAdminToken, verifyAdminToken } from "../middleware/adminAuth.js";
import { createUserToken, hashPassword, verifyPassword, verifyUserToken } from "../middleware/userAuth.js";

process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

test("stores customer passwords with bcrypt and verifies credentials", async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);

  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("keeps legacy customer scrypt password hashes verifiable", async () => {
  const { hashPassword: hashLegacyPassword } = await import("../middleware/adminAuth.js");
  const password = "legacy customer password";
  const hash = await hashLegacyPassword(password);

  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("customer and admin JWT roles cannot be used interchangeably", () => {
  const id = "507f1f77bcf86cd799439011";
  const userToken = createUserToken(id);
  const adminToken = createAdminToken(id);

  assert.equal(verifyUserToken(userToken)?.role, "user");
  assert.equal(verifyAdminToken(userToken), null);
  assert.equal(verifyAdminToken(adminToken)?.role, "admin");
  assert.equal(verifyUserToken(adminToken), null);
});

test("customer JWTs carry the account auth version", () => {
  const token = createUserToken("507f1f77bcf86cd799439011", 3);

  assert.equal(verifyUserToken(token)?.ver, 3);
});
