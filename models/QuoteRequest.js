import mongoose from "mongoose";

const sparePartSchema = new mongoose.Schema(
  {
    machine: { type: String, required: true, trim: true, maxlength: 300 },
    machineCategory: { type: String, trim: true, maxlength: 150, default: "" },
    machineName: { type: String, trim: true, maxlength: 150, default: "" },
    partName: { type: String, required: true, trim: true, maxlength: 150 },
    itemCode: { type: String, trim: true, maxlength: 100, default: "" },
    quantity: { type: Number, required: true, min: 1, max: 100000 },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false }
);

const quoteRequestSchema = new mongoose.Schema(
  {
    quoteType: { type: String, enum: ["sparePart", "machine"], required: true },
    company: { type: String, required: true, trim: true, maxlength: 200 },
    contactName: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    state: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, trim: true, maxlength: 4000, default: "" },
    parts: { type: [sparePartSchema], default: [] },
    machineType: { type: String, trim: true, maxlength: 150 },
    model: { type: String, trim: true, maxlength: 150 },
    quantity: { type: Number, min: 1, max: 100000 },
    specifications: { type: String, trim: true, maxlength: 4000 },
    attachment: { type: attachmentSchema, default: null },
    status: {
      type: String,
      enum: ["new", "in_progress", "quoted", "closed"],
      default: "new",
    },
    notificationStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("QuoteRequest", quoteRequestSchema);
