import type { PensionDraw } from '../types.js';
import { fetchLatestPensionRoundFromApi, fetchPensionDrawsRange } from './history.js';
import {
  getLatestPensionDrawRound,
  getPensionCacheAgeMs,
  getPensionDrawByRound,
  loadPensionDrawCache,
  persistPensionDraws,
  type PensionDrawCacheFile,
} from '../store/pension-draws-store.js';
import { config } from '../config.js';

export type { PensionDrawCacheFile };

export interface PensionSyncResult {
  previousLatest: number | null;
  currentLatest: number;
  added: number;
  total: number;
  cachePath: string;
  skipped?: boolean;
  settled?: number;
}

function mergeDraws(existing: PensionDraw[], incoming: PensionDraw[]): PensionDraw[] {
  const map = new Map<number, PensionDraw>();
  for (const draw of existing) map.set(draw.round, draw);
  for (const draw of incoming) map.set(draw.round, draw);
  return [...map.values()].sort((a, b) => a.round - b.round);
}

export async function loadPensionCache(): Promise<PensionDrawCacheFile | null> {
  return loadPensionDrawCache();
}

export async function isPensionCacheStale(): Promise<boolean> {
  const cached = await loadPensionDrawCache();
  if (!cached) return true;
  const age = getPensionCacheAgeMs(cached);
  if (age === null) return true;
  return age > config.cacheMaxAgeMs;
}

export async function syncPensionCache(options: { full?: boolean } = {}): Promise<PensionSyncResult> {
  const cached = options.full ? null : await loadPensionDrawCache();
  const previousLatest = cached?.latestRound ?? null;
  const apiLatest = await fetchLatestPensionRoundFromApi();

  if (!cached || options.full) {
    const draws = await fetchPensionDrawsRange(1, apiLatest);
    const saved = await persistPensionDraws(draws);
    const { settlePensionAfterSync } = await import('./settle.js');
    const settled = await settlePensionAfterSync(previousLatest, apiLatest);
    return {
      previousLatest,
      currentLatest: apiLatest,
      added: draws.length,
      total: saved.draws.length,
      cachePath: config.pensionCachePath,
      settled,
    };
  }

  if (apiLatest <= cached.latestRound) {
    const saved = await persistPensionDraws(cached.draws);
    return {
      previousLatest,
      currentLatest: cached.latestRound,
      added: 0,
      total: saved.draws.length,
      cachePath: config.pensionCachePath,
      skipped: true,
    };
  }

  const newDraws = await fetchPensionDrawsRange(cached.latestRound + 1, apiLatest);
  const merged = mergeDraws(cached.draws, newDraws);
  const saved = await persistPensionDraws(merged);
  const { settlePensionAfterSync } = await import('./settle.js');
  const settled = await settlePensionAfterSync(previousLatest, apiLatest);

  return {
    previousLatest,
    currentLatest: apiLatest,
    added: newDraws.length,
    total: saved.draws.length,
    cachePath: config.pensionCachePath,
    settled,
  };
}

export async function ensurePensionCacheSynced(options: { force?: boolean } = {}): Promise<PensionSyncResult | null> {
  const stale = await isPensionCacheStale();
  if (!options.force && !stale) {
    const cached = await loadPensionDrawCache();
    return {
      previousLatest: cached?.latestRound ?? null,
      currentLatest: cached?.latestRound ?? 0,
      added: 0,
      total: cached?.draws.length ?? 0,
      cachePath: config.pensionCachePath,
      skipped: true,
    };
  }
  return syncPensionCache();
}

export async function getCachedPensionDraws(count: number): Promise<PensionDraw[]> {
  const cached = await loadPensionDrawCache();
  if (!cached || cached.draws.length === 0) {
    throw new Error('연금 당첨 캐시가 없습니다. 먼저 `npm run pension-sync` 를 실행해주세요.');
  }

  return cached.draws.slice(-count);
}

export async function getCachedPensionDrawByRound(round: number): Promise<PensionDraw | undefined> {
  return getPensionDrawByRound(round);
}

export async function getCachedPensionLatestRound(): Promise<number> {
  const latest = await getLatestPensionDrawRound();
  if (latest) return latest;
  return fetchLatestPensionRoundFromApi();
}

export async function getCurrentPensionSaleRound(): Promise<number> {
  const latest = await getLatestPensionDrawRound();
  if (latest) return latest + 1;
  return (await fetchLatestPensionRoundFromApi()) + 1;
}
