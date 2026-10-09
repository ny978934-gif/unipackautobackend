import express from "express";
import {
  createSubcategory,
  deleteSubcategory,
  getSubcategories,
  updateSubcategory,
} from "../controllers/subcategoryController.js";
import { requireAdmin } from "../middleware/adminAuth.js";

const router = express.Router();

router.get("/", requireAdmin, getSubcategories);
router.post("/", requireAdmin, createSubcategory);
router.put("/:id", requireAdmin, updateSubcategory);
router.delete("/:id", requireAdmin, deleteSubcategory);

export default router;
