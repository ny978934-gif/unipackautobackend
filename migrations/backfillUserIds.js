import { randomBytes } from "node:crypto";
import User from "../models/User.js";

export default async function backfillUserIds() {
  const users = await User.find({
    $or: [
      { userId: { $exists: false } },
      { userId: null },
      { userId: "" },
      { status: { $exists: false } },
      { deletedAt: { $exists: false } },
      { authVersion: { $exists: false } },
    ],
  }).select("_id userId status authVersion +deletedAt").lean();

  for (const user of users) {
    const updates = {};
    if (!user.userId) {
      let updated = false;
      for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
        updates.userId = `UPA-${randomBytes(6).toString("hex").toUpperCase()}`;
        try {
          await User.updateOne({ _id: user._id }, { $set: {
            ...updates,
            ...(user.status ? {} : { status: "active" }),
            ...(user.deletedAt === undefined ? { deletedAt: null } : {}),
            ...(user.authVersion === undefined ? { authVersion: 0 } : {}),
          } });
          updated = true;
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      if (!updated) throw new Error(`Could not assign a unique User ID to account ${user._id}.`);
      continue;
    }
    if (!user.status) updates.status = "active";
    if (user.deletedAt === undefined) updates.deletedAt = null;
    if (user.authVersion === undefined) updates.authVersion = 0;
    if (Object.keys(updates).length) await User.updateOne({ _id: user._id }, { $set: updates });
  }
}
