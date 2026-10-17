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
    // Stored as "scrypt$<salt_base64url>$<hash_base64url>" — same scheme as Admin
    passwordHash: {
      type: String,
      required: true,
      select: false,       // never returned in queries by default
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
