import express from "express";
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import { uploadImage } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getProducts);
router.post("/", uploadImage, createProduct);
router.get("/:productSlug", getProductBySlug);
router.put("/:id", uploadImage, updateProduct);
router.delete("/:id", deleteProduct);

export default router;