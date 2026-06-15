/**
 * 당첨 캐시 동기화 — API는 sync/settle 시에만, buy/recommend 는 draws-store 읽기 전용
 */
import type { LottoDraw } from '../types.js';
import { fetchDrawsRange, fetchLatestRoundFromApi } from './history.js';
import {
  getCacheAgeMs,
  getDrawByRound,
  getLatestDrawRound,
  loadDrawCache,
  persistDraws,
  type DrawCacheFile,
} from '../store/draws-store.js';
import { config } from '../config.js';

export type { DrawCacheFile };

export interface SyncResult {
  previousLatest: number | null;
  currentLatest: number;
  added: number;
  total: number;
  cachePath: string;
  skipped?: boolean;
  settled?: number;
}

function mergeDraws(existing: LottoDraw[], incoming: LottoDraw[]): LottoDraw[] {
  const map = new Map<number, LottoDraw>();
  for (const draw of existing) map.set(draw.round, draw);
  for (const draw of incoming) map.set(draw.round, draw);
  return [...map.values()].sort((a, b) => a.round - b.round);
}

export async function loadCache(): Promise<DrawCacheFile | null> {
  return loadDrawCache();
}

export { getCacheAgeMs };

export async function isCacheStale(): Promise<boolean> {
  const cached = await loadDrawCache();
  if (!cached) return true;
  const age = getCacheAgeMs(cached);
  if (age === null) return true;
  return age > config.cacheMaxAgeMs;
}

export async function syncCache(options: { full?: boolean } = {}): Promise<SyncResult> {
  const cached = options.full ? null : await loadDrawCache();
  const previousLatest = cached?.latestRound ?? null;

  const apiLatest = await fetchLatestRoundFromApi();

  if (!cached || options.full) {
    const draws = await fetchDrawsRange(1, apiLatest);
    const saved = await persistDraws(draws);
    const { settleAfterSync } = await import('./settle.js');
    const settled = await settleAfterSync(previousLatest, apiLatest);
    return {
      previousLatest,
      currentLatest: apiLatest,
      added: draws.length,
      total: saved.draws.length,
      cachePath: config.cachePath,
      settled,
    };
  }

  if (apiLatest <= cached.latestRound) {
    const saved = await persistDraws(cached.draws);
    return {
      previousLatest,
      currentLatest: cached.latestRound,
      added: 0,
      total: saved.draws.length,
      cachePath: config.cachePath,
      skipped: true,
    };
  }

  const newDraws = await fetchDrawsRange(cached.latestRound + 1, apiLatest);
  const merged = mergeDraws(cached.draws, newDraws);
  const saved = await persistDraws(merged);
  const { settleAfterSync } = await import('./settle.js');
  const settled = await settleAfterSync(previousLatest, apiLatest);

  return {
    previousLatest,
    currentLatest: apiLatest,
    added: newDraws.length,
    total: saved.draws.length,
    cachePath: config.cachePath,
    settled,
  };
}

export async function ensureCacheSynced(options: { force?: boolean } = {}): Promise<SyncResult | null> {
  const stale = await isCacheStale();
  if (!options.force && !stale) {
    const cached = await loadDrawCache();
    return {
      previousLatest: cached?.latestRound ?? null,
      currentLatest: cached?.latestRound ?? 0,
      added: 0,
      total: cached?.draws.length ?? 0,
      cachePath: config.cachePath,
      skipped: true,
    };
  }
  return syncCache();
}

export async function getCachedDraws(count: number): Promise<LottoDraw[]> {
  const cached = await loadDrawCache();
  if (!cached || cached.draws.length === 0) {
    throw new Error(
      '당첨 캐시가 없습니다. 먼저 `npm run sync` 를 실행해주세요.\n' +
        '  (이후 buy/recommend 는 캐시만 사용합니다)'
    );
  }

  const slice = cached.draws.slice(-count);
  if (slice.length < Math.min(count, cached.draws.length)) {
    throw new Error(`캐시에 ${count}회치 데이터가 부족합니다. npm run sync 로 캐시를 갱신해주세요.`);
  }

  return slice;
}

export async function getCachedDrawByRound(round: number): Promise<LottoDraw | undefined> {
  return getDrawByRound(round);
}

export async function getCachedLatestRound(): Promise<number> {
  const latest = await getLatestDrawRound();
  if (latest) return latest;
  return fetchLatestRoundFromApi();
}

export async function getCurrentSaleRound(): Promise<number> {
  const latest = await getLatestDrawRound();
  if (latest) return latest + 1;
  const latestDrawn = await fetchLatestRoundFromApi();
  return latestDrawn + 1;
}
