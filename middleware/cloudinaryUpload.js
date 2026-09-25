import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import cloudinary, { isConfigured } from "../config/cloudinary.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed."));
  },
});

const saveLocally = async (req) => {
  const extension = (req.file.mimetype.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const filename = `${randomUUID()}.${extension}`;
  const uploadDirectory = path.resolve("uploads");

  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, filename), req.file.buffer);
  req.uploadedImageUrl = `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

export const uploadImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return next();
    const continueWithLocalUpload = () => {
      saveLocally(req)
        .then(() => next())
        .catch(next);
    };

    if (!isConfigured || !cloudinary) {
      return continueWithLocalUpload();
    }

    const stream = cloudinary.uploader.upload_stream(
      { folder: "unipackauto/spare-parts", resource_type: "image" },
      (uploadError, result) => {
        if (uploadError) {
          if (uploadError.http_code === 401 || uploadError.http_code === 403) {
            return continueWithLocalUpload();
          }
          return next(uploadError);
        }
        req.uploadedImageUrl = result.secure_url;
        next();
      }
    );
    stream.end(req.file.buffer);
  });
};
