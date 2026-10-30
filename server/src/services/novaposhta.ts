import { config } from '../config.js';

// Overridable only to point tests at a stub; production always uses the real endpoints
const API = process.env.NOVA_POSHTA_API_URL || 'https://api.novaposhta.ua/v2.0/json/';
const PRINT = process.env.NOVA_POSHTA_PRINT_URL || 'https://my.novaposhta.ua/orders';

export async function call<T>(modelName: string, calledMethod: string, methodProperties: Record<string, unknown>): Promise<T[]> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.novaPoshtaApiKey, modelName, calledMethod, methodProperties }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { success: boolean; data: T[]; errors: string[] };
  if (!json.success) throw new Error(json.errors?.join(', ') || 'Nova Poshta API error');
  return json.data;
}

export const novaPoshtaEnabled = () => Boolean(config.novaPoshtaApiKey);

export async function searchCities(q: string): Promise<{ ref: string; name: string; area: string }[]> {
  if (!q.trim()) return [];
  const data = await call<any>('AddressGeneral', 'getCities', { FindByString: q, Limit: '20', Page: '1' });
  return data.map((c) => ({
    ref: c.Ref,
    name: `${c.SettlementTypeDescription ? c.SettlementTypeDescription.slice(0, 1) + '. ' : ''}${c.Description}`,
    area: c.AreaDescription ?? '',
  }));
}

export async function searchWarehouses(
  cityRef: string,
  q: string,
): Promise<{ ref: string; name: string; number: string }[]> {
  const data = await call<any>('AddressGeneral', 'getWarehouses', {
    CityRef: cityRef,
    FindByString: q,
    Limit: '50',
    Page: '1',
  });
  return data.map((w) => ({ ref: w.Ref, name: w.Description, number: w.Number }));
}

// ---------- waybills (ТТН) ----------

export class NovaPoshtaError extends Error {}

/** Same request as call(), but surfaces Nova Poshta's own error text to the admin. */
async function callStrict<T>(modelName: string, calledMethod: string, methodProperties: Record<string, unknown>): Promise<T[]> {
  if (!novaPoshtaEnabled()) throw new NovaPoshtaError('NOVA_POSHTA_API_KEY не налаштовано');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.novaPoshtaApiKey, modelName, calledMethod, methodProperties }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { success: boolean; data: T[]; errors: string[]; warnings?: string[] };
  if (!json.success) throw new NovaPoshtaError(`Нова пошта: ${(json.errors ?? []).join('; ') || 'невідома помилка'}`);
  return json.data;
}

let senderCache: { ref: string; contactRef: string; name: string; at: number } | null = null;

/** The account's own sender counterparty and its contact person (looked up once an hour). */
export async function getSender(): Promise<{ ref: string; contactRef: string; name: string }> {
  if (senderCache && Date.now() - senderCache.at < 3_600_000) return senderCache;
  const [sender] = await callStrict<{ Ref: string; Description: string }>('Counterparty', 'getCounterparties', {
    CounterpartyProperty: 'Sender',
    Page: '1',
  });
  if (!sender) throw new NovaPoshtaError('У кабінеті Нової пошти не знайдено відправника');
  const [contact] = await callStrict<{ Ref: string; Description: string }>('Counterparty', 'getCounterpartyContactPersons', {
    Ref: sender.Ref,
    Page: '1',
  });
  if (!contact) throw new NovaPoshtaError('У відправника немає контактної особи в кабінеті Нової пошти');
  senderCache = { ref: sender.Ref, contactRef: contact.Ref, name: contact.Description || sender.Description, at: Date.now() };
  return senderCache;
}

export function npPhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length === 9) d = `380${d}`;
  if (d.length === 10 && d.startsWith('0')) d = `38${d}`;
  return d;
}

/** Creates a private-person recipient and returns its counterparty + contact refs. */
export async function createRecipient(firstName: string, lastName: string, phone: string) {
  const [r] = await callStrict<{ Ref: string; ContactPerson: { data: { Ref: string }[] } }>('Counterparty', 'save', {
    FirstName: firstName,
    LastName: lastName,
    MiddleName: '',
    Phone: npPhone(phone),
    Email: '',
    CounterpartyType: 'PrivatePerson',
    CounterpartyProperty: 'Recipient',
  });
  const contactRef = r?.ContactPerson?.data?.[0]?.Ref;
  if (!r?.Ref || !contactRef) throw new NovaPoshtaError('Нова пошта не створила отримувача');
  return { ref: r.Ref, contactRef };
}

export interface WaybillInput {
  sender: { ref: string; contactRef: string; cityRef: string; warehouseRef: string; phone: string };
  recipient: { ref: string; contactRef: string; cityRef: string; warehouseRef: string; phone: string };
  weight: number;
  declaredValue: number;
  description: string;
  payer: 'Recipient' | 'Sender';
  /** Cash on delivery amount (накладений платіж), 0 to skip */
  codAmount: number;
}

export async function createWaybill(w: WaybillInput) {
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  const props: Record<string, unknown> = {
    PayerType: w.payer,
    PaymentMethod: 'Cash',
    DateTime: date,
    CargoType: 'Parcel',
    ServiceType: 'WarehouseWarehouse',
    SeatsAmount: '1',
    Weight: String(w.weight),
    Description: w.description,
    Cost: String(Math.max(1, Math.round(w.declaredValue))),
    CitySender: w.sender.cityRef,
    Sender: w.sender.ref,
    SenderAddress: w.sender.warehouseRef,
    ContactSender: w.sender.contactRef,
    SendersPhone: npPhone(w.sender.phone),
    CityRecipient: w.recipient.cityRef,
    Recipient: w.recipient.ref,
    RecipientAddress: w.recipient.warehouseRef,
    ContactRecipient: w.recipient.contactRef,
    RecipientsPhone: npPhone(w.recipient.phone),
  };
  if (w.codAmount > 0) {
    props['BackwardDeliveryData'] = [{ PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: String(Math.round(w.codAmount)) }];
  }
  const [doc] = await callStrict<{ Ref: string; IntDocNumber: string; CostOnSite: number; EstimatedDeliveryDate: string }>(
    'InternetDocument',
    'save',
    props,
  );
  if (!doc?.IntDocNumber) throw new NovaPoshtaError('Нова пошта не повернула номер ТТН');
  return doc;
}

export async function deleteWaybill(ref: string): Promise<void> {
  await callStrict('InternetDocument', 'delete', { DocumentRefs: ref });
}

export interface TrackingStatus {
  Number: string;
  StatusCode: string;
  Status: string;
}

export async function trackWaybills(docs: { number: string; phone: string }[]): Promise<TrackingStatus[]> {
  if (!docs.length) return [];
  return callStrict<TrackingStatus>('TrackingDocument', 'getStatusDocuments', {
    Documents: docs.map((d) => ({ DocumentNumber: d.number, Phone: npPhone(d.phone) })),
  });
}

/** PDF of the waybill ("document") or a 100×100 sticker ("marking"); the API key stays on the server. */
export async function waybillPdf(number: string, kind: 'document' | 'marking'): Promise<Buffer> {
  const path = kind === 'marking' ? 'printMarking100x100' : 'printDocument';
  const url = `${PRINT}/${path}/orders[]/${encodeURIComponent(number)}/type/pdf/apiKey/${encodeURIComponent(config.novaPoshtaApiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.subarray(0, 4).toString() !== '%PDF') throw new NovaPoshtaError('Нова пошта не віддала PDF для друку');
  return buf;
}
