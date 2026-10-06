import mongoose from "mongoose";
import "dotenv/config";
import Category from "./models/Category.js";
import Product from "./models/Product.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unipackauto";

const defaultCategories = [
  {
    name: "Semi Automatic Strapping Machine",
    slug: "semi-automatic-strapping-machine",
    description: "Spare parts for semi automatic strapping machines.",
  },
  {
    name: "Sealing Machine",
    slug: "sealing-machine",
    description: "Spare parts for continuous band sealers and industrial heat sealers.",
  },
  {
    name: "Packaging Machine",
    slug: "packaging-machine",
    description: "Spare parts for carton sealers, vacuum sealers, and wrapper lines.",
  },
];

const defaultSpareParts = [
  {
    categorySlug: "semi-automatic-strapping-machine",
    name: "Separating Plate",
    slug: "separating-plate",
    partCode: "SP-001",
    price: 850,
    uom: "piece",
    description: "Separating plate for a semi automatic strapping machine.",
  },
  {
    categorySlug: "semi-automatic-strapping-machine",
    name: "Heating Element Blade",
    slug: "heating-element-blade",
    partCode: "HE-004",
    price: 1850,
    uom: "piece",
    description: "Heating blade for strap joint fusion.",
  },
  {
    categorySlug: "semi-automatic-strapping-machine",
    name: "Tension Wheel",
    slug: "tension-wheel",
    partCode: "TW-005",
    price: 1450,
    uom: "piece",
    description: "Replacement tension wheel for strapping machines.",
  },
  {
    categorySlug: "sealing-machine",
    name: "PTFE Teflon Belt",
    slug: "ptfe-teflon-belt",
    partCode: "TB-008",
    price: 420,
    uom: "piece",
    description: "Heat-resistant PTFE belt for continuous band sealers.",
  },
];

export const seedDatabase = async (force = false) => {
  try {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(MONGO_URI);

    const categoryCount = await Category.countDocuments({ type: "sparepart" });
    if (categoryCount > 0 && !force) {
      console.log(`Database already has ${categoryCount} spare-part machine categories. Skipping seed.`);
      return;
    }
    if (force) {
      await Product.deleteMany({ type: "sparepart" });
      await Category.deleteMany({ type: "sparepart" });
    }

    const categories = new Map();
    for (const categoryData of defaultCategories) {
      const category = await Category.findOneAndUpdate(
        { type: "sparepart", slug: categoryData.slug },
        { $setOnInsert: { ...categoryData, type: "sparepart" } },
        { new: true, upsert: true, runValidators: true }
      );
      categories.set(category.slug, category);
    }

    for (const part of defaultSpareParts) {
      const category = categories.get(part.categorySlug);
      if (!category) continue;
      await Product.updateOne(
        { type: "sparepart", slug: part.slug },
        {
          $setOnInsert: {
            ...part,
            category: category._id,
            type: "sparepart",
            image: "",
            images: [],
            inStock: true,
          },
        },
        { upsert: true }
      );
    }
    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error during database seed:", error);
  }
};

if (process.argv[1]?.includes("seed.js")) {
  seedDatabase(true).then(() => {
    console.log("Seed script complete.");
    process.exit(0);
  });
}
