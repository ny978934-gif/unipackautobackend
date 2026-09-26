import path from "path";
import { fileURLToPath } from "url";

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const uploadsDirectory = path.resolve(
  process.env.UPLOAD_DIR || path.join(serverDirectory, "uploads")
);
