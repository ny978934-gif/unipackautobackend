import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import Admin from "../models/Admin.js";
import Inquiry from "../models/Inquiry.js";
import QuoteRequest from "../models/QuoteRequest.js";
import User from "../models/User.js";
import { createAdminToken } from "../middleware/adminAuth.js";
import inquiryRoutes from "../routes/contact.js";
import { createUserToken } from "../middleware/userAuth.js";
import userRoutes from "../routes/userRoutes.js";

process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";

test("active portal users can read and update all shared quotes and inquiries", async () => {
  const userId = "507f1f77bcf86cd799439011";
  const quoteId = "507f1f77bcf86cd799439012";
  const token = createUserToken(userId, 0, true);
  const originalFindOne = User.findOne;
  const originalQuoteFind = QuoteRequest.find;
  const originalQuoteFindOne = QuoteRequest.findOne;
  const originalQuoteFindOneAndUpdate = QuoteRequest.findOneAndUpdate;
  const originalInquiryFind = Inquiry.find;
  const originalInquiryFindByIdAndUpdate = Inquiry.findByIdAndUpdate;
  let listFilter;
  let updateFilter;
  const quoteLookups = [];

  User.findOne = () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        name: "Portal User",
        email: "portal@example.com",
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
      lean: async () => [{ _id: quoteId, company: "Shared company" }],
    };
  };
  QuoteRequest.findOne = async (filter) => {
    quoteLookups.push(filter);
    return null;
  };
  QuoteRequest.findOneAndUpdate = async (filter, update) => {
    updateFilter = filter;
    return { _id: quoteId, ...update };
  };
  Inquiry.find = (filter) => {
    assert.equal(filter, undefined);
    return {
      select() { return this; },
      populate() { return this; },
      sort() { return this; },
      lean: async () => [{ _id: "507f1f77bcf86cd799439013", name: "Shared inquiry" }],
    };
  };
  Inquiry.findByIdAndUpdate = async (id, update) => ({
    _id: id,
    ...update,
  });

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
    assert.deepEqual((await response.json()).quotes, [{ _id: quoteId, company: "Shared company" }]);
    assert.equal(listFilter, undefined);

    const inquiryResponse = await fetch(`http://127.0.0.1:${address.port}/api/users/me/inquiries`, {
      headers: { Authorization: `Bearer ${token}`, Connection: "close" },
    });
    assert.equal(inquiryResponse.status, 200);
    assert.deepEqual((await inquiryResponse.json()).inquiries, [
      { _id: "507f1f77bcf86cd799439013", name: "Shared inquiry" },
    ]);

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
    assert.equal(updateResponse.status, 200);
    assert.deepEqual((await updateResponse.json()).request, { _id: quoteId, status: "closed" });
    assert.deepEqual(updateFilter, { _id: quoteId });

    const inquiryUpdateResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/users/me/inquiries/507f1f77bcf86cd799439013/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify({ status: "contacted" }),
      }
    );
    assert.equal(inquiryUpdateResponse.status, 200);
    assert.deepEqual((await inquiryUpdateResponse.json()).inquiry, {
      _id: "507f1f77bcf86cd799439013",
      status: "contacted",
    });

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
    assert.deepEqual(quoteLookups, [{ _id: quoteId }, { _id: quoteId }]);
  } finally {
    User.findOne = originalFindOne;
    QuoteRequest.find = originalQuoteFind;
    QuoteRequest.findOne = originalQuoteFindOne;
    QuoteRequest.findOneAndUpdate = originalQuoteFindOneAndUpdate;
    Inquiry.find = originalInquiryFind;
    Inquiry.findByIdAndUpdate = originalInquiryFindByIdAndUpdate;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("admin inquiry status updates modify the shared inquiry record", async () => {
  const adminId = "507f1f77bcf86cd799439014";
  const inquiryId = "507f1f77bcf86cd799439013";
  const token = createAdminToken(adminId);
  const originalAdminFindById = Admin.findById;
  const originalInquiryFindByIdAndUpdate = Inquiry.findByIdAndUpdate;
  let updatedId;

  Admin.findById = () => ({
    select: () => ({
      lean: async () => ({ _id: adminId, email: "admin@example.com" }),
    }),
  });
  Inquiry.findByIdAndUpdate = async (id, update) => {
    updatedId = id;
    return { _id: id, ...update };
  };

  const app = express();
  app.use(express.json());
  app.use("/api/inquiries", inquiryRoutes);
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/inquiries/${inquiryId}/status`,
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
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).inquiry, { _id: inquiryId, status: "closed" });
    assert.equal(updatedId, inquiryId);
  } finally {
    Admin.findById = originalAdminFindById;
    Inquiry.findByIdAndUpdate = originalInquiryFindByIdAndUpdate;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("public customer tokens cannot access shared portal quote APIs", async () => {
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
