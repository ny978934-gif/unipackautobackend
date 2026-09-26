import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import cloudinary, { isConfigured } from "../config/cloudinary.js";
import { uploadsDirectory } from "../config/uploads.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) return callback(null, true);
    callback(new Error("Only image files are allowed."));
  },
});

const canSaveLocally = process.env.NODE_ENV !== "production" || Boolean(process.env.UPLOAD_DIR);

const saveLocally = async (req, file) => {
  if (!canSaveLocally) {
    throw new Error(
      "Local image storage is disabled in production. Configure Cloudinary or attach a persistent disk and set UPLOAD_DIR."
    );
  }

  const extension = (file.mimetype.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const filename = `${randomUUID()}.${extension}`;

  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadsDirectory, filename), file.buffer);
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

const uploadToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `unipackauto/spare-parts/${randomUUID()}`,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) {
          return reject(new Error("Cloudinary upload succeeded without returning an image URL."));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });

export const uploadImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return next();

    if (!isConfigured || !cloudinary) {
      if (!canSaveLocally) {
        return next(
          new Error(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in the production server."
          )
        );
      }
      return saveLocally(req, req.file)
        .then((url) => {
          req.uploadedImageUrl = url;
          next();
        })
        .catch(next);
    }

    uploadToCloudinary(req.file)
      .then((url) => {
        req.uploadedImageUrl = url;
        next();
      })
      .catch((uploadError) => {
        if (uploadError.http_code === 401 || uploadError.http_code === 403) {
          if (!canSaveLocally) {
            return next(
              new Error(
                "Cloudinary rejected the upload. Check the production Cloudinary API credentials."
              )
            );
          }
          return saveLocally(req, req.file)
            .then((url) => {
              req.uploadedImageUrl = url;
              next();
            })
            .catch(next);
        }
        next(uploadError);
      });
  });
};

const uploadProductImageFiles = upload.fields([
  { name: "images", maxCount: 10 },
  { name: "image", maxCount: 1 },
]);

export const uploadMultipleImages = (req, res, next) => {
  uploadProductImageFiles(req, res, async (error) => {
    if (error) return next(error);
    const files = [...(req.files?.images || []), ...(req.files?.image || [])];
    if (!files.length) return next();

    try {
      if (!isConfigured || !cloudinary) {
        if (!canSaveLocally) {
          throw new Error(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in the production server."
          );
        }
        req.uploadedImageUrls = await Promise.all(files.map((file) => saveLocally(req, file)));
      } else {
        try {
          req.uploadedImageUrls = await Promise.all(files.map(uploadToCloudinary));
        } catch (uploadError) {
          if (uploadError.http_code !== 401 && uploadError.http_code !== 403) throw uploadError;
          if (!canSaveLocally) {
            throw new Error(
              "Cloudinary rejected the upload. Check the production Cloudinary API credentials."
            );
          }
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
