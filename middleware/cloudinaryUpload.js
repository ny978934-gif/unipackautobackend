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

const saveLocally = async (req, file) => {
  const extension = (file.mimetype.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const filename = `${randomUUID()}.${extension}`;
  const uploadDirectory = path.resolve("uploads");

  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, filename), file.buffer);
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

export const uploadImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return next();

    if (!isConfigured || !cloudinary) {
      return saveLocally(req, req.file)
        .then((url) => {
          req.uploadedImageUrl = url;
          next();
        })
        .catch(next);
    }

    const stream = cloudinary.uploader.upload_stream(
      { folder: "unipackauto/spare-parts", resource_type: "image" },
      (uploadError, result) => {
        if (uploadError) {
          if (uploadError.http_code === 401 || uploadError.http_code === 403) {
            return saveLocally(req, req.file)
              .then((url) => {
                req.uploadedImageUrl = url;
                next();
              })
              .catch(next);
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

const uploadProductImageFiles = upload.fields([
  { name: "images", maxCount: 10 },
  { name: "image", maxCount: 1 },
]);

const uploadToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "unipackauto/spare-parts", resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });

export const uploadMultipleImages = (req, res, next) => {
  uploadProductImageFiles(req, res, async (error) => {
    if (error) return next(error);
    const files = [...(req.files?.images || []), ...(req.files?.image || [])];
    if (!files.length) return next();

    try {
      if (!isConfigured || !cloudinary) {
        req.uploadedImageUrls = await Promise.all(files.map((file) => saveLocally(req, file)));
      } else {
        try {
          req.uploadedImageUrls = await Promise.all(files.map(uploadToCloudinary));
        } catch (uploadError) {
          if (uploadError.http_code !== 401 && uploadError.http_code !== 403) throw uploadError;
          req.uploadedImageUrls = await Promise.all(files.map((file) => saveLocally(req, file)));
        }
      }
      req.uploadedImageUrl = req.uploadedImageUrls[0];
      next();
    } catch (uploadError) {
      next(uploadError);
    }
  });
};
