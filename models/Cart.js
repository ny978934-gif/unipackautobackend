import mongoose from "mongoose";

/**
 * Each user has at most one Cart document.
 * Items store the product snapshot so the cart still shows useful data
 * even if a product is later deleted.  The canonical price is always
 * re-fetched from Product at checkout / order time (server-side).
 */
const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Snapshot fields — kept so the cart renders without an extra round-trip
    name:     { type: String, required: true, trim: true },
    image:    { type: String, default: "" },
    partCode: { type: String, default: "" },
    price:    { type: Number, default: 0, min: 0 },   // snapshot; validated on backend
    quantity: { type: Number, required: true, min: 1, max: 10_000 },
  },
  { _id: false }  // no separate _id for embedded items — use product as key
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,   // one cart per user
      index: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("Cart", cartSchema);
