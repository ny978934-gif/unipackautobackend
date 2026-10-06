import Category from "../models/Category.js";
import Product from "../models/Product.js";

export default async function backfillCatalogTypes() {
  const indexes = await Category.collection.indexes().catch((error) => {
    if (error.code === 26) return [];
    throw error;
  });
  if (indexes.some((index) => index.name === "slug_1")) {
    await Category.collection.dropIndex("slug_1");
  }
  await Category.collection.createIndex(
    { type: 1, slug: 1 },
    { unique: true }
  );

  const legacyType = { $exists: false };
  const result = await Promise.all([
    Category.updateMany({ type: legacyType }, { $set: { type: "sparepart" } }),
    Product.updateMany({ type: legacyType }, { $set: { type: "sparepart" } }),
  ]);
  const migratedCount = result.reduce((total, item) => total + item.modifiedCount, 0);
  if (migratedCount) {
    console.info(`Classified ${migratedCount} existing catalog records as spare parts.`);
  }
}
