import Category from "../models/Category.js";
import SubCategory from "../models/SubCategory.js";
import Product from "../models/Product.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const parseSpecifications = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item?.label && item?.value);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item?.label && item?.value) : [];
  } catch {
    return [];
  }
};

// CREATE PRODUCT
export const createProduct = async (req, res) => {
  try {
    const {
      categoryId,
      categorySlug,
      subCategoryId,
      subSubCategoryId,
      subCategorySlug,
      name,
      slug,
      partCode = "",
      price = 0,
      image = "",
      images = [],
      description = "",
      specifications = [],
      compatibleMachines = [],
      inStock = true,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Product name is required.",
      });
    }

    let category;
    if (categoryId) {
      category = await Category.findById(categoryId);
    } else if (categorySlug) {
      category = await Category.findOne({ slug: categorySlug });
    }

    if (!category) {
      // If no category found, pick the first existing one or return 400
      category = await Category.findOne();
      if (!category) {
        return res.status(400).json({ message: "Please create a category first." });
      }
    }

    let subCategory;
    if (subCategoryId) {
      subCategory = await SubCategory.findById(subCategoryId);
    } else if (subCategorySlug) {
      subCategory = await SubCategory.findOne({
        slug: subCategorySlug,
        category: category._id,
      });
    }

    if (!subCategory) {
      // Pick first subcategory in that category, or any subcategory
      subCategory = await SubCategory.findOne({ category: category._id });
      if (!subCategory) {
        subCategory = await SubCategory.findOne();
      }
      if (!subCategory) {
        return res.status(400).json({ message: "Please create a subcategory first." });
      }
    }

    const product = await Product.create({
      category: category._id,
      subCategory: subCategory._id,
      subSubCategory: subSubCategoryId || null,
      name: name.trim(),
      slug: slugify(slug || name),
      partCode,
      price: Number(price) || 0,
      image: req.uploadedImageUrl || image || (Array.isArray(images) ? images[0] : "") || "",
      images: req.uploadedImageUrl
        ? [req.uploadedImageUrl]
        : Array.isArray(images) && images.length
        ? images
        : image
        ? [image]
        : [],
      description,
      specifications: parseSpecifications(specifications),
      compatibleMachines: Array.isArray(compatibleMachines)
        ? compatibleMachines
        : typeof compatibleMachines === "string"
        ? compatibleMachines.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      inStock: inStock !== false && inStock !== "false",
    });

    const populated = await Product.findById(product._id)
      .populate("category")
      .populate("subCategory")
      .populate("subSubCategory");

    res.status(201).json(populated);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({
      message:
        error.code === 11000
          ? "Product slug already exists."
          : "Failed to create product",
      error: error.message,
    });
  }
};

// GET ALL PRODUCTS
export const getProducts = async (req, res) => {
  try {
    const { category, subCategory, subSubCategory, search } = req.query;
    const filter = {};

    if (category) {
      if (category.match(/^[0-9a-fA-F]{24}$/)) {
        filter.category = category;
      } else {
        const cat = await Category.findOne({ slug: category });
        if (cat) filter.category = cat._id;
      }
    }

    if (subCategory) {
      if (subCategory.match(/^[0-9a-fA-F]{24}$/)) {
        filter.subCategory = subCategory;
      } else {
        const sub = await SubCategory.findOne({ slug: subCategory });
        if (sub) filter.subCategory = sub._id;
      }

      if (subSubCategory) filter.subSubCategory = subSubCategory;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { partCode: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const products = await Product.find(filter)
      .populate("category")
      .populate("subCategory")
      .sort({ createdAt: -1 });

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch products",
      error: error.message,
    });
  }
};

// GET PRODUCT BY SLUG
export const getProductBySlug = async (req, res) => {
  try {
    const { productSlug } = req.params;

    const product = await Product.findOne({
      slug: productSlug,
    })
      .populate("category")
      .populate("subCategory");

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch product",
      error: error.message,
    });
  }
};

// UPDATE PRODUCT
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      slug,
      partCode,
      price,
      image,
      images,
      description,
      specifications,
      compatibleMachines,
      inStock,
      categoryId,
      subCategoryId,
      subSubCategoryId,
    } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (slug || name) updateData.slug = slugify(slug || name);
    if (partCode !== undefined) updateData.partCode = partCode;
    if (price !== undefined) updateData.price = Number(price);
    if (req.uploadedImageUrl || image !== undefined) {
      updateData.image = req.uploadedImageUrl || image;
      if (req.uploadedImageUrl) updateData.images = [req.uploadedImageUrl];
    }
    if (images !== undefined) updateData.images = images;
    if (description !== undefined) updateData.description = description;
    if (specifications !== undefined) {
      updateData.specifications = parseSpecifications(specifications);
    }
    if (compatibleMachines !== undefined) updateData.compatibleMachines = compatibleMachines;
    if (inStock !== undefined) updateData.inStock = inStock;
    if (categoryId) updateData.category = categoryId;
    if (subCategoryId) updateData.subCategory = subCategoryId;
    if (subSubCategoryId !== undefined) updateData.subSubCategory = subSubCategoryId || null;

    const product = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("category")
      .populate("subCategory");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({
      message: "Failed to update product",
      error: error.message,
    });
  }
};

// DELETE PRODUCT
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete product",
      error: error.message,
    });
  }
};