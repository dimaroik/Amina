import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Не знайдено') => new HttpError(404, what);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Перевірте правильність заповнення полів', details: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const bodyErr = err as { type?: string; status?: number };
  if (bodyErr?.type === 'entity.parse.failed' || bodyErr?.type === 'entity.too.large') {
    res.status(bodyErr.status ?? 400).json({ error: 'Некоректний запит' });
    return;
  }
  const pgErr = err as { code?: string; detail?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({ error: 'Запис з такими даними вже існує', details: pgErr.detail });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
}
