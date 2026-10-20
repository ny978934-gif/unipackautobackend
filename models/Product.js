import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["sparepart", "machine"],
      default: "machine",
      index: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    subcategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subcategory",
      default: null,
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

    partCode: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      default: 0,
      min: 0,
    },

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    uom: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "",
    },

    images: {
      type: [{ type: String }],
      validate: {
        validator(images) {
          return this.type !== "sparepart" || images.length <= 5;
        },
        message: "Spare parts can have at most 5 images.",
      },
    },

    description: {
      type: String,
      default: "",
    },

    specifications: [
      {
        label: String,
        value: String,
      },
    ],

    compatibleMachines: [
      {
        type: String,
      },
    ],

    inStock: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_document, product) => {
        if (product.type === "sparepart") {
          if (!product.image && product.images?.length) {
            product.image = product.images[0];
          }
          [
            "subcategory",
            "partCode",
            "stock",
            "description",
            "specifications",
            "compatibleMachines",
            "inStock",
          ].forEach((field) => delete product[field]);
        }
        return product;
      },
    },
  }
);

export default mongoose.model(
  "Product",
  productSchema
);