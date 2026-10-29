import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { bootstrap } from './db/bootstrap.js';
import { migrate } from './db/migrate.js';
import { seedDemo } from './db/seed.js';
import { requireAdmin } from './middleware/auth.js';
import { adminCatalogRouter } from './routes/admin/catalog.js';
import { adminMiscRouter } from './routes/admin/misc.js';
import { adminOrdersRouter } from './routes/admin/orders.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { chatRouter } from './routes/chat.js';
import { checkoutRouter } from './routes/checkout.js';
import { messengersRouter } from './routes/messengers.js';
import { publicRouter } from './routes/public.js';
import { setupTelegramWebhook } from './services/notify/telegram.js';
import { setupViberWebhook } from './services/notify/viber.js';
import { errorHandler, HttpError } from './utils/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../../client/dist/client/browser');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  if (!config.isProd) app.use(cors());

  const api = express.Router();
  api.use(messengersRouter); // before json(): the Viber webhook needs the raw body
  api.use(express.json({ limit: '1mb' }));
  api.use(publicRouter);
  api.use(catalogRouter);
  api.use(checkoutRouter);
  api.use(authRouter);
  api.use(chatRouter);
  api.use('/admin', requireAdmin, adminOrdersRouter, adminCatalogRouter, adminMiscRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'Маршрут не знайдено')));
  api.use(errorHandler);
  app.use('/api', api);

  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1y', setHeaders: (res, file) => {
      if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }
  return app;
}

async function main() {
  if (config.isProd && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
  await migrate();
  await bootstrap();
  if (config.seedDemo) await seedDemo();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Amina API listening on :${config.port} (${config.publicUrl})`);
  });
  setupTelegramWebhook().catch((err) => console.error('[telegram] webhook setup failed', err.message));
  setupViberWebhook().catch((err) => console.error('[viber] webhook setup failed', err.message));
}

main().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
