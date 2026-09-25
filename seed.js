import mongoose from "mongoose";
import "dotenv/config";
import Category from "./models/Category.js";
import SubCategory from "./models/SubCategory.js";
import Product from "./models/Product.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/unipackauto";

export const seedDatabase = async (force = false) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGO_URI);
    }

    const categoryCount = await Category.countDocuments();
    if (categoryCount > 0 && !force) {
      console.log(`Database already has ${categoryCount} categories. Skipping seed.`);
      return;
    }

    console.log("Seeding database with default categories, subcategories, and products...");

    if (force) {
      await Product.deleteMany({});
      await SubCategory.deleteMany({});
      await Category.deleteMany({});
    }

    // 1. Create Categories
    const categoriesData = [
      {
        name: "Semi Automatic Strapping Machine Spare Parts",
        slug: "semi-automatic-strapping-machine-spare-parts",
        image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80",
        description: "High quality spare parts engineered for heavy-duty semi automatic strapping machines.",
      },
      {
        name: "Sealing Machine Parts",
        slug: "sealing-machine-parts",
        image: "https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?auto=format&fit=crop&w=800&q=80",
        description: "Reliable replacement parts for continuous band sealers and industrial heat sealers.",
      },
      {
        name: "Packaging Machine Parts",
        slug: "packaging-machine-parts",
        image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80",
        description: "Premium spare parts for carton sealers, vacuum sealers, and wrapper lines.",
      },
      {
        name: "Conveyor Machine Parts",
        slug: "conveyor-machine-parts",
        image: "https://images.unsplash.com/photo-1565610222536-ef125c59da2e?auto=format&fit=crop&w=800&q=80",
        description: "Durable conveyor rollers, motorized drives, and handling equipment spare parts.",
      },
    ];

    const savedCategories = {};
    for (const cat of categoriesData) {
      const existing = await Category.findOne({ slug: cat.slug });
      if (existing) {
        savedCategories[cat.slug] = existing;
      } else {
        savedCategories[cat.slug] = await Category.create(cat);
      }
    }

    // 2. Create SubCategories
    const subCategoriesData = [
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        name: "Separating Plate",
        slug: "separating-plate",
        image: "https://images.unsplash.com/photo-1581092919535-7146ff1a5900?auto=format&fit=crop&w=800&q=80",
        description: "Separating plates and guide blocks used in strapping machine feeding tracks.",
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        name: "Heating Element",
        slug: "heating-element",
        image: "https://images.unsplash.com/photo-1581093458791-9d42e3c6b1b4?auto=format&fit=crop&w=800&q=80",
        description: "Instant heating blades and thermal heating elements for PP strap joint fusion.",
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        name: "Tension Wheel",
        slug: "tension-wheel",
        image: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=80",
        description: "High-grip tension roller wheels and feed mechanisms for strapping machines.",
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        name: "Sealing Cutter",
        slug: "sealing-cutter",
        image: "https://images.unsplash.com/photo-1581092335397-9583eb92d232?auto=format&fit=crop&w=800&q=80",
        description: "Alloy steel cutter blades for clean and instant strap trimming after sealing.",
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        name: "Roller Assembly",
        slug: "roller-assembly",
        image: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?auto=format&fit=crop&w=800&q=80",
        description: "Complete top and bottom roller assemblies with precision ball bearings.",
      },
      {
        categorySlug: "sealing-machine-parts",
        name: "PTFE Teflon Belts",
        slug: "ptfe-teflon-belts",
        image: "https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?auto=format&fit=crop&w=800&q=80",
        description: "Heat-resistant seamless PTFE belts for continuous band sealing equipment.",
      },
      {
        categorySlug: "sealing-machine-parts",
        name: "Heating Block",
        slug: "heating-block",
        image: "https://images.unsplash.com/photo-1581093458791-9d42e3c6b1b4?auto=format&fit=crop&w=800&q=80",
        description: "Solid brass heating blocks for steady temperature heat transfer during sealing.",
      },
    ];

    const savedSubCategories = {};
    for (const sub of subCategoriesData) {
      const parentCat = savedCategories[sub.categorySlug];
      if (!parentCat) continue;
      const key = `${sub.categorySlug}::${sub.slug}`;
      const existing = await SubCategory.findOne({ slug: sub.slug, category: parentCat._id });
      if (existing) {
        savedSubCategories[key] = existing;
      } else {
        savedSubCategories[key] = await SubCategory.create({
          category: parentCat._id,
          name: sub.name,
          slug: sub.slug,
          image: sub.image,
          description: sub.description,
        });
      }
    }

    // 3. Create Products
    const productsData = [
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "separating-plate",
        slug: "separating-plate-china",
        name: "Separating Plate China",
        partCode: "SP-CH-001",
        price: 850,
        image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1000&q=80",
        description: "High quality separating plate manufactured for semi-automatic strapping machines. Provides reliable strap routing and extended operating lifespan.",
        specifications: [
          { label: "Material", value: "Industrial Grade Steel" },
          { label: "Part Type", value: "Separating Plate" },
          { label: "Country of Origin", value: "China" },
          { label: "Application", value: "Semi-Automatic Strapping Machine" },
        ],
        compatibleMachines: [
          "Semi Automatic Strapping Machine",
          "KZB Series Machines",
          "Extend / Transpak Compatible",
        ],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "separating-plate",
        slug: "separating-plate-extend-306",
        name: "Separating Plate Extend 306",
        partCode: "SP-306-002",
        price: 1200,
        image: "https://images.unsplash.com/photo-1581092335397-9583eb92d232?auto=format&fit=crop&w=1000&q=80",
        description: "Precision CNC milled separating plate suitable for Extend 306 packaging machines. Perfect strap alignment prevents jams.",
        specifications: [
          { label: "Material", value: "Hardened Tool Steel" },
          { label: "Part Type", value: "Separating Plate" },
          { label: "Model", value: "Extend 306" },
        ],
        compatibleMachines: ["Extend EX-306", "Semi Automatic Strapping Machines"],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "separating-plate",
        slug: "separating-plate-join-pack",
        name: "Separating Plate Join Pack",
        partCode: "SP-JP-003",
        price: 950,
        image: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?auto=format&fit=crop&w=1000&q=80",
        description: "Reliable separating plate component designed specifically for Join Pack strapping units.",
        specifications: [
          { label: "Material", value: "Industrial Steel" },
          { label: "Part Type", value: "Separating Plate" },
        ],
        compatibleMachines: ["Join Pack Standard Series", "Semi-Automatic Machines"],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "heating-element",
        slug: "heating-element-220v",
        name: "Heating Element Blade 220V",
        partCode: "HE-220-004",
        price: 1850,
        image: "https://images.unsplash.com/photo-1581093458791-9d42e3c6b1b4?auto=format&fit=crop&w=1000&q=80",
        description: "Fast-heating thermal blade that delivers instantaneous, high-strength heat fusion for PP straps. Low thermal degradation.",
        specifications: [
          { label: "Voltage", value: "220V AC" },
          { label: "Power Rating", value: "850 Watts" },
          { label: "Operating Temp", value: "Up to 350°C" },
        ],
        compatibleMachines: ["All Standard Semi-Automatic Strapping Machines"],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "tension-wheel",
        slug: "high-tension-wheel",
        name: "High-Tension Feed Wheel",
        partCode: "TW-ST-005",
        price: 1450,
        image: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=1000&q=80",
        description: "Hardened knurled tension wheel ensuring firm grip without damaging plastic strap surfaces.",
        specifications: [
          { label: "Material", value: "Carburized High Carbon Steel" },
          { label: "Hardness", value: "HRC 58-62" },
        ],
        compatibleMachines: ["KZB-I, KZB-II, and Transpak Equivalent Units"],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "sealing-cutter",
        slug: "carbide-sealing-cutter",
        name: "Carbide Sealing Cutter Blade",
        partCode: "SC-BL-006",
        price: 650,
        image: "https://images.unsplash.com/photo-1581092335397-9583eb92d232?auto=format&fit=crop&w=1000&q=80",
        description: "Razor-sharp carbide strap cutter designed for 100,000+ continuous clean cuts on Polypropylene packaging straps.",
        specifications: [
          { label: "Blade Material", value: "Tungsten Carbide Edge" },
          { label: "Strap Width", value: "6mm - 15mm" },
        ],
        compatibleMachines: ["Universal Semi-Automatic Strapping Machines"],
        inStock: true,
      },
      {
        categorySlug: "semi-automatic-strapping-machine-spare-parts",
        subCategorySlug: "roller-assembly",
        slug: "precision-roller-assembly",
        name: "Precision Roller Assembly",
        partCode: "RA-PR-007",
        price: 2100,
        image: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?auto=format&fit=crop&w=1000&q=80",
        description: "Complete feed and tension roller assembly mounted with dual sealed bearings for vibration-free strap delivery.",
        specifications: [
          { label: "Bearing Type", value: "Dual Sealed Ball Bearings" },
          { label: "Coating", value: "Anti-Corrosive Nickel Plated" },
        ],
        compatibleMachines: ["Semi Automatic Strapping Machines"],
        inStock: true,
      },
      {
        categorySlug: "sealing-machine-parts",
        subCategorySlug: "ptfe-teflon-belts",
        slug: "ptfe-teflon-belt-770",
        name: "Seamless PTFE Teflon Belt 770mm",
        partCode: "TB-770-008",
        price: 420,
        image: "https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?auto=format&fit=crop&w=1000&q=80",
        description: "Seamless woven fiberglass PTFE Teflon belt offering outstanding thermal conductivity and non-stick release for continuous band sealers.",
        specifications: [
          { label: "Circumference", value: "770mm" },
          { label: "Width", value: "15mm" },
          { label: "Max Temp", value: "260°C" },
        ],
        compatibleMachines: ["FR-900, DBF-900 Continuous Band Sealers"],
        inStock: true,
      },
    ];

    for (const prod of productsData) {
      const parentCat = savedCategories[prod.categorySlug];
      const subKey = `${prod.categorySlug}::${prod.subCategorySlug}`;
      const parentSub = savedSubCategories[subKey];
      if (!parentCat || !parentSub) continue;

      const existing = await Product.findOne({ slug: prod.slug });
      if (!existing) {
        await Product.create({
          category: parentCat._id,
          subCategory: parentSub._id,
          name: prod.name,
          slug: prod.slug,
          partCode: prod.partCode,
          price: prod.price,
          image: prod.image,
          images: [prod.image],
          description: prod.description,
          specifications: prod.specifications,
          compatibleMachines: prod.compatibleMachines,
          inStock: prod.inStock,
        });
      }
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
