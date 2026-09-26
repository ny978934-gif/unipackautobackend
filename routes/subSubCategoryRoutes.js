import express from "express";
import {
  getAllSubSubCategories,
  getSubSubCategoriesBySlugs,
  getProductsBySubSubCategory,
  createSubSubCategory,
  deleteSubSubCategory,
} from "../controllers/subSubCategoryController.js";
import { uploadMultipleImages } from "../middleware/cloudinaryUpload.js";

const router = express.Router();

router.get("/", getAllSubSubCategories);
router.get("/category/:categorySlug/:subCategorySlug", getSubSubCategoriesBySlugs);
router.get("/category/:categorySlug/:subCategorySlug/:subSubCategorySlug/products", getProductsBySubSubCategory);
router.post("/", uploadMultipleImages, createSubSubCategory);
router.delete("/:id", deleteSubSubCategory);

export default router;
