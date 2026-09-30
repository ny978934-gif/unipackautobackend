import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["sparepart", "machine"],
      default: "machine",
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
    },

    image: {
      type: String,
      default: "",
    },

    imageName: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

categorySchema.index({ type: 1, slug: 1 }, { unique: true });

export default mongoose.model("Category", categorySchema);