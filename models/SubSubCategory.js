import mongoose from "mongoose";

const subSubCategorySchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
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
    image: {
      type: String,
      default: "",
    },
    images: [
      {
        type: String,
      },
    ],
    imageName: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

subSubCategorySchema.index({ subCategory: 1, slug: 1 }, { unique: true });

export default mongoose.model("SubSubCategory", subSubCategorySchema);
