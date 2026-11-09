import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    userId: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 40,
      unique: true,
      sparse: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,       // never returned in queries by default
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    authVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    deletedAt: {
      type: Date,
      default: null,
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
      maxlength: 30,
    },
    company: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
