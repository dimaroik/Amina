import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { chat, getTranscript } from '../services/chatbot.js';
import { getSettings } from '../services/settings.js';
import { HttpError, notFound } from '../utils/errors.js';

export const chatRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });

chatRouter.post('/chat', limiter, async (req, res) => {
  const settings = await getSettings();
  if (!settings.chatbot.enabled) throw new HttpError(403, 'Чат тимчасово недоступний');
  const body = z
    .object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(1000) })
    .parse(req.body);
  res.json(await chat(body.sessionId, body.message));
});

chatRouter.get('/chat/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const transcript = await getTranscript(id);
  if (!transcript) throw notFound();
  res.json({ sessionId: id, transcript });
});
