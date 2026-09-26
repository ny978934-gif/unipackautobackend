import express from "express";
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import { uploadMultipleImages } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getProducts);
router.post("/", uploadMultipleImages, createProduct);
router.get("/:productSlug", getProductBySlug);
router.put("/:id", uploadMultipleImages, updateProduct);
router.delete("/:id", deleteProduct);

export default router;