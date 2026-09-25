import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

const isConfigured = [process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET]
  .every((value) => value && !/^your_(cloud_name|api_key|api_secret)$/i.test(value.trim()));

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
  });
}

export { isConfigured };
export default isConfigured ? cloudinary : null;