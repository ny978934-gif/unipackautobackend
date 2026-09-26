import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import categoryRoutes from './routes/categoryRoutes.js';
import contactRoutes from './routes/contact.js';
import productRoutes from './routes/productRoutes.js';
import subCategoryRoutes from './routes/subCategoryRoutes.js';
import subSubCategoryRoutes from './routes/subSubCategoryRoutes.js';
import Category from './models/Category.js';
import SubCategory from './models/SubCategory.js';
import Product from './models/Product.js';
import { seedDatabase } from './seed.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5000);

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const normalizeOrigin = (value) => value.trim().replace(/\/+$/, '');

// Dynamic CORS to allow localhost, 127.0.0.1 on any port during development
app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, or Postman)
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOrigin(origin);
      const allowedPatterns = [
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      ];

      const envOrigins = (process.env.CLIENT_ORIGIN || '')
        .split(',')
        .map((o) => normalizeOrigin(o))
        .filter(Boolean);

      if (
        allowedPatterns.some((pattern) => pattern.test(normalizedOrigin)) ||
        envOrigins.includes(normalizedOrigin)
      ) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev to prevent blocking
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'configured' });
});

// Admin stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const [categories, subcategories, products, inStock] = await Promise.all([
      Category.countDocuments(),
      SubCategory.countDocuments(),
      Product.countDocuments(),
      Product.countDocuments({ inStock: true }),
    ]);

    res.json({
      categories,
      subcategories,
      products,
      inStock,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
  }
});

app.use('/api/inquiries', contactRoutes);
app.use('/api/spare/categories', categoryRoutes);
app.use('/api/subcategories', subCategoryRoutes);
app.use('/api/sub-subcategories', subSubCategoryRoutes);
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
  console.error(error);
  res.status(error.status || 500).json({
    message: error.message || 'Internal server error',
  });
});

connectDB()
  .then(async () => {
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