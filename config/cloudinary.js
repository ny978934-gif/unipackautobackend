import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

// Try individual credentials first (most reliable — no URL parsing quirks)
const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

const isPlaceholder = (v) => !v || /^your_(cloud_name|api_key|api_secret)$/i.test(v);

const hasIndividualCredentials =
  !isPlaceholder(cloudName) && !isPlaceholder(apiKey) && !isPlaceholder(apiSecret);

if (hasIndividualCredentials) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
} else {
  // Fall back to CLOUDINARY_URL — must be cloudinary://api_key:api_secret@cloud_name
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  if (cloudinaryUrl) {
    // Use a dummy base so Node's URL parser can handle the custom protocol
    const normalized = cloudinaryUrl.replace(/^cloudinary:\/\//, 'https://');
    try {
      const parsed = new URL(normalized);
      const parsedKey = decodeURIComponent(parsed.username);
      const parsedSecret = decodeURIComponent(parsed.password);
      const parsedCloud = parsed.hostname;

      if (parsedKey && parsedSecret && parsedCloud) {
        cloudinary.config({
          cloud_name: parsedCloud,
          api_key: parsedKey,
          api_secret: parsedSecret,
        });
      } else {
        console.warn(
          'CLOUDINARY_URL is incomplete — cloud name, API key, or API secret could not be parsed. ' +
          'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET instead.'
        );
      }
    } catch {
      console.warn(
        'CLOUDINARY_URL could not be parsed. ' +
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET instead.'
      );
    }
  }
}

const cloudinaryConfig = cloudinary.config();
const isConfigured = Boolean(
  cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret
);

export { isConfigured };
export default isConfigured ? cloudinary : null;
