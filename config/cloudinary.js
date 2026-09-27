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

if (cloudinaryUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(cloudinaryUrl);
  } catch {
    throw new Error('CLOUDINARY_URL is invalid. Copy the API environment URL from Cloudinary.');
  }

  if (
    parsedUrl.protocol !== 'cloudinary:' ||
    !parsedUrl.hostname ||
    !parsedUrl.username ||
    !parsedUrl.password
  ) {
    throw new Error(
      'CLOUDINARY_URL is incomplete. It must contain the Cloudinary API key, API secret, and cloud name.'
    );
  }

  let apiKey;
  let apiSecret;
  try {
    apiKey = decodeURIComponent(parsedUrl.username);
    apiSecret = decodeURIComponent(parsedUrl.password);
  } catch {
    throw new Error('CLOUDINARY_URL contains invalid encoded credentials.');
  }

  cloudinary.config({
    cloud_name: parsedUrl.hostname,
    api_key: apiKey,
    api_secret: apiSecret,
    ...(parsedUrl.pathname && parsedUrl.pathname !== '/'
      ? { secure_distribution: parsedUrl.pathname.slice(1) }
      : {}),
  });
} else if (hasIndividualCredentials) {
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