import assert from "node:assert/strict";
import test from "node:test";
import { createAdminToken, verifyAdminToken } from "../middleware/adminAuth.js";
import User from "../models/User.js";
import {
  createUserToken,
  hashPassword,
  isAdminManagedUser,
  requirePortalUser,
  verifyPassword,
  verifyUserToken,
} from "../middleware/userAuth.js";

process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

test("stores admin-managed user passwords with bcrypt and verifies credentials", async () => {
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

test("portal login remains compatible with older admin accounts without a management marker", () => {
  assert.equal(isAdminManagedUser({
    managedByAdmin: true,
    passwordHash: "$2b$12$hash",
  }), true);
  assert.equal(isAdminManagedUser({
    passwordHash: "$2b$12$hash",
  }), true);
  assert.equal(isAdminManagedUser({
    managedByAdmin: false,
    passwordHash: "scrypt$salt$hash",
  }), false);
});

test("only portal login issues a portal-scoped customer JWT", () => {
  const id = "507f1f77bcf86cd799439011";
  const publicToken = createUserToken(id);
  const portalToken = createUserToken(id, 0, true);

  assert.equal(verifyUserToken(publicToken)?.portal, undefined);
  assert.equal(verifyUserToken(portalToken)?.portal, true);
});

test("portal APIs reject public customer JWTs and accept portal JWTs", async () => {
  const id = "507f1f77bcf86cd799439011";
  const originalFindOne = User.findOne;
  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        _id: id,
        name: "Test User",
        email: "test@example.com",
        status: "active",
        authVersion: 0,
      }),
    }),
  });

  const invoke = async (token) => {
    let statusCode = 200;
    let continued = false;
    const req = { get: () => `Bearer ${token}` };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    await requirePortalUser(req, res, () => {
      continued = true;
    });
    return { statusCode, continued };
  };

  try {
    assert.deepEqual(await invoke(createUserToken(id)), { statusCode: 403, continued: false });
    assert.deepEqual(await invoke(createUserToken(id, 0, true)), { statusCode: 200, continued: true });
  } finally {
    User.findOne = originalFindOne;
  }
});
