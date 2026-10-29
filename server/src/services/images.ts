import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { one } from '../db/pool.js';

/** Resizes an upload to a web-friendly WebP and stores it in Postgres. */
export async function storeImage(buffer: Buffer): Promise<{ id: string; url: string; width: number; height: number }> {
  const img = sharp(buffer, { failOn: 'none' }).rotate();
  const out = await img
    .resize({ width: 1600, height: 2200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const id = randomUUID();
  await one('INSERT INTO images(id, mime, data, width, height) VALUES ($1, $2, $3, $4, $5)', [
    id,
    'image/webp',
    out.data,
    out.info.width,
    out.info.height,
  ]);
  return { id, url: `/api/images/${id}`, width: out.info.width, height: out.info.height };
}

export async function loadImage(id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return one<{ mime: string; data: Buffer }>('SELECT mime, data FROM images WHERE id = $1', [id]);
}
