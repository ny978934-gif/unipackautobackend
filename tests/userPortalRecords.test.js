import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import Inquiry from "../models/Inquiry.js";
import QuoteRequest from "../models/QuoteRequest.js";
import User from "../models/User.js";
import { createUserToken } from "../middleware/userAuth.js";
import userRoutes from "../routes/userRoutes.js";

process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

test("portal quote reads and status updates are limited to assigned records", async () => {
  const userId = "507f1f77bcf86cd799439011";
  const quoteId = "507f1f77bcf86cd799439012";
  const token = createUserToken(userId, 0, true);
  const originalFindOne = User.findOne;
  const originalQuoteFind = QuoteRequest.find;
  const originalQuoteFindOne = QuoteRequest.findOne;
  const originalQuoteFindOneAndUpdate = QuoteRequest.findOneAndUpdate;
  const originalInquiryFind = Inquiry.find;
  let listFilter;
  let updateFilter;
  const ownedQuoteFilters = [];

  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        name: "Assigned User",
        email: "assigned@example.com",
        status: "active",
        authVersion: 0,
      }),
    }),
  });
  QuoteRequest.find = (filter) => {
    listFilter = filter;
    return {
      select() { return this; },
      populate() { return this; },
      sort() { return this; },
      lean: async () => [{ _id: quoteId, assignedUser: userId }],
    };
  };
  QuoteRequest.findOne = async (filter) => {
    ownedQuoteFilters.push(filter);
    return null;
  };
  QuoteRequest.findOneAndUpdate = (filter) => {
    updateFilter = filter;
    return {
      populate: async () => null,
    };
  };
  Inquiry.find = (filter) => {
    return {
      select() { return this; },
      populate() { return this; },
      sort() { return this; },
      lean: async () => {
        assert.deepEqual(filter, { assignedUser: userId });
        return [{ _id: "507f1f77bcf86cd799439013", assignedUser: userId }];
      },
    };
  };

  const app = express();
  app.use(express.json());
  app.use("/api/users", userRoutes);
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/users/me/quotes`, {
      headers: { Authorization: `Bearer ${token}`, Connection: "close" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).quotes, [{ _id: quoteId, assignedUser: userId }]);
    assert.deepEqual(listFilter, { assignedUser: userId });

    const inquiryResponse = await fetch(`http://127.0.0.1:${address.port}/api/users/me/inquiries`, {
      headers: { Authorization: `Bearer ${token}`, Connection: "close" },
    });
    assert.equal(inquiryResponse.status, 200);
    assert.equal((await inquiryResponse.json()).inquiries.length, 1);

    const updateResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/users/me/quotes/${quoteId}/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify({ status: "closed" }),
      }
    );
    assert.equal(updateResponse.status, 404);
    await updateResponse.json();
    assert.deepEqual(updateFilter, { _id: quoteId, assignedUser: userId });

    const pdfResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/users/me/quotes/${quoteId}/pdf`,
      { headers: { Authorization: `Bearer ${token}`, Connection: "close" } }
    );
    assert.equal(pdfResponse.status, 404);
    await pdfResponse.json();

    const quotationResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/users/me/quotes/${quoteId}/quotation`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify({ discountPercentages: [] }),
      }
    );
    assert.equal(quotationResponse.status, 404);
    await quotationResponse.json();
    assert.deepEqual(ownedQuoteFilters, [
      { _id: quoteId, assignedUser: userId },
      { _id: quoteId, assignedUser: userId },
    ]);
  } finally {
    User.findOne = originalFindOne;
    QuoteRequest.find = originalQuoteFind;
    QuoteRequest.findOne = originalQuoteFindOne;
    QuoteRequest.findOneAndUpdate = originalQuoteFindOneAndUpdate;
    Inquiry.find = originalInquiryFind;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("public customer tokens cannot access assigned quote APIs", async () => {
  const userId = "507f1f77bcf86cd799439011";
  const originalUserFindOne = User.findOne;
  const originalQuoteFind = QuoteRequest.find;
  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        name: "Website Customer",
        email: "customer@example.com",
        status: "active",
        authVersion: 0,
      }),
    }),
  });
  QuoteRequest.find = () => {
    throw new Error("The quote query must not run for a non-portal token.");
  };

  const app = express();
  app.use("/api/users", userRoutes);
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/users/me/quotes`,
      { headers: { Authorization: `Bearer ${createUserToken(userId)}`, Connection: "close" } }
    );
    assert.equal(response.status, 403);
    await response.json();
  } finally {
    User.findOne = originalUserFindOne;
    QuoteRequest.find = originalQuoteFind;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
