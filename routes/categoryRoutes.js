import express from "express";
import {
  getCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import { uploadImage } from "../middleware/cloudinaryUpload.js";
import { requireAdmin } from "../middleware/adminAuth.js";

const router = express.Router();

router.get("/", getCategories);
router.post("/", requireAdmin, uploadImage, createCategory);
router.get("/:categorySlug", getCategoryBySlug);
router.put("/:id", requireAdmin, uploadImage, updateCategory);
router.delete("/:id", requireAdmin, deleteCategory);

export default router;