import express from "express";
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import { uploadProductImages } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getProducts);
router.post("/", uploadProductImages, createProduct);
router.get("/:productSlug", getProductBySlug);
router.put("/:id", uploadProductImages, updateProduct);
router.delete("/:id", deleteProduct);

export default router;