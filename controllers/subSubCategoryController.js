import Category from "../models/Category.js";
import SubCategory from "../models/SubCategory.js";
import SubSubCategory from "../models/SubSubCategory.js";
import Product from "../models/Product.js";

const slugify = (value) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const getAllSubSubCategories = async (req, res) => {
  try {
    const type = req.query.type;
    if (type && !["sparepart", "machine"].includes(type)) {
      return res.status(400).json({ message: "Type must be sparepart or machine." });
    }
    const items = await SubSubCategory.find(type ? { type } : {})
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
    if (req.query.type && !["sparepart", "machine"].includes(req.query.type)) {
      return res.status(400).json({ message: "Type must be sparepart or machine." });
    }
    const category = await Category.findOne({
      slug: new RegExp(`^${escapeRegex(categorySlug)}$`, "i"),
      ...(req.query.type ? { type: req.query.type } : {}),
    });
    if (!category) return res.status(404).json({ message: "Category not found." });

    const subCategory = await SubCategory.findOne({
      slug: new RegExp(`^${escapeRegex(subCategorySlug)}$`, "i"),
      category: category._id,
      type: category.type,
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
    const category = await Category.findOne({
      slug: req.params.categorySlug,
      ...(req.query.type ? { type: req.query.type } : {}),
    });
    if (!category) return res.status(404).json({ message: "Category not found." });
    const subCategory = await SubCategory.findOne({
      slug: req.params.subCategorySlug,
      category: category._id,
      type: category.type,
    });
    if (!subCategory) return res.status(404).json({ message: "Subcategory not found." });
    const subSubCategory = await SubSubCategory.findOne({
      slug: req.params.subSubCategorySlug,
      category: category._id,
      subCategory: subCategory._id,
    });
    if (!subSubCategory) return res.status(404).json({ message: "Sub-subcategory not found." });

    const products = await Product.find({
      category: category._id,
      subCategory: subCategory._id,
      subSubCategory: subSubCategory._id,
      type: category.type,
    })
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

    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ message: "Main category not found." });
    const subCategory = await SubCategory.findOne({
      _id: subCategoryId,
      category: categoryId,
      type: category.type,
    });
    if (!subCategory) return res.status(404).json({ message: "Subcategory does not belong to this main category." });

    const item = await SubSubCategory.create({
      type: category.type,
      category: category._id,
      subCategory: subCategory._id,
      name: name.trim(),
      slug: slugify(slug || name),
      image: req.uploadedImageUrls?.[0] || req.uploadedImageUrl || image,
      images: req.uploadedImageUrls?.length ? req.uploadedImageUrls : image ? [image] : [],
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

export const updateSubSubCategory = async (req, res) => {
  try {
    const existingItem = await SubSubCategory.findById(req.params.id);
    if (!existingItem) return res.status(404).json({ message: "Sub-subcategory not found." });

    const categoryId = req.body.categoryId || existingItem.category;
    const subCategoryId = req.body.subCategoryId || existingItem.subCategory;
    const category = await Category.findOne({ _id: categoryId, type: existingItem.type });
    if (!category) return res.status(404).json({ message: "Main category not found." });

    const subCategory = await SubCategory.findOne({
      _id: subCategoryId,
      category: category._id,
      type: category.type,
    });
    if (!subCategory) {
      return res.status(400).json({ message: "Subcategory does not belong to this main category." });
    }

    const updateData = {
      category: category._id,
      subCategory: subCategory._id,
    };
    if (req.body.name !== undefined) {
      if (!req.body.name.trim()) return res.status(400).json({ message: "Name is required." });
      updateData.name = req.body.name.trim();
    }
    if (req.body.slug !== undefined || req.body.name !== undefined) {
      const nextSlug = slugify(req.body.slug || req.body.name || existingItem.name);
      if (!nextSlug) return res.status(400).json({ message: "Name or slug must contain a letter or number." });
      updateData.slug = nextSlug;
    }
    if (req.body.imageName !== undefined) updateData.imageName = req.body.imageName;
    if (req.uploadedImageUrls?.length) {
      updateData.image = req.uploadedImageUrls[0];
      updateData.images = req.uploadedImageUrls;
    } else if (req.uploadedImageUrl || req.body.image !== undefined) {
      updateData.image = req.uploadedImageUrl || req.body.image;
      updateData.images = updateData.image ? [updateData.image] : [];
    }

    const item = await SubSubCategory.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate(["category", "subCategory"]);

    await Product.updateMany(
      { subSubCategory: item._id },
      { $set: { category: category._id, subCategory: subCategory._id, type: category.type } }
    );

    res.json(item);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Sub-subcategory slug already exists in this subcategory." });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Sub-subcategory details are invalid." });
    }
    res.status(500).json({ message: "Failed to update sub-subcategory", error: error.message });
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
