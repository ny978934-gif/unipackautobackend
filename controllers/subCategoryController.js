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

// CREATE SUBCATEGORY
export const createSubCategory = async (req, res) => {
  try {
    const { categoryId, categorySlug, name, slug, description = "", image = "", imageName = "" } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required." });
    }

    let category;
    if (categoryId) {
      category = await Category.findById(categoryId);
    } else if (categorySlug) {
      category = await Category.findOne({ slug: categorySlug });
    }

    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    const subCategory = await SubCategory.create({
      category: category._id,
      name: name.trim(),
      slug: slugify(slug || name),
      description,
      image: req.uploadedImageUrl || image,
      imageName,
    });

    const populated = await SubCategory.findById(subCategory._id).populate("category");
    res.status(201).json(populated);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({
      message:
        error.code === 11000
          ? "Subcategory slug already exists."
          : "Failed to create subcategory",
      error: error.message,
    });
  }
};

// GET ALL SUBCATEGORIES
export const getAllSubCategories = async (req, res) => {
  try {
    const subCategories = await SubCategory.find()
      .populate("category")
      .sort({ createdAt: -1, _id: -1 });

    res.status(200).json(subCategories);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch subcategories",
      error: error.message,
    });
  }
};

// GET SUBCATEGORIES FOR A CATEGORY
export const getSubCategories = async (req, res) => {
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
    })
      .populate("category")
      .sort({ createdAt: -1, _id: -1 });

    res.status(200).json({
      category,
      subCategories,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch subcategories",
      error: error.message,
    });
  }
};

// GET PRODUCTS INSIDE SUBCATEGORY
export const getProductsBySubCategory = async (req, res) => {
  try {
    const { categorySlug, subCategorySlug } = req.params;

    const category = await Category.findOne({
      slug: categorySlug,
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    const subCategory = await SubCategory.findOne({
      slug: subCategorySlug,
      category: category._id,
    });

    if (!subCategory) {
      return res.status(404).json({
        message: "Subcategory not found",
      });
    }

    const products = await Product.find({
      category: category._id,
      subCategory: subCategory._id,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      category,
      subCategory,
      products,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch products",
      error: error.message,
    });
  }
};

// UPDATE SUBCATEGORY
export const updateSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, image, imageName, categoryId } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (slug || name) updateData.slug = slugify(slug || name);
    if (description !== undefined) updateData.description = description;
    if (req.uploadedImageUrl || image !== undefined) {
      updateData.image = req.uploadedImageUrl || image;
    }
    if (imageName !== undefined) updateData.imageName = imageName;
    if (categoryId) updateData.category = categoryId;

    const subCategory = await SubCategory.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("category");

    if (!subCategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    res.status(200).json(subCategory);
  } catch (error) {
    res.status(500).json({
      message: "Failed to update subcategory",
      error: error.message,
    });
  }
};

// DELETE SUBCATEGORY
export const deleteSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const subCategory = await SubCategory.findByIdAndDelete(id);

    if (!subCategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    await Product.deleteMany({ subCategory: id });
    await SubSubCategory.deleteMany({ subCategory: id });

    res.status(200).json({ message: "Subcategory deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete subcategory",
      error: error.message,
    });
  }
};