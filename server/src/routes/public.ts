import { Router } from 'express';
import { config } from '../config.js';
import { loadImage } from '../services/images.js';
import { getSettings } from '../services/settings.js';
import { notFound } from '../utils/errors.js';

export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

publicRouter.get('/settings/public', async (_req, res) => {
  const s = await getSettings();
  res.json({
    store: s.store,
    chatbot: { enabled: s.chatbot.enabled, botName: s.chatbot.botName, greeting: s.chatbot.greeting },
    analytics: s.analytics,
    telegramBot: config.telegram.botUsername,
  });
});

publicRouter.get('/images/:id', async (req, res) => {
  const img = await loadImage(req.params.id);
  if (!img) throw notFound();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(img.data);
});
