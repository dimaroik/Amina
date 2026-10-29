import { query } from '../../db/pool.js';

export async function logNotification(
  orderId: number | null,
  channel: string,
  recipient: string,
  subject: string,
  run: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await run();
    await query(
      'INSERT INTO notification_log(order_id, channel, recipient, subject, status) VALUES ($1, $2, $3, $4, $5)',
      [orderId, channel, recipient, subject, 'sent'],
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[notify:${channel}] ${recipient}: ${message}`);
    await query(
      'INSERT INTO notification_log(order_id, channel, recipient, subject, status, error) VALUES ($1, $2, $3, $4, $5, $6)',
      [orderId, channel, recipient, subject, 'failed', message.slice(0, 500)],
    ).catch(() => {});
    return false;
  }
}
