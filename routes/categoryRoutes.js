import express from "express";
import {
  getCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import { uploadImage } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getCategories);
router.post("/", uploadImage, createCategory);
router.get("/:categorySlug", getCategoryBySlug);
router.put("/:id", uploadImage, updateCategory);
router.delete("/:id", deleteCategory);

export default router;