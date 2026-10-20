import express from "express";
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductsByCategory,
  exportSpareParts,
} from "../controllers/productController.js";
import { uploadMultipleImages } from "../middleware/cloudinaryUpload.js";
import { requireAdmin } from "../middleware/adminAuth.js";

const router = express.Router();

router.get("/", getProducts);
router.get("/export.xlsx", requireAdmin, exportSpareParts);
router.post("/", requireAdmin, uploadMultipleImages, createProduct);
router.get("/:productSlug", getProductBySlug);
router.put("/:id", requireAdmin, uploadMultipleImages, updateProduct);
router.delete("/category/:categoryId", requireAdmin, deleteProductsByCategory);
router.delete("/:id", requireAdmin, deleteProduct);

export default router;