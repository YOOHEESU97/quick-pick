import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** 당첨 회차 저장 — Supabase lotto_draws + 선택적 data/draws.json (DRAWS_STORAGE) */
import {
  config,
  useDrawsLocalWrite,
  useDrawsSupabaseRead,
  useDrawsSupabaseWrite,
} from '../config.js';
import type { LottoDraw } from '../types.js';
import {
  supabaseGetDrawByRound,
  supabaseGetLatestRound,
  supabaseLoadAllDraws,
  supabaseUpsertDraws,
} from './supabase-draws.js';

export interface DrawCacheFile {
  updatedAt: string;
  latestRound: number;
  draws: LottoDraw[];
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(dirname(config.cachePath), { recursive: true });
}

async function loadLocalDrawCache(): Promise<DrawCacheFile | null> {
  try {
    const raw = await readFile(config.cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as DrawCacheFile;
    if (!Array.isArray(parsed.draws)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveLocalDrawCache(draws: LottoDraw[]): Promise<DrawCacheFile> {
  await ensureCacheDir();
  const sorted = [...draws].sort((a, b) => a.round - b.round);
  const payload: DrawCacheFile = {
    updatedAt: new Date().toISOString(),
    latestRound: sorted.at(-1)?.round ?? 0,
    draws: sorted,
  };
  await writeFile(config.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

function warnDrawsSupabase(err: unknown, action: string): void {
  console.warn(`⚠️ Supabase 당첨 ${action} 실패: ${(err as Error).message}`);
}

export async function loadDrawCache(): Promise<DrawCacheFile | null> {
  if (useDrawsSupabaseRead()) {
    try {
      const draws = await supabaseLoadAllDraws();
      if (draws.length > 0) {
        return {
          updatedAt: new Date().toISOString(),
          latestRound: draws.at(-1)!.round,
          draws,
        };
      }
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnDrawsSupabase(err, '조회');
    }
  }

  return loadLocalDrawCache();
}

export async function persistDraws(draws: LottoDraw[]): Promise<DrawCacheFile> {
  let saved: DrawCacheFile | null = null;

  if (useDrawsSupabaseWrite()) {
    try {
      await supabaseUpsertDraws(draws);
      const sorted = [...draws].sort((a, b) => a.round - b.round);
      saved = {
        updatedAt: new Date().toISOString(),
        latestRound: sorted.at(-1)?.round ?? 0,
        draws: sorted,
      };
    } catch (err) {
      warnDrawsSupabase(err, '저장');
      if (config.drawsStorage === 'supabase') throw err;
    }
  }

  if (useDrawsLocalWrite()) {
    saved = await saveLocalDrawCache(draws);
  }

  if (!saved) {
    throw new Error('당첨 데이터를 저장할 수 없습니다. DRAWS_STORAGE 설정을 확인하세요.');
  }

  return saved;
}

export async function getDrawByRound(round: number): Promise<LottoDraw | undefined> {
  if (useDrawsSupabaseRead()) {
    try {
      const draw = await supabaseGetDrawByRound(round);
      if (draw) return draw;
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnDrawsSupabase(err, '회차 조회');
    }
  }

  const local = await loadLocalDrawCache();
  return local?.draws.find((d) => d.round === round);
}

export async function getLatestDrawRound(): Promise<number | null> {
  if (useDrawsSupabaseRead()) {
    try {
      const latest = await supabaseGetLatestRound();
      if (latest !== null) return latest;
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnDrawsSupabase(err, '최신 회차');
    }
  }

  const local = await loadLocalDrawCache();
  return local?.latestRound ?? null;
}

export function getCacheAgeMs(cached: DrawCacheFile | null): number | null {
  if (!cached?.updatedAt) return null;
  return Date.now() - new Date(cached.updatedAt).getTime();
}
