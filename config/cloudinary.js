import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

const configuredCredentials = [
  process.env.CLOUDINARY_CLOUD_NAME,
  process.env.CLOUDINARY_API_KEY,
  process.env.CLOUDINARY_API_SECRET,
];
const hasIndividualCredentials = configuredCredentials.every(
  (value) => value?.trim() && !/^your_(cloud_name|api_key|api_secret)$/i.test(value.trim())
);
const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();

if (cloudinaryUrl && !cloudinaryUrl.startsWith('cloudinary://')) {
  throw new Error('CLOUDINARY_URL must start with cloudinary://.');
}

if (!cloudinaryUrl && hasIndividualCredentials) {
  cloudinary.config({
    cloud_name: configuredCredentials[0].trim(),
    api_key: configuredCredentials[1].trim(),
    api_secret: configuredCredentials[2].trim(),
  });
}

const cloudinaryConfig = cloudinary.config();
const isConfigured = Boolean(
  cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret
);

export { isConfigured };
export default isConfigured ? cloudinary : null;