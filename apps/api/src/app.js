import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import wishlistRoutes from './modules/wishlist/wishlist.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import storeInfoRoutes from './modules/settings.public.js';
import { publicRouter as productsPublic, adminRouter as productsAdmin } from './modules/products/products.routes.js';
import { publicRouter as categoriesPublic, adminRouter as categoriesAdmin } from './modules/categories/categories.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Product images are loaded by the web app from a different origin (port).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: env.frontendUrl, credentials: false }));
  app.use(express.json({ limit: '100kb' }));

  // Product images only. Private assets (future phases) must NOT live under this path.
  app.use('/uploads/products', express.static(`${env.uploadDir}/products`, {
    index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/store-info', storeInfoRoutes);
  app.use('/api/categories', categoriesPublic);
  app.use('/api/products', productsPublic);
  app.use('/api/admin/products', productsAdmin);
  app.use('/api/admin/categories', categoriesAdmin);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
