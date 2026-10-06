import Category from "../models/Category.js";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";

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
    const subcategory = subcategoryId
      ? await Subcategory.findOne({ _id: subcategoryId, category: category._id })
      : null;
    if (subcategoryId && !subcategory) {
      return res.status(400).json({ message: "Select a subcategory from the chosen category." });
    }

    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      return res.status(400).json({ message: "Price must be a non-negative number." });
    }
    const stockValue = Number(stock);
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      return res.status(400).json({ message: "Stock must be a non-negative number." });
    }

    const providedImages = parseArray(images).filter((url) => typeof url === "string" && url.trim());
    const productImages = req.uploadedImageUrls?.length
      ? req.uploadedImageUrls
      : providedImages.length
        ? providedImages
        : image
          ? [image]
          : [];
    const product = await Product.create({
      type,
      category: category._id,
      subcategory: subcategory?._id || null,
      name: name.trim(),
      slug: slugify(slug || name) || `product-${Date.now()}`,
      partCode: String(partCode).trim(),
      price: priceValue,
      stock: stockValue,
      uom: String(uom).trim(),
      image: productImages[0] || "",
      images: productImages,
      description,
      specifications: parseSpecifications(specifications),
      compatibleMachines: Array.isArray(compatibleMachines)
        ? compatibleMachines
        : String(compatibleMachines).split(",").map((item) => item.trim()).filter(Boolean),
      inStock: inStock !== false && inStock !== "false",
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
    if (subcategoryId !== undefined) {
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
    } else if (categoryId) {
      product.subcategory = null;
    }
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: "Product name is required." });
      product.name = name.trim();
    }
    if (slug !== undefined || name !== undefined) {
      product.slug = slugify(slug || name || product.name) || `product-${product._id}`;
    }
    if (partCode !== undefined) product.partCode = partCode;
    if (price !== undefined) {
      const priceValue = Number(price);
      if (!Number.isFinite(priceValue) || priceValue < 0) {
        return res.status(400).json({ message: "Price must be a non-negative number." });
      }
      product.price = priceValue;
    }
    if (stock !== undefined) {
      const stockValue = Number(stock);
      if (!Number.isFinite(stockValue) || stockValue < 0) {
        return res.status(400).json({ message: "Stock must be a non-negative number." });
      }
      product.stock = stockValue;
    }
    if (uom !== undefined) product.uom = String(uom).trim();
    if (req.uploadedImageUrls?.length) {
      product.images = req.uploadedImageUrls;
      product.image = req.uploadedImageUrls[0];
    } else if (images !== undefined) {
      product.images = parseArray(images).filter((url) => typeof url === "string" && url.trim());
      product.image = image !== undefined ? image : product.images[0] || "";
    } else if (image !== undefined) {
      product.image = image;
      product.images = image ? [image] : [];
    }
    if (description !== undefined) product.description = description;
    if (specifications !== undefined) product.specifications = parseSpecifications(specifications);
    if (compatibleMachines !== undefined) {
      product.compatibleMachines = Array.isArray(compatibleMachines)
        ? compatibleMachines
        : String(compatibleMachines).split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (inStock !== undefined) product.inStock = inStock !== false && inStock !== "false";

    await product.save();
    return res.status(200).json(await populateCategory(Product.findById(product._id)));
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000 ? "Product slug already exists." : "Failed to update product.",
    });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found." });
    return res.status(200).json({ message: "Product deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete product.", error: error.message });
  }
};
