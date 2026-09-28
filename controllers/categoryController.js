import mongoose from "mongoose";
import Category from "../models/Category.js";
import SubCategory from "../models/SubCategory.js";
import Product from "../models/Product.js";
import SubSubCategory from "../models/SubSubCategory.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// CREATE CATEGORY
export const createCategory = async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: "The database is unavailable. Check the server's MongoDB connection and try again.",
    });
  }

  try {
    const { name, slug, description = "", image = "", imageName = "" } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ message: "Category name is required." });
    }

    const categorySlug = slugify(slug || name);
    if (!categorySlug) {
      return res.status(400).json({
        message: "Category name or slug must contain at least one letter or number.",
      });
    }

    const category = await Category.create({
      name: name.trim(),
      slug: categorySlug,
      description,
      image: req.uploadedImageUrl || image,
      imageName,
    });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Category slug already exists." });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Category details are invalid." });
    }

    console.error("Failed to create category:", error);
    return res.status(500).json({ message: "Failed to create category." });
  }
};

// GET ALL CATEGORIES
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1, _id: -1 });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
};

// GET CATEGORY BY SLUG
export const getCategoryBySlug = async (req, res) => {
  try {
    const { categorySlug } = req.params;

    const category = await Category.findOne({
      slug: categorySlug,
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    const subCategories = await SubCategory.find({
      category: category._id,
    }).sort({ createdAt: -1, _id: -1 });

    res.status(200).json({
      category,
      subCategories,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch category",
      error: error.message,
    });
  }
};

// UPDATE CATEGORY
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, image, imageName } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (slug || name) updateData.slug = slugify(slug || name);
    if (description !== undefined) updateData.description = description;
    if (req.uploadedImageUrl || image !== undefined) {
      updateData.image = req.uploadedImageUrl || image;
    }
    if (imageName !== undefined) updateData.imageName = imageName;

    const category = await Category.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json(category);
  } catch (error) {
    res.status(500).json({
      message: "Failed to update category",
      error: error.message,
    });
  }
};

// DELETE CATEGORY
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findByIdAndDelete(id);

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Also clean up associated subcategories
    await SubCategory.deleteMany({ category: id });
    await SubSubCategory.deleteMany({ category: id });
    await Product.deleteMany({ category: id });

    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete category",
      error: error.message,
    });
  }
};