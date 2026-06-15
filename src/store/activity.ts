import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, useLocalWrite, useSupabaseRead, useSupabaseWrite } from '../config.js';
import type {
  ActivityLog,
  FinancialSummary,
  ProductType,
  PurchaseRecord,
  PensionTicketSettlement,
  TicketSettlement,
} from '../types.js';
import {
  supabaseAppendLog,
  supabaseAppendPurchase,
  supabaseCountPurchases,
  supabaseGetFinancialSummary,
  supabaseGetLogs,
  supabaseGetPurchases,
  supabaseGetUnsettledPurchases,
  supabaseUpdatePurchasePensionSettlement,
  supabaseUpdatePurchaseSettlement,
} from './supabase-store.js';

const MAX_LOGS = 300;
const MAX_PURCHASES = 100;

interface LogStore {
  entries: ActivityLog[];
}

interface PurchaseStore {
  entries: PurchaseRecord[];
}

async function ensureDataDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDataDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

function summarizePurchases(purchases: PurchaseRecord[], product?: ProductType): FinancialSummary {
  let totalSpent = 0;
  let totalWon = 0;
  let settledCount = 0;
  let pendingCount = 0;

  for (const p of purchases) {
    if (!p.success) continue;
    if (product && (p.product ?? 'lotto') !== product) continue;
    totalSpent += p.amount;
    if (p.settledAt) {
      settledCount++;
      totalWon += p.prizeTotal ?? 0;
    } else {
      pendingCount++;
    }
  }

  const filtered = purchases.filter(
    (p) => p.success && (!product || (p.product ?? 'lotto') === product)
  );

  return {
    totalSpent,
    totalWon,
    netProfit: totalWon - totalSpent,
    purchaseCount: filtered.length,
    settledCount,
    pendingCount,
    product,
  };
}

async function localAppendLog(
  level: ActivityLog['level'],
  message: string,
  meta?: Record<string, unknown>
): Promise<ActivityLog> {
  const store = await readJson<LogStore>(config.logsPath, { entries: [] });
  const entry: ActivityLog = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    level,
    message,
    meta,
  };

  store.entries.unshift(entry);
  store.entries = store.entries.slice(0, MAX_LOGS);
  await writeJson(config.logsPath, store);
  return entry;
}

async function localAppendPurchase(
  record: Omit<PurchaseRecord, 'createdAt'> & { id?: string }
): Promise<PurchaseRecord> {
  const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
  const entry: PurchaseRecord = {
    ...record,
    product: record.product ?? 'lotto',
    tickets: record.tickets ?? [],
    id: record.id ?? randomUUID(),
    createdAt: new Date().toISOString(),
    settledAt: record.settledAt ?? null,
    prizeTotal: record.prizeTotal ?? null,
    bestRank: record.bestRank ?? null,
    settlements: record.settlements ?? null,
    pensionSettlements: record.pensionSettlements ?? null,
  };

  store.entries.unshift(entry);
  store.entries = store.entries.slice(0, MAX_PURCHASES);
  await writeJson(config.purchasesPath, store);
  return entry;
}

async function localUpdatePurchaseSettlement(
  id: string,
  update: {
    settledAt: string;
    prizeTotal: number;
    bestRank: number;
    settlements: TicketSettlement[];
  }
): Promise<void> {
  const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
  const idx = store.entries.findIndex((p) => p.id === id);
  if (idx < 0) return;

  store.entries[idx] = {
    ...store.entries[idx],
    settledAt: update.settledAt,
    prizeTotal: update.prizeTotal,
    bestRank: update.bestRank,
    settlements: update.settlements,
  };
  await writeJson(config.purchasesPath, store);
}

function warnSupabase(err: unknown, action: string): void {
  console.warn(`⚠️ Supabase ${action} 실패 (로컬은 계속): ${(err as Error).message}`);
}

export async function appendLog(
  level: ActivityLog['level'],
  message: string,
  meta?: Record<string, unknown>
): Promise<ActivityLog> {
  let primary: ActivityLog | null = null;

  if (useSupabaseWrite()) {
    try {
      primary = await supabaseAppendLog(level, message, meta);
    } catch (err) {
      warnSupabase(err, '로그 저장');
    }
  }

  if (useLocalWrite()) {
    const local = await localAppendLog(level, message, meta);
    if (!primary) primary = local;
  }

  if (!primary) {
    throw new Error('로그를 저장할 수 없습니다. STORAGE_BACKEND 또는 Supabase 설정을 확인하세요.');
  }

  return primary;
}

export async function appendPurchase(
  record: Omit<
    PurchaseRecord,
    'id' | 'createdAt' | 'settledAt' | 'prizeTotal' | 'bestRank' | 'settlements' | 'pensionSettlements'
  >
): Promise<PurchaseRecord> {
  const id = randomUUID();
  const withDefaults = {
    ...record,
    product: record.product ?? ('lotto' as ProductType),
    tickets: record.tickets ?? [],
    id,
    settledAt: null,
    prizeTotal: null,
    bestRank: null,
    settlements: null,
    pensionSettlements: null,
  };

  let primary: PurchaseRecord | null = null;

  if (useSupabaseWrite()) {
    try {
      primary = await supabaseAppendPurchase(withDefaults);
    } catch (err) {
      warnSupabase(err, '구매 저장');
    }
  }

  if (useLocalWrite()) {
    const local = await localAppendPurchase(withDefaults);
    if (!primary) primary = local;
  }

  if (!primary) {
    throw new Error('구매 기록을 저장할 수 없습니다.');
  }

  await appendLog('success', `${record.product === 'pension' ? '연금' : '로또'} ${record.round}회차 구매 기록 저장`, {
    round: record.round,
    ticketCount: record.ticketCount,
    product: record.product ?? 'lotto',
  });

  return primary;
}

export async function updatePurchaseSettlement(
  id: string,
  update: {
    settledAt: string;
    prizeTotal: number;
    bestRank: number;
    settlements: TicketSettlement[];
  }
): Promise<void> {
  if (useSupabaseWrite()) {
    try {
      await supabaseUpdatePurchaseSettlement(id, update);
    } catch (err) {
      warnSupabase(err, '정산 저장');
      if (!useLocalWrite()) throw err;
    }
  }

  if (useLocalWrite()) {
    await localUpdatePurchaseSettlement(id, update);
  }
}

export async function updatePurchasePensionSettlement(
  id: string,
  update: {
    settledAt: string;
    prizeTotal: number;
    bestRank: number;
    pensionSettlements: PensionTicketSettlement[];
  }
): Promise<void> {
  if (useSupabaseWrite()) {
    try {
      await supabaseUpdatePurchasePensionSettlement(id, update);
    } catch (err) {
      warnSupabase(err, '연금 정산 저장');
      if (!useLocalWrite()) throw err;
    }
  }

  if (useLocalWrite()) {
    const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
    const idx = store.entries.findIndex((p) => p.id === id);
    if (idx < 0) return;
    store.entries[idx] = {
      ...store.entries[idx],
      settledAt: update.settledAt,
      prizeTotal: update.prizeTotal,
      bestRank: update.bestRank,
      pensionSettlements: update.pensionSettlements,
    };
    await writeJson(config.purchasesPath, store);
  }
}

export async function getUnsettledSuccessfulPurchases(product?: ProductType): Promise<PurchaseRecord[]> {
  const merged = new Map<string, PurchaseRecord>();

  if (useSupabaseRead()) {
    try {
      for (const p of await supabaseGetUnsettledPurchases(product)) {
        merged.set(p.id, p);
      }
    } catch (err) {
      if (config.storageBackend !== 'both') throw err;
      warnSupabase(err, '미정산 조회');
    }
  }

  if (useLocalWrite() || config.storageBackend === 'both') {
    const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
    for (const p of store.entries) {
      if (p.success && !p.settledAt && (!product || (p.product ?? 'lotto') === product)) merged.set(p.id, p);
    }
  }

  return [...merged.values()].filter((p) => !product || (p.product ?? 'lotto') === product);
}

export async function getLogs(limit = 80): Promise<ActivityLog[]> {
  if (useSupabaseRead()) {
    try {
      return await supabaseGetLogs(limit);
    } catch (err) {
      if (config.storageBackend !== 'both') throw err;
      warnSupabase(err, '로그 조회');
    }
  }

  const store = await readJson<LogStore>(config.logsPath, { entries: [] });
  return store.entries.slice(0, limit);
}

export async function getPurchases(limit = 50, product?: ProductType): Promise<PurchaseRecord[]> {
  if (useSupabaseRead()) {
    try {
      return await supabaseGetPurchases(limit, product);
    } catch (err) {
      if (config.storageBackend !== 'both') throw err;
      warnSupabase(err, '구매 조회');
    }
  }

  const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
  return store.entries
    .filter((p) => !product || (p.product ?? 'lotto') === product)
    .slice(0, limit);
}

export async function countPurchases(product?: ProductType): Promise<number> {
  if (useSupabaseRead()) {
    try {
      return await supabaseCountPurchases(product);
    } catch (err) {
      if (config.storageBackend !== 'both') throw err;
      warnSupabase(err, '구매 건수');
    }
  }

  const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
  return store.entries.filter((p) => !product || (p.product ?? 'lotto') === product).length;
}

export async function getFinancialSummary(product?: ProductType): Promise<FinancialSummary> {
  if (useSupabaseRead()) {
    try {
      return await supabaseGetFinancialSummary(product);
    } catch (err) {
      if (config.storageBackend !== 'both') throw err;
      warnSupabase(err, '손익 조회');
    }
  }

  const store = await readJson<PurchaseStore>(config.purchasesPath, { entries: [] });
  return summarizePurchases(store.entries, product);
}
