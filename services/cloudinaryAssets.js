import cloudinary, { isConfigured } from "../config/cloudinary.js";

const cloudinaryAsset = (imageUrl) => {
  try {
    const url = new URL(imageUrl);
    if (url.hostname !== "res.cloudinary.com") return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const uploadIndex = segments.indexOf("upload");
    if (uploadIndex < 1) return null;
    let assetPath = segments.slice(uploadIndex + 1);
    const versionIndex = assetPath.findIndex((segment) => /^v\d+$/.test(segment));
    if (versionIndex >= 0) assetPath = assetPath.slice(versionIndex + 1);
    if (!assetPath.length) return null;

    const lastSegment = assetPath.pop().replace(/\.[a-z0-9]+$/i, "");
    assetPath.push(lastSegment);
    return {
      cloudName: segments[0],
      publicId: decodeURIComponent(assetPath.join("/")),
    };
  } catch {
    return null;
  }
};

export const deleteCloudinaryImages = async (imageUrls = []) => {
  const assets = imageUrls.map(cloudinaryAsset).filter(Boolean);
  if (!assets.length) return;
  if (!isConfigured || !cloudinary) {
    throw new Error("Cloudinary is not configured; saved images could not be deleted.");
  }
  const cloudName = cloudinary.config().cloud_name;
  if (assets.some((asset) => asset.cloudName !== cloudName)) {
    throw new Error("One or more Cloudinary images belong to a different cloud account.");
  }
  const publicIds = [...new Set(assets.map((asset) => asset.publicId))];

  const results = await Promise.all(
    publicIds.map((publicId) => cloudinary.uploader.destroy(publicId, { resource_type: "image" }))
  );
  const failed = results.filter((result) => result.result !== "ok" && result.result !== "not found");
  if (failed.length) {
    throw new Error(`${failed.length} Cloudinary image${failed.length === 1 ? "" : "s"} could not be deleted.`);
  }
};

export const cloudinaryPublicId = (imageUrl) => cloudinaryAsset(imageUrl)?.publicId || null;
