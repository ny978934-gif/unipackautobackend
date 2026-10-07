import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import categoryRoutes from './routes/categoryRoutes.js';
import contactRoutes from './routes/contact.js';
import productRoutes from './routes/productRoutes.js';
import sparePartImportRoutes from './routes/sparePartImportRoutes.js';
// import subcategoryRoutes from './routes/subcategoryRoutes.js';
import Category from './models/Category.js';
import Product from './models/Product.js';
import Inquiry from './models/Inquiry.js';
import { seedDatabase } from './seed.js';
import backfillCatalogTypes from './migrations/backfillCatalogTypes.js';
import { uploadsDirectory } from './config/uploads.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5000);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const normalizeOrigin = (value) => value.trim().replace(/\/+$/, '');

const envOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedOriginPatterns = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/unipackauto(?:-[a-z0-9-]+)?\.vercel\.app$/i,
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const normalizedOrigin = normalizeOrigin(origin);
    const isAllowed =
      envOrigins.includes(normalizedOrigin) ||
      allowedOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));

    callback(null, isAllowed);
  },
  credentials: true,
};

app.use(cors(corsOptions));

const normalizeLegacyImageUrls = (value, fieldName = '') => {
  if (typeof value === 'string' && ['image', 'images'].includes(fieldName)) {
    return value.replace(
      /^http:\/\/(unipackautobackend\.onrender\.com\/uploads\/)/i,
      'https://$1'
    );
  }

  if (value && typeof value.toJSON === 'function') {
    return normalizeLegacyImageUrls(value.toJSON(), fieldName);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyImageUrls(item, fieldName));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeLegacyImageUrls(item, key),
      ])
    );
  }

  return value;
};

app.use((req, res, next) => {
  const sendJson = res.json;
  res.json = function (body) {
    const jsonBody = body?.toJSON ? body.toJSON() : body;
    return sendJson.call(this, normalizeLegacyImageUrls(jsonBody));
  };
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsDirectory));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'configured' });
});

// Admin stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const [categories, products, inStock, inquiries, newInquiries] = await Promise.all([
      Category.countDocuments({ type: 'sparepart' }),
      Product.countDocuments({ type: 'sparepart' }),
      Product.countDocuments({ type: 'sparepart', inStock: true }),
      Inquiry.countDocuments(),
      Inquiry.countDocuments({ status: 'new' }),
    ]);

    res.json({
      categories,
      products,
      inStock,
      inquiries,
      newInquiries,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
  }
});

app.use('/api/inquiries', contactRoutes);
app.use('/api/spare/categories', categoryRoutes);
// app.use('/api/spare/subcategories', subcategoryRoutes);
app.use('/api/spare-parts', sparePartImportRoutes);
app.use('/api/products', productRoutes);

// Compatibility alias for any spare parts requests
app.use('/api/spare/parts', productRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.use((error, req, res, next) => {
  if (error.providerStatus) {
    console.error('Cloudinary API upload rejection:', {
      status: error.providerStatus,
      message: error.providerMessage,
    });
  }
  console.error(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 500;
  res.status(status).json({
    message:
      error.code === 'LIMIT_FILE_SIZE'
      ? 'Image file is too large. Maximum allowed size is 5 MB.'
      : error.message || 'Internal server error',
  });
});

connectDB()
  .then(async () => {
    await backfillCatalogTypes();
    // Seed initial data if empty
    try {
      await seedDatabase(false);
    } catch (err) {
      console.warn('Auto-seed check notice:', err.message);
    }

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    // Still listen so health & mock responses can indicate server status
    app.listen(PORT, () => {
      console.log(`Server running (DB offline) on http://localhost:${PORT}`);
    });
  });