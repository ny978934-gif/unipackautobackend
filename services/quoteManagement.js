import mongoose from "mongoose";
import Product from "../models/Product.js";
import {
  createQuotationNumber,
  calculateQuotationTotals,
  calculateQuotationTotalsFromPaise,
  describeEmailFailure,
  sendFinalQuotation,
} from "./quoteNotification.js";
import { buildQuotationPdf } from "./quotePdf.js";

const applyQuotationTotals = (quote, totals, quotationNumber, issuedAt) => {
  quote.quotation.number = quotationNumber;
  quote.quotation.sentAt = issuedAt;
  quote.quotation.items = totals.items.map((item) => ({
    name: item.name,
    itemCode: item.itemCode || "",
    machine: item.machine || "",
    uom: item.uom || "",
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    totalPaise: item.totalPaise,
    discountPercentage: item.discountPercentage,
    discountPaise: item.discountPaise,
    netTotalPaise: item.netTotalPaise,
  }));
  quote.quotation.subtotalCents = totals.subtotalPaise;
  quote.quotation.gstCents = totals.gstPaise;
  quote.quotation.grossTotalCents = totals.grandTotalPaise;
  quote.quotation.finalTotalCents = totals.finalTotalPaise;
};

export const setQuotationCreatorIfMissing = (quote, creator) => {
  if (!quote.quotation.sentAt && !quote.quotation.createdBy && creator) {
    quote.quotation.createdBy = creator;
  }
};

export const enrichPartsWithPrices = async (parts) => {
  const validIds = [
    ...new Set(
      parts
        .map((part) => part.productId)
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  if (parts.some((part) => !part.productId || !mongoose.isValidObjectId(part.productId))) {
    throw new Error("Every spare part must be selected from the current catalogue.");
  }

  const products = validIds.length
    ? await Product.find(
      { _id: { $in: validIds }, type: "sparepart" },
      { _id: 1, name: 1, partCode: 1, price: 1, uom: 1 }
    ).lean()
    : [];
  const priceMap = new Map(products.map((product) => [String(product._id), product]));

  return parts.map((part, index) => {
    const product = part.productId ? priceMap.get(String(part.productId)) : null;
    if (!product || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price <= 0) {
      throw new Error(`A catalogue price is not configured for spare part ${index + 1}.`);
    }
    return {
      name: product.name,
      itemCode: product.partCode || part.itemCode || "",
      machine: part.machine || "",
      uom: product.uom || "",
      quantity: part.quantity,
      unitPrice: product.price,
    };
  });
};

export const getQuotationTotals = async (quote, discountPercentages) => {
  if (quote.quotation?.items?.length) {
    const productIds = [
      ...new Set(
        (quote.parts || [])
          .map((part) => part.productId)
          .filter((id) => id && mongoose.isValidObjectId(id))
          .map(String)
      ),
    ];
    const products = productIds.length
      ? await Product.find(
        { _id: { $in: productIds }, type: "sparepart" },
        { _id: 1, uom: 1 }
      ).lean()
      : [];
    const uomByProductId = new Map(products.map((product) => [String(product._id), product.uom || ""]));

    return calculateQuotationTotalsFromPaise(
      quote.quotation.items.map((item, index) => ({
        ...(item.toObject?.() ?? item),
        unitPricePaise: item.unitPricePaise,
        uom: item.uom || uomByProductId.get(String(quote.parts?.[index]?.productId)) || "",
        discountPercentage: discountPercentages?.[index] ??
          item.discountPercentage ??
          0,
      }))
    );
  }
  const pricedItems = await enrichPartsWithPrices(quote.parts || []);
  return calculateQuotationTotals(pricedItems.map((item, index) => ({
    ...item,
    discountPercentage: discountPercentages?.[index] ?? 0,
  })));
};

export const sendFinalizedQuotation = async (quote, totals, { issuedAt, creator }) => {
  const quotationNumber = quote.quotation.number || createQuotationNumber(quote.id, issuedAt);
  setQuotationCreatorIfMissing(quote, creator);
  applyQuotationTotals(quote, totals, quotationNumber, issuedAt);
  quote.notificationStatus = "pending";
  quote.notificationError = "";
  quote.status = "quoted";
  await quote.save();

  try {
    const quotationPdf = buildQuotationPdf(quote, totals);
    await sendFinalQuotation(quote, totals, {
      quotationNumber,
      issuedAt,
      quotationPdf,
    });
    quote.notificationStatus = "sent";
    quote.notificationError = "";
    await quote.save();
    return { notificationSent: true, request: quote };
  } catch (error) {
    quote.notificationStatus = "failed";
    quote.notificationError = describeEmailFailure(error);
    await quote.save();
    console.error(`Updated quotation email failed for ${quote.id}:`, {
      message: error.message,
      guidance: quote.notificationError,
    });
    return { notificationSent: false, notificationError: quote.notificationError, request: quote };
  }
};

export { buildQuotationPdf };
