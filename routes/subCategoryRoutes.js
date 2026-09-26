import express from "express";
import {
  getAllSubCategories,
  getSubCategories,
  getProductsBySubCategory,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
} from "../controllers/subCategoryController.js";
import { uploadImage, uploadMultipleImages } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getAllSubCategories);
router.post("/", uploadMultipleImages, createSubCategory);
router.get("/category/:categorySlug", getSubCategories);
router.get("/category/:categorySlug/:subCategorySlug", getProductsBySubCategory);
router.put("/:id", uploadImage, updateSubCategory);
router.delete("/:id", deleteSubCategory);

export default router;