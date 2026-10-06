import Category from "../models/Category.js";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const populateCategory = (query) => query.populate("category");

export const getSubcategories = async (req, res) => {
  try {
    const filter = {};
    if (req.query.categoryId) filter.category = req.query.categoryId;
    const subcategories = await populateCategory(
      Subcategory.find(filter).sort({ createdAt: -1, _id: -1 })
    );
    return res.status(200).json(subcategories);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch subcategories.", error: error.message });
  }
};

export const createSubcategory = async (req, res) => {
  try {
    const { categoryId, name, slug, description = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Subcategory name is required." });

    const category = await Category.findOne({ _id: categoryId, type: "sparepart" });
    if (!category) return res.status(400).json({ message: "Select a valid spare-parts category." });

    const subcategorySlug = slugify(slug || name);
    if (!subcategorySlug) {
      return res.status(400).json({ message: "Subcategory name or slug must contain a letter or number." });
    }

    const subcategory = await Subcategory.create({
      category: category._id,
      name: name.trim(),
      slug: subcategorySlug,
      description,
    });
    return res.status(201).json(await populateCategory(Subcategory.findById(subcategory._id)));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Subcategory slug already exists in this category." });
    if (error.name === "ValidationError") return res.status(400).json({ message: "Subcategory details are invalid." });
    console.error("Failed to create subcategory:", error);
    return res.status(500).json({ message: "Failed to create subcategory." });
  }
};

export const updateSubcategory = async (req, res) => {
  try {
    const subcategory = await Subcategory.findById(req.params.id);
    if (!subcategory) return res.status(404).json({ message: "Subcategory not found." });

    const { categoryId, name, slug, description } = req.body;
    if (categoryId && categoryId !== String(subcategory.category)) {
      const productCount = await Product.countDocuments({ subcategory: subcategory._id });
      if (productCount) {
        return res.status(409).json({ message: "Move or unassign its spare parts before changing the parent category." });
      }
      const category = await Category.findOne({ _id: categoryId, type: "sparepart" });
      if (!category) return res.status(400).json({ message: "Select a valid spare-parts category." });
      subcategory.category = category._id;
    }

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: "Subcategory name is required." });
      subcategory.name = name.trim();
    }
    if (slug !== undefined || name !== undefined) {
      const nextSlug = slugify(slug || name || subcategory.name);
      if (!nextSlug) return res.status(400).json({ message: "Subcategory slug must contain a letter or number." });
      subcategory.slug = nextSlug;
    }
    if (description !== undefined) subcategory.description = description;

    await subcategory.save();
    return res.status(200).json(await populateCategory(Subcategory.findById(subcategory._id)));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Subcategory slug already exists in this category." });
    console.error("Failed to update subcategory:", error);
    return res.status(500).json({ message: "Failed to update subcategory." });
  }
};

export const deleteSubcategory = async (req, res) => {
  try {
    const subcategory = await Subcategory.findByIdAndDelete(req.params.id);
    if (!subcategory) return res.status(404).json({ message: "Subcategory not found." });
    await Product.updateMany({ subcategory: subcategory._id }, { $set: { subcategory: null } });
    return res.status(200).json({ message: "Subcategory deleted successfully." });
  } catch (error) {
    console.error("Failed to delete subcategory:", error);
    return res.status(500).json({ message: "Failed to delete subcategory." });
  }
};
