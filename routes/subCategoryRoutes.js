import express from "express";
import {
  createSubcategory,
  deleteSubcategory,
  getSubcategories,
  updateSubcategory,
} from "../controllers/subcategoryController.js";

const router = express.Router();

router.get("/", getSubcategories);
router.post("/", createSubcategory);
router.put("/:id", updateSubcategory);
router.delete("/:id", deleteSubcategory);

export default router;
