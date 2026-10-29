import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

export interface AuthUser {
  id: number;
  email: string;
  role: 'customer' | 'admin';
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: '30d' });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser;
      req.user = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    if (!req.user) return next(new HttpError(401, 'Потрібна авторизація'));
    next();
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== 'admin') return next(new HttpError(403, 'Доступ заборонено'));
    next();
  });
}
