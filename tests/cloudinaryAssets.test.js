import assert from "node:assert/strict";
import test from "node:test";
import { cloudinaryPublicId } from "../services/cloudinaryAssets.js";

test("extracts a Cloudinary public ID with a version", () => {
  assert.equal(
    cloudinaryPublicId("https://res.cloudinary.com/example-cloud/image/upload/v1234567890/unipackauto/spare-parts/image-id.jpg"),
    "unipackauto/spare-parts/image-id",
  );
});

test("extracts a Cloudinary public ID when transformations precede the version", () => {
  assert.equal(
    cloudinaryPublicId("https://res.cloudinary.com/example-cloud/image/upload/c_fill,w_400/v1234567890/products/part.png"),
    "products/part",
  );
});

test("ignores non-Cloudinary image URLs", () => {
  assert.equal(cloudinaryPublicId("https://example.com/part.jpg"), null);
});
