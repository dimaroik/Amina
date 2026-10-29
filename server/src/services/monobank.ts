import { config } from '../config.js';

const API = 'https://api.monobank.ua/api/merchant';

export const monoAcquiringEnabled = () => Boolean(config.monobank.token);

/** Creates a Monobank acquiring invoice; amounts are in hryvnias. */
export async function createInvoice(params: {
  amount: number;
  reference: string;
  destination: string;
  redirectUrl: string;
  webHookUrl: string;
}): Promise<{ invoiceId: string; pageUrl: string }> {
  const res = await fetch(`${API}/invoice/create`, {
    method: 'POST',
    headers: { 'X-Token': config.monobank.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(params.amount * 100),
      ccy: 980,
      merchantPaymInfo: { reference: params.reference, destination: params.destination },
      redirectUrl: params.redirectUrl,
      webHookUrl: params.webHookUrl,
      validity: 60 * 60 * 24,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Monobank invoice error ${res.status}: ${await res.text()}`);
  return (await res.json()) as { invoiceId: string; pageUrl: string };
}

/** Status is always re-read from Monobank so webhook bodies never need to be trusted. */
export async function getInvoiceStatus(invoiceId: string): Promise<{ status: string; reference?: string }> {
  const res = await fetch(`${API}/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`, {
    headers: { 'X-Token': config.monobank.token },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Monobank status error ${res.status}`);
  return (await res.json()) as { status: string; reference?: string };
}

/** Link to a Monobank "jar" with prefilled amount and comment — encoded in the checkout QR code. */
export function jarLink(jarUrl: string, amount: number, comment: string): string {
  if (!jarUrl) return '';
  try {
    const url = new URL(jarUrl);
    url.searchParams.set('a', String(Math.round(amount)));
    url.searchParams.set('t', comment);
    return url.toString();
  } catch {
    return jarUrl;
  }
}
