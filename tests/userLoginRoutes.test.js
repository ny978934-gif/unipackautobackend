import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import User from "../models/User.js";
import userRoutes from "../routes/userRoutes.js";
import {
  hashLegacyPassword,
  hashPassword,
  verifyUserToken,
} from "../middleware/userAuth.js";

process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

test("public and admin-route user logins authenticate separate account types", async () => {
  const customerPassword = "customer password";
  const portalPassword = "portal password";
  const users = [
    {
      _id: "507f1f77bcf86cd799439011",
      name: "Website Customer",
      email: "customer@example.com",
      userId: "UPA-CUSTOMER",
      passwordHash: await hashLegacyPassword(customerPassword),
      status: "active",
      deletedAt: null,
      managedByAdmin: false,
      authVersion: 0,
    },
    {
      _id: "507f1f77bcf86cd799439012",
      name: "Portal User",
      email: "portal@example.com",
      userId: "UPA-PORTAL",
      passwordHash: await hashPassword(portalPassword),
      status: "active",
      deletedAt: null,
      authVersion: 0,
    },
  ];
  const originalFindOne = User.findOne;
  User.findOne = (filter) => ({
    select: async () => users.find((user) =>
      user.email === filter.email &&
      (!filter.userId || user.userId === filter.userId) &&
      user.status === filter.status &&
      user.deletedAt === filter.deletedAt
    ) || null,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/users", userRoutes);
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const sendLogin = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/users/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };

    const publicLogin = await sendLogin("login", {
      email: "customer@example.com",
      password: customerPassword,
    });
    assert.equal(publicLogin.status, 200);
    assert.equal(verifyUserToken(publicLogin.data.token)?.portal, undefined);

    const portalLogin = await sendLogin("portal-login", {
      email: "portal@example.com",
      userId: "upa-portal",
      password: portalPassword,
    });
    assert.equal(portalLogin.status, 200);
    assert.equal(verifyUserToken(portalLogin.data.token)?.portal, true);

    assert.equal((await sendLogin("login", {
      email: "portal@example.com",
      password: portalPassword,
    })).status, 401);
    assert.equal((await sendLogin("portal-login", {
      email: "customer@example.com",
      userId: "UPA-CUSTOMER",
      password: customerPassword,
    })).status, 401);
  } finally {
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
