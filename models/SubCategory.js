import mongoose from "mongoose";

const subcategorySchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

subcategorySchema.index({ category: 1, slug: 1 }, { unique: true });

export default mongoose.model("Subcategory", subcategorySchema);
