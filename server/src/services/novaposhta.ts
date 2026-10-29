import { config } from '../config.js';

const API = 'https://api.novaposhta.ua/v2.0/json/';

async function call<T>(modelName: string, calledMethod: string, methodProperties: Record<string, unknown>): Promise<T[]> {
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
