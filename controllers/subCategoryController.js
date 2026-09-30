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
      category = await Category.findOne({
        _id: categoryId,
        ...(req.body.type ? { type: req.body.type } : {}),
      });
    } else if (categorySlug) {
      category = await Category.findOne({
        slug: categorySlug,
        ...(req.body.type ? { type: req.body.type } : {}),
      });
    }

    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    const subCategory = await SubCategory.create({
      type: category.type,
      category: category._id,
      name: name.trim(),
      slug: slugify(slug || name),
      description,
      image: req.uploadedImageUrl || image,
      images: req.uploadedImageUrls?.length ? req.uploadedImageUrls : image ? [image] : [],
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
    const type = req.query.type;
    if (type && !["sparepart", "machine"].includes(type)) {
      return res.status(400).json({ message: "Type must be sparepart or machine." });
    }
    const subCategories = await SubCategory.find(type ? { type } : {})
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

    const categoryFilter = {
      slug: categorySlug,
      ...(req.query.type ? { type: req.query.type } : {}),
    };
    const category = await Category.findOne(categoryFilter);

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
    if (req.query.type && !["sparepart", "machine"].includes(req.query.type)) {
      return res.status(400).json({ message: "Type must be sparepart or machine." });
    }

    const category = await Category.findOne({
      slug: categorySlug,
      ...(req.query.type ? { type: req.query.type } : {}),
    });

    if (!category) {
      return res.status(404).json({
        message: "Category not found",
      });
    }

    const subCategory = await SubCategory.findOne({
      slug: subCategorySlug,
      category: category._id,
      type: category.type,
    });

    if (!subCategory) {
      return res.status(404).json({
        message: "Subcategory not found",
      });
    }

    const products = await Product.find({
      category: category._id,
      subCategory: subCategory._id,
      type: category.type,
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
    if (req.uploadedImageUrls?.length) {
      updateData.image = req.uploadedImageUrls[0];
      updateData.images = req.uploadedImageUrls;
    } else if (req.uploadedImageUrl || image !== undefined) {
      updateData.image = req.uploadedImageUrl || image;
      updateData.images = updateData.image ? [updateData.image] : [];
    }
    if (imageName !== undefined) updateData.imageName = imageName;
    if (categoryId) {
      const category = await Category.findById(categoryId);
      if (!category) return res.status(404).json({ message: "Main category not found." });
      updateData.category = category._id;
      updateData.type = category.type;
    }

    const subCategory = await SubCategory.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("category");

    if (!subCategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    if (updateData.category) {
      await Promise.all([
        SubSubCategory.updateMany(
          { subCategory: subCategory._id },
          { $set: { category: subCategory.category, type: subCategory.type } }
        ),
        Product.updateMany(
          { subCategory: subCategory._id },
          { $set: { category: subCategory.category, type: subCategory.type } }
        ),
      ]);
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