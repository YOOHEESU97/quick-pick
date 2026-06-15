/**
 * 예치금·대시보드 요약 스냅샷 — npm run buy 성공 시에만 갱신 (대시보드는 조회만)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BalanceInfo, FinancialSummary } from '../types.js';

const SNAPSHOT_PATH = resolve(process.env.ACCOUNT_SNAPSHOT_PATH ?? 'data/account-snapshot.json');

export interface AccountSnapshot {
  updatedAt: string;
  available: number;
  total: number;
  saleRound: number;
  financial: FinancialSummary;
}

async function ensureDir(): Promise<void> {
  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
}

export async function loadAccountSnapshot(): Promise<AccountSnapshot | null> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf-8');
    return JSON.parse(raw) as AccountSnapshot;
  } catch {
    return null;
  }
}

export async function saveAccountSnapshot(
  balance: BalanceInfo,
  saleRound: number,
  financial: FinancialSummary
): Promise<AccountSnapshot> {
  await ensureDir();
  const snapshot: AccountSnapshot = {
    updatedAt: new Date().toISOString(),
    available: balance.available,
    total: balance.total,
    saleRound,
    financial,
  };
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
  return snapshot;
}
