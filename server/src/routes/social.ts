import { Router } from 'express';
import { checkState, connectFacebook, connectInstagram, socialJpeg, type SocialNet } from '../services/social.js';

/** Public endpoints Meta talks to: product photos it downloads, and the return from the login dialog. */
export const socialRouter = Router();

socialRouter.get('/social/p/:productId/:file', async (req, res) => {
  const m = String(req.params.file).match(/^(\d{1,2})\.jpg$/);
  const productId = Number(req.params.productId);
  const jpg = m && Number.isInteger(productId) ? await socialJpeg(productId, Number(m[1])) : null;
  if (!jpg) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(jpg);
});

socialRouter.get('/social/callback/:net', async (req, res) => {
  const net = req.params.net as SocialNet;
  const back = (q: string) => res.redirect(`/admin/settings?tab=social&${q}`);
  if (net !== 'instagram' && net !== 'facebook') return res.status(404).end();
  const { code, state, error_description: denied } = req.query as Record<string, string | undefined>;
  if (denied || !code) return back(`error=${encodeURIComponent(denied || 'Вхід скасовано')}`);
  if (!state || !checkState(net, state)) return back(`error=${encodeURIComponent('Посилання для входу застаріло — натисніть «Підключити» ще раз')}`);
  try {
    if (net === 'instagram') {
      await connectInstagram(code);
      return back('connected=instagram');
    }
    const r = await connectFacebook(code);
    return back(r.connected ? 'connected=facebook' : 'choose=facebook');
  } catch (err) {
    console.error('[social connect]', err);
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : 'Не вдалося підключити')}`);
  }
});
