import { Router } from "express";
import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { requireUser } from "../middleware/userAuth.js";

const router = Router();
const MAX_ITEMS = 50;
const MAX_QTY   = 10_000;

// All cart routes require a logged-in user
router.use(requireUser);

// ── Helper — get or create cart for the current user ─────────────────────────
const getUserCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
};

// ── Helper — re-validate and price items against DB (security) ────────────────
const enrichItem = async (productId) => {
  if (!mongoose.isValidObjectId(productId)) return null;
  const product = await Product.findById(productId)
    .select("name image images partCode price inStock")
    .lean();
  return product || null;
};

// ── GET /api/cart ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const cart = await getUserCart(req.user._id);

    // Compute subtotal and total with server-side prices (security: ignore client-sent price)
    let subtotal = 0;
    const enrichedItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await enrichItem(item.product);
        const serverPrice = product?.price ?? item.price ?? 0;
        const lineTotal = serverPrice * item.quantity;
        subtotal += lineTotal;
        return {
          product:  item.product,
          name:     product?.name     ?? item.name,
          image:    product?.image    ?? item.image ?? product?.images?.[0] ?? "",
          partCode: product?.partCode ?? item.partCode ?? "",
          price:    serverPrice,
          quantity: item.quantity,
          lineTotal,
          inStock:  product?.inStock ?? true,
        };
      })
    );

    const gst         = Math.round(subtotal * 18) / 100;
    const grandTotal  = subtotal + gst;
    const itemCount   = cart.items.reduce((sum, i) => sum + i.quantity, 0);

    return res.json({ items: enrichedItems, subtotal, gst, grandTotal, itemCount });
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json({ message: "Could not load cart." });
  }
});

// ── POST /api/cart/items — add or increase quantity ───────────────────────────

router.post("/items", async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const qty = Number(quantity);

  if (!mongoose.isValidObjectId(productId) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return res.status(400).json({ message: "Invalid product or quantity." });
  }

  try {
    // Validate product exists in DB
    const product = await Product.findById(productId)
      .select("name image images partCode price inStock")
      .lean();
    if (!product) return res.status(404).json({ message: "Product not found." });

    const cart = await getUserCart(req.user._id);
    const existingIndex = cart.items.findIndex((i) => String(i.product) === String(productId));

    if (existingIndex >= 0) {
      // Increase quantity of existing item
      const newQty = cart.items[existingIndex].quantity + qty;
      cart.items[existingIndex].quantity = Math.min(newQty, MAX_QTY);
      // Refresh snapshot
      cart.items[existingIndex].price    = product.price;
      cart.items[existingIndex].name     = product.name;
      cart.items[existingIndex].image    = product.image || product.images?.[0] || "";
      cart.items[existingIndex].partCode = product.partCode || "";
    } else {
      if (cart.items.length >= MAX_ITEMS) {
        return res.status(400).json({ message: `Cart is limited to ${MAX_ITEMS} different items.` });
      }
      cart.items.push({
        product:  productId,
        name:     product.name,
        image:    product.image || product.images?.[0] || "",
        partCode: product.partCode || "",
        price:    product.price,         // snapshot from DB — not from client
        quantity: qty,
      });
    }

    await cart.save();
    const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
    return res.status(201).json({ message: "Item added to cart.", itemCount });
  } catch (error) {
    console.error("Add to cart error:", error);
    return res.status(500).json({ message: "Could not add item to cart." });
  }
});

// ── PATCH /api/cart/items/:productId — set exact quantity ────────────────────

router.patch("/items/:productId", async (req, res) => {
  const { productId } = req.params;
  const qty = Number(req.body.quantity);

  if (!mongoose.isValidObjectId(productId) || !Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
    return res.status(400).json({ message: "Invalid quantity." });
  }

  try {
    const cart = await getUserCart(req.user._id);
    const idx  = cart.items.findIndex((i) => String(i.product) === productId);
    if (idx < 0) return res.status(404).json({ message: "Item not in cart." });

    if (qty === 0) {
      cart.items.splice(idx, 1);
    } else {
      cart.items[idx].quantity = qty;
    }

    await cart.save();
    const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
    return res.json({ message: "Cart updated.", itemCount });
  } catch (error) {
    console.error("Update cart error:", error);
    return res.status(500).json({ message: "Could not update cart." });
  }
});

// ── DELETE /api/cart/items/:productId — remove one item ──────────────────────

router.delete("/items/:productId", async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ message: "Invalid product ID." });
  }

  try {
    const cart = await getUserCart(req.user._id);
    const before = cart.items.length;
    cart.items = cart.items.filter((i) => String(i.product) !== productId);
    if (cart.items.length === before) return res.status(404).json({ message: "Item not in cart." });

    await cart.save();
    const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
    return res.json({ message: "Item removed.", itemCount });
  } catch (error) {
    console.error("Remove cart item error:", error);
    return res.status(500).json({ message: "Could not remove item." });
  }
});

// ── DELETE /api/cart — clear entire cart ─────────────────────────────────────

router.delete("/", async (req, res) => {
  try {
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });
    return res.json({ message: "Cart cleared.", itemCount: 0 });
  } catch (error) {
    console.error("Clear cart error:", error);
    return res.status(500).json({ message: "Could not clear cart." });
  }
});

export default router;
