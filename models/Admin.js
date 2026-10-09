import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    bootstrapAccount: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

adminSchema.index(
  { bootstrapAccount: 1 },
  { unique: true, partialFilterExpression: { bootstrapAccount: "initial" } }
);

export default mongoose.model("Admin", adminSchema);
