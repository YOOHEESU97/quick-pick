import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  config,
  useDrawsLocalWrite,
  useDrawsSupabaseRead,
  useDrawsSupabaseWrite,
} from '../config.js';
import type { PensionDraw } from '../types.js';
import {
  supabaseGetPensionDrawByRound,
  supabaseGetLatestPensionRound,
  supabaseLoadAllPensionDraws,
  supabaseUpsertPensionDraws,
} from './supabase-pension-draws.js';

export interface PensionDrawCacheFile {
  updatedAt: string;
  latestRound: number;
  draws: PensionDraw[];
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(dirname(config.pensionCachePath), { recursive: true });
}

async function loadLocalPensionCache(): Promise<PensionDrawCacheFile | null> {
  try {
    const raw = await readFile(config.pensionCachePath, 'utf-8');
    const parsed = JSON.parse(raw) as PensionDrawCacheFile;
    if (!Array.isArray(parsed.draws)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveLocalPensionCache(draws: PensionDraw[]): Promise<PensionDrawCacheFile> {
  await ensureCacheDir();
  const sorted = [...draws].sort((a, b) => a.round - b.round);
  const payload: PensionDrawCacheFile = {
    updatedAt: new Date().toISOString(),
    latestRound: sorted.at(-1)?.round ?? 0,
    draws: sorted,
  };
  await writeFile(config.pensionCachePath, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

function warnSupabase(err: unknown, action: string): void {
  console.warn(`⚠️ Supabase 연금 당첨 ${action} 실패: ${(err as Error).message}`);
}

export async function loadPensionDrawCache(): Promise<PensionDrawCacheFile | null> {
  if (useDrawsSupabaseRead()) {
    try {
      const draws = await supabaseLoadAllPensionDraws();
      if (draws.length > 0) {
        return {
          updatedAt: new Date().toISOString(),
          latestRound: draws.at(-1)!.round,
          draws,
        };
      }
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnSupabase(err, '조회');
    }
  }

  return loadLocalPensionCache();
}

export async function persistPensionDraws(draws: PensionDraw[]): Promise<PensionDrawCacheFile> {
  let saved: PensionDrawCacheFile | null = null;

  if (useDrawsSupabaseWrite()) {
    try {
      await supabaseUpsertPensionDraws(draws);
      const sorted = [...draws].sort((a, b) => a.round - b.round);
      saved = {
        updatedAt: new Date().toISOString(),
        latestRound: sorted.at(-1)?.round ?? 0,
        draws: sorted,
      };
    } catch (err) {
      warnSupabase(err, '저장');
      if (config.drawsStorage === 'supabase') throw err;
    }
  }

  if (useDrawsLocalWrite()) {
    saved = await saveLocalPensionCache(draws);
  }

  if (!saved) {
    throw new Error('연금 당첨 데이터를 저장할 수 없습니다.');
  }

  return saved;
}

export async function getPensionDrawByRound(round: number): Promise<PensionDraw | undefined> {
  if (useDrawsSupabaseRead()) {
    try {
      const draw = await supabaseGetPensionDrawByRound(round);
      if (draw) return draw;
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnSupabase(err, '회차 조회');
    }
  }

  const local = await loadLocalPensionCache();
  return local?.draws.find((d) => d.round === round);
}

export async function getLatestPensionDrawRound(): Promise<number | null> {
  if (useDrawsSupabaseRead()) {
    try {
      const latest = await supabaseGetLatestPensionRound();
      if (latest !== null) return latest;
    } catch (err) {
      if (config.drawsStorage !== 'both') throw err;
      warnSupabase(err, '최신 회차');
    }
  }

  const local = await loadLocalPensionCache();
  return local?.latestRound ?? null;
}

export function getPensionCacheAgeMs(cached: PensionDrawCacheFile | null): number | null {
  if (!cached?.updatedAt) return null;
  return Date.now() - new Date(cached.updatedAt).getTime();
}
