import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { one, query } from './pool.js';

/** Idempotent first-run setup: admin account and sensible default reference data. */
export async function bootstrap(): Promise<void> {
  if (config.adminEmail && config.adminPassword) {
    const existing = await one('SELECT id, role FROM users WHERE email = $1', [config.adminEmail.toLowerCase()]);
    if (!existing) {
      await query("INSERT INTO users(email, password_hash, name, role) VALUES ($1, $2, 'Адміністратор', 'admin')", [
        config.adminEmail.toLowerCase(),
        await bcrypt.hash(config.adminPassword, 10),
      ]);
      console.log(`[bootstrap] admin ${config.adminEmail} created`);
    }
  }

  const done = await one("SELECT 1 FROM settings WHERE key = '_bootstrapped'");
  if (done) return;

  await query(`INSERT INTO delivery_methods(name, description, type, price, free_from, sort_order) VALUES
    ('Нова пошта — відділення', 'Доставка 1–3 дні у відділення або поштомат', 'np_warehouse', 0, NULL, 1),
    ('Нова пошта — кур''єр', 'Адресна доставка кур''єром Нової пошти', 'np_courier', 0, NULL, 2),
    ('Укрпошта', 'Доставка у відділення Укрпошти, 3–5 днів', 'address', 0, NULL, 3),
    ('Самовивіз', 'Забрати замовлення у шоурумі', 'pickup', 0, NULL, 4)`);
  await query(`INSERT INTO payment_methods(code, name, description, sort_order) VALUES
    ('mono_jar', 'Monobank (QR / банка)', 'Скануйте QR-код або перейдіть за посиланням — оплата за 10 секунд', 1),
    ('mono_acquiring', 'Карткою онлайн', 'Visa, Mastercard, Apple Pay, Google Pay через monobank', 2),
    ('iban', 'Переказ на рахунок (IBAN)', 'Оплата за реквізитами в будь-якому банку', 3),
    ('cod', 'Накладений платіж', 'Оплата при отриманні у відділенні (комісія перевізника)', 4)`);
  await query(`INSERT INTO faq_items(question, answer, sort_order) VALUES
    ('Скільки триває доставка?', 'Ми відправляємо замовлення протягом 1–2 робочих днів. Доставка Новою поштою займає 1–3 дні.', 1),
    ('Як обрати розмір?', 'На сторінці кожного товару є таблиця розмірів. Якщо сумніваєтесь — напишіть нам свої параметри (зріст, обхват грудей, талії, стегон), і ми підкажемо.', 2),
    ('Чи можна повернути або обміняти товар?', 'Так, протягом 14 днів з моменту отримання, якщо річ не була у використанні та збережені бірки. Доставку при поверненні оплачує покупець.', 3),
    ('Які способи оплати доступні?', 'Оплата через Monobank (QR-код або посилання), карткою онлайн, переказом на IBAN або накладеним платежем при отриманні.', 4),
    ('Чи можна приміряти перед оплатою?', 'Так, при оплаті накладеним платежем ви можете оглянути та приміряти речі у відділенні Нової пошти.', 5)`);
  await query(`INSERT INTO settings(key, value) VALUES ('_bootstrapped', 'true')`);
  console.log('[bootstrap] default delivery, payment methods and FAQ created');
}
