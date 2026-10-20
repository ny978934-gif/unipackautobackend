import Category from "../models/Category.js";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";
import XLSX from "xlsx";
import { deleteCloudinaryImages } from "../services/cloudinaryAssets.js";
import { createSparePartsWorkbook } from "../services/sparePartsWorkbook.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

const parseSpecifications = (value) =>
  parseArray(value).filter((item) => item?.label?.trim() && item?.value?.trim());

const populateCategory = (query) => query.populate("category").populate("subcategory");

export const createProduct = async (req, res) => {
  try {
    const {
      categoryId,
      subcategoryId,
      categorySlug,
      type = "sparepart",
      name,
      slug,
      partCode = "",
      price = 0,
      stock = 0,
      uom = "",
      image = "",
      images = [],
      imageUrls = [],
      description = "",
      specifications = [],
      compatibleMachines = [],
      inStock = true,
    } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ message: "Product name is required." });
    }
    if (!["sparepart", "machine"].includes(type)) {
      return res.status(400).json({ message: "Product type must be sparepart or machine." });
    }
    const category = categoryId
      ? await Category.findOne({ _id: categoryId, type })
      : categorySlug
        ? await Category.findOne({ slug: categorySlug, type })
        : null;
    if (!category) {
      return res.status(400).json({ message: "Select a valid category for this product." });
    }
    const subcategory = type === "machine" && subcategoryId
      ? await Subcategory.findOne({ _id: subcategoryId, category: category._id })
      : null;
    if (type === "machine" && subcategoryId && !subcategory) {
      return res.status(400).json({ message: "Select a subcategory from the chosen category." });
    }

    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      return res.status(400).json({ message: "Price must be a non-negative number." });
    }
    const stockValue = type === "machine" ? Number(stock) : 0;
    if (type === "machine" && (!Number.isFinite(stockValue) || stockValue < 0)) {
      return res.status(400).json({ message: "Stock must be a non-negative number." });
    }

    const providedImages = parseArray(type === "sparepart" ? imageUrls ?? images : images)
      .filter((url) => typeof url === "string" && url.trim());
    if (type === "sparepart" && !providedImages.length && image && typeof image === "string") {
      providedImages.push(image);
    }
    const productImages = type === "sparepart"
      ? [...(req.uploadedImageUrls || []), ...providedImages]
      : req.uploadedImageUrls?.length
        ? req.uploadedImageUrls
        : providedImages.length
          ? providedImages
          : image
            ? [image]
            : [];
    const uniqueProductImages = [...new Set(productImages)];
    const imageLimit = type === "sparepart" ? 5 : 10;
    if (uniqueProductImages.length > imageLimit) {
      return res.status(400).json({ message: `A ${type === "machine" ? "machine" : "spare part"} may have at most ${imageLimit} images.` });
    }
    const product = await Product.create({
      type,
      category: category._id,
      subcategory: subcategory?._id || null,
      name: name.trim(),
      slug: slugify(slug || name) || `product-${Date.now()}`,
      partCode: type === "machine" ? String(partCode).trim() : "",
      price: priceValue,
      stock: stockValue,
      uom: String(uom).trim(),
      image: uniqueProductImages[0] || "",
      images: uniqueProductImages,
      description: type === "machine" ? description : "",
      specifications: type === "machine" ? parseSpecifications(specifications) : [],
      compatibleMachines: type === "machine" && Array.isArray(compatibleMachines)
        ? compatibleMachines
        : type === "machine"
          ? String(compatibleMachines).split(",").map((item) => item.trim()).filter(Boolean)
          : [],
      inStock: type === "machine" ? inStock !== false && inStock !== "false" : true,
    });

    return res.status(201).json(await populateCategory(Product.findById(product._id)));
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? "Product slug already exists." : "Failed to create product.",
    });
  }
};

export const getProducts = async (req, res) => {
  try {
    const { category, search, type } = req.query;
    if (type && !["sparepart", "machine"].includes(type)) {
      return res.status(400).json({ message: "Product type must be sparepart or machine." });
    }
    const filter = {};
    if (type) filter.type = type;
    if (category) {
      const categoryRecord = /^[0-9a-fA-F]{24}$/.test(category)
        ? await Category.findOne({ _id: category, ...(type ? { type } : {}) })
        : await Category.findOne({ slug: category, ...(type ? { type } : {}) });
      if (!categoryRecord) return res.status(200).json([]);
      filter.category = categoryRecord._id;
    }
    if (search?.trim()) {
      const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { partCode: { $regex: safeSearch, $options: "i" } },
        { description: { $regex: safeSearch, $options: "i" } },
      ];
    }
    const products = await populateCategory(Product.find(filter).sort({ createdAt: -1 }));
    return res.status(200).json(products);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch products.", error: error.message });
  }
};

export const getProductBySlug = async (req, res) => {
  try {
    const product = await populateCategory(Product.findOne({
      slug: req.params.productSlug,
      ...(req.query.type ? { type: req.query.type } : {}),
    }));
    if (!product) return res.status(404).json({ message: "Product not found." });
    return res.status(200).json(product);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch product.", error: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found." });

    const {
      categoryId,
      subcategoryId,
      name,
      slug,
      partCode,
      price,
      stock,
      uom,
      image,
      images,
      imageUrls,
      description,
      specifications,
      compatibleMachines,
      inStock,
      type,
    } = req.body;
    if (type && type !== product.type) {
      return res.status(400).json({ message: "Product type cannot be changed." });
    }
    if (categoryId) {
      const category = await Category.findOne({ _id: categoryId, type: product.type });
      if (!category) return res.status(400).json({ message: "Select a valid category for this product." });
      product.category = category._id;
    }
    if (product.type === "machine" && subcategoryId !== undefined) {
      if (!subcategoryId) {
        product.subcategory = null;
      } else {
        const subcategory = await Subcategory.findOne({
          _id: subcategoryId,
          category: categoryId || product.category,
        });
        if (!subcategory) {
          return res.status(400).json({ message: "Select a subcategory from the chosen category." });
        }
        product.subcategory = subcategory._id;
      }
    } else if (product.type === "machine" && categoryId) {
      product.subcategory = null;
    }
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: "Product name is required." });
      product.name = name.trim();
    }
    if (slug !== undefined || name !== undefined) {
      product.slug = slugify(slug || name || product.name) || `product-${product._id}`;
    }
    if (price !== undefined) {
      const priceValue = Number(price);
      if (!Number.isFinite(priceValue) || priceValue < 0) {
        return res.status(400).json({ message: "Price must be a non-negative number." });
      }
      product.price = priceValue;
    }
    if (product.type === "machine" && stock !== undefined) {
      const stockValue = Number(stock);
      if (!Number.isFinite(stockValue) || stockValue < 0) {
        return res.status(400).json({ message: "Stock must be a non-negative number." });
      }
      product.stock = stockValue;
    }
    if (uom !== undefined) product.uom = String(uom).trim();
    const providedImages = parseArray(product.type === "sparepart" ? imageUrls ?? images : images)
      .filter((url) => typeof url === "string" && url.trim());
    if (product.type === "sparepart" && !providedImages.length && image && typeof image === "string") {
      providedImages.push(image);
    }
    if (req.uploadedImageUrls?.length || (product.type === "sparepart" && imageUrls !== undefined)) {
      const nextImages = product.type === "sparepart"
        ? [...(req.uploadedImageUrls || []), ...providedImages]
        : req.uploadedImageUrls;
      const uniqueImages = [...new Set(nextImages)];
      const imageLimit = product.type === "sparepart" ? 5 : 10;
      if (uniqueImages.length > imageLimit) {
        return res.status(400).json({ message: `A ${product.type === "machine" ? "machine" : "spare part"} may have at most ${imageLimit} images.` });
      }
      product.images = uniqueImages;
      product.image = uniqueImages[0] || "";
    } else if (req.uploadedImageUrls?.length) {
      product.images = req.uploadedImageUrls;
      product.image = req.uploadedImageUrls[0];
    } else if (images !== undefined) {
      product.images = parseArray(images).filter((url) => typeof url === "string" && url.trim());
      product.image = image !== undefined ? image : product.images[0] || "";
    } else if (image !== undefined) {
      product.image = image;
      product.images = image ? [image] : [];
    }
    if (product.type === "machine") {
      if (partCode !== undefined) product.partCode = partCode;
      if (description !== undefined) product.description = description;
      if (specifications !== undefined) product.specifications = parseSpecifications(specifications);
      if (compatibleMachines !== undefined) {
        product.compatibleMachines = Array.isArray(compatibleMachines)
          ? compatibleMachines
          : String(compatibleMachines).split(",").map((item) => item.trim()).filter(Boolean);
      }
      if (inStock !== undefined) product.inStock = inStock !== false && inStock !== "false";
    } else {
      product.subcategory = null;
      product.partCode = "";
      product.stock = 0;
      product.description = "";
      product.specifications = [];
      product.compatibleMachines = [];
      product.inStock = true;
    }

    await product.save();
    return res.status(200).json(await populateCategory(Product.findById(product._id)));
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? "Product slug already exists." : "Failed to update product.",
    });
  }
};

export const exportSpareParts = async (req, res) => {
  try {
    const filter = { type: "sparepart" };
    let filename = "spare-parts-all.xlsx";
    if (req.query.category) {
      if (!/^[0-9a-fA-F]{24}$/.test(req.query.category)) {
        return res.status(400).json({ message: "A valid spare-part category is required." });
      }
      const category = await Category.findOne({ _id: req.query.category, type: "sparepart" });
      if (!category) {
        return res.status(404).json({ message: "Spare-part category not found." });
      }
      filter.category = category._id;
      const safeCategoryName = category.slug.replace(/[^a-z0-9-]/gi, "-");
      filename = `spare-parts-${safeCategoryName}.xlsx`;
    }

    const products = await Product.find(filter).populate("category").sort({ createdAt: -1 }).lean();
    const workbook = createSparePartsWorkbook(products);
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(file);
  } catch (error) {
    console.error("Failed to export spare parts:", error);
    return res.status(500).json({ message: "Failed to export spare parts." });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found." });
    try {
      await deleteCloudinaryImages([product.image, ...(product.images || [])]);
      return res.status(200).json({ message: "Product and associated Cloudinary images deleted successfully." });
    } catch (error) {
      console.error("Product deleted but associated Cloudinary image cleanup failed:", error);
      return res.status(200).json({
        message: "Product deleted, but one or more Cloudinary images could not be deleted.",
        imageCleanupFailed: true,
      });
    }
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete product.", error: error.message });
  }
};

export const deleteProductsByCategory = async (req, res) => {
  const { categoryId } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(categoryId)) {
    return res.status(400).json({ message: "A valid spare-part category is required." });
  }

  try {
    const category = await Category.findOne({ _id: categoryId, type: "sparepart" });
    if (!category) {
      return res.status(404).json({ message: "Spare-part category not found." });
    }

    const categoryProducts = await Product.find({ category: category._id, type: "sparepart" })
      .select("image images")
      .lean();
    const result = await Product.deleteMany({ category: category._id, type: "sparepart" });
    let imageCleanupFailed = false;
    try {
      await deleteCloudinaryImages(categoryProducts.flatMap((product) => [
        product.image,
        ...(product.images || []),
      ]));
    } catch (error) {
      imageCleanupFailed = true;
      console.error("Spare parts deleted but associated Cloudinary image cleanup failed:", error);
    }
    return res.status(200).json({
      message: imageCleanupFailed
        ? "Spare parts deleted, but one or more Cloudinary images could not be deleted."
        : "Spare parts in the selected category deleted successfully.",
      imageCleanupFailed,
      deletedCount: result.deletedCount,
      category: { id: category._id, name: category.name },
    });
  } catch (error) {
    console.error("Failed to delete spare parts by category:", error);
    return res.status(500).json({ message: "Failed to delete spare parts in this category." });
  }
};
