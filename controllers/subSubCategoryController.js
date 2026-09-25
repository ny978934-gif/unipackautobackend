import Category from "../models/Category.js";
import SubCategory from "../models/SubCategory.js";
import SubSubCategory from "../models/SubSubCategory.js";
import Product from "../models/Product.js";

const slugify = (value) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const getAllSubSubCategories = async (req, res) => {
  try {
    const items = await SubSubCategory.find()
      .populate("category")
      .populate("subCategory")
      .sort({ createdAt: -1, _id: -1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch sub-subcategories", error: error.message });
  }
};

export const getSubSubCategoriesBySlugs = async (req, res) => {
  try {
    const categorySlug = decodeURIComponent(req.params.categorySlug).trim();
    const subCategorySlug = decodeURIComponent(req.params.subCategorySlug).trim();
    const category = await Category.findOne({ slug: new RegExp(`^${escapeRegex(categorySlug)}$`, "i") });
    if (!category) return res.status(404).json({ message: "Category not found." });

    const subCategory = await SubCategory.findOne({
      slug: new RegExp(`^${escapeRegex(subCategorySlug)}$`, "i"),
      category: category._id,
    });
    if (!subCategory) return res.status(404).json({ message: "Subcategory not found." });

    const subSubCategories = await SubSubCategory.find({
      category: category._id,
      subCategory: subCategory._id,
    }).sort({ createdAt: -1, _id: -1 });

    res.json({ category, subCategory, subSubCategories });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch sub-subcategories", error: error.message });
  }
};

export const getProductsBySubSubCategory = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.categorySlug });
    if (!category) return res.status(404).json({ message: "Category not found." });
    const subCategory = await SubCategory.findOne({ slug: req.params.subCategorySlug, category: category._id });
    if (!subCategory) return res.status(404).json({ message: "Subcategory not found." });
    const subSubCategory = await SubSubCategory.findOne({
      slug: req.params.subSubCategorySlug,
      category: category._id,
      subCategory: subCategory._id,
    });
    if (!subSubCategory) return res.status(404).json({ message: "Sub-subcategory not found." });

    const products = await Product.find({ category: category._id, subCategory: subCategory._id, subSubCategory: subSubCategory._id })
      .populate("category")
      .populate("subCategory")
      .populate("subSubCategory")
      .sort({ createdAt: -1 });

    res.json({ category, subCategory, subSubCategory, products });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message });
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createSubSubCategory = async (req, res) => {
  try {
    const { categoryId, subCategoryId, name, slug, image = "", imageName = "" } = req.body;
    if (!categoryId || !subCategoryId || !name?.trim()) {
      return res.status(400).json({ message: "Main category, subcategory, and name are required." });
    }

    const [category, subCategory] = await Promise.all([
      Category.findById(categoryId),
      SubCategory.findOne({ _id: subCategoryId, category: categoryId }),
    ]);
    if (!category) return res.status(404).json({ message: "Main category not found." });
    if (!subCategory) return res.status(404).json({ message: "Subcategory does not belong to this main category." });

    const item = await SubSubCategory.create({
      category: category._id,
      subCategory: subCategory._id,
      name: name.trim(),
      slug: slugify(slug || name),
      image: req.uploadedImageUrl || image,
      imageName,
    });
    res.status(201).json(await item.populate(["category", "subCategory"]));
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? "Sub-subcategory slug already exists in this subcategory." : "Failed to create sub-subcategory",
      error: error.message,
    });
  }
};

export const deleteSubSubCategory = async (req, res) => {
  try {
    const item = await SubSubCategory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: "Sub-subcategory not found." });
    res.json({ message: "Sub-subcategory deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete sub-subcategory", error: error.message });
  }
};
