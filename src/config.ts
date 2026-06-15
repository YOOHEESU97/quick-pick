/**
 * 환경 변수 (.env) — 비밀번호·service_role 키는 Git에 올리지 말 것
 */
import 'dotenv/config';
import { resolve } from 'node:path';

/** auto: Supabase URL+키 있으면 클라우드, 없으면 data/*.json */
export type StorageBackend = 'auto' | 'local' | 'supabase' | 'both';

export const config = {
  id: (process.env.DHLOTTERY_ID ?? '').trim(),
  password: (process.env.DHLOTTERY_PASSWORD ?? '').trim(),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  ticketCount: Math.min(5, Math.max(1, Number(process.env.TICKET_COUNT ?? 1))),
  historyWeeks: Math.min(200, Math.max(10, Number(process.env.HISTORY_WEEKS ?? 52))),
  pensionHistoryWeeks: Math.min(100, Math.max(10, Number(process.env.PENSION_HISTORY_WEEKS ?? 52))),
  cronSchedule: process.env.CRON_SCHEDULE ?? '0 10 * * 1',
  pensionCronSchedule: process.env.PENSION_CRON_SCHEDULE ?? '0 10 * * 3',
  cachePath: resolve(process.env.CACHE_PATH ?? 'data/draws.json'),
  pensionCachePath: resolve(process.env.PENSION_CACHE_PATH ?? 'data/pension-draws.json'),
  logsPath: resolve(process.env.LOGS_PATH ?? 'data/logs.json'),
  purchasesPath: resolve(process.env.PURCHASES_PATH ?? 'data/purchases.json'),
  dashboardPort: Number(process.env.DASHBOARD_PORT ?? 3847),
  dashboardHost: process.env.DASHBOARD_HOST ?? '127.0.0.1',
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 90_000),
  httpRetryCount: Math.min(5, Math.max(1, Number(process.env.HTTP_RETRY_COUNT ?? 2))),
  /** 동행복권 당첨 API·www/ol 호출 간 최소 대기(ms) */
  apiMinDelayMs: Number(process.env.API_MIN_DELAY_MS ?? 2000),
  /** el.dhlottery 연금 구매 API 호출 간 최소 대기(ms) — 기본 10초 */
  pensionApiMinDelayMs: Number(process.env.PENSION_API_MIN_DELAY_MS ?? 10_000),
  /** connPro '구매 진행중' 오류 시 재시도 전 대기(ms) */
  pensionPendingRetryWaitMs: Number(process.env.PENSION_PENDING_RETRY_WAIT_MS ?? 60_000),
  /** 매진 번호 재확인 최대 횟수 (checkVerifyNo) */
  pensionVerifyMaxAttempts: Math.min(10, Math.max(1, Number(process.env.PENSION_VERIFY_MAX_ATTEMPTS ?? 5))),
  /** API 형식 오류 N회 연속 시 구매 중지 */
  apiCircuitFailThreshold: Math.min(10, Math.max(1, Number(process.env.API_CIRCUIT_FAIL_THRESHOLD ?? 3))),
  /** 서킷 OPEN 후 구매 재허용 대기(ms) — 기본 1시간 */
  apiCircuitCooldownMs: Number(process.env.API_CIRCUIT_COOLDOWN_MS ?? 3_600_000),
  apiCircuitStatePath: resolve(process.env.API_CIRCUIT_STATE_PATH ?? 'data/api-circuit.json'),
  /** 이 시간 이내 sync 했으면 buy/recommend 시 API 재조회 안 함 */
  cacheMaxAgeMs: Number(process.env.CACHE_MAX_AGE_HOURS ?? 12) * 60 * 60 * 1000,
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim(),
  supabaseServiceKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
  storageBackend: parseStorageBackend(process.env.STORAGE_BACKEND),
  drawsStorage: parseDrawsStorage(process.env.DRAWS_STORAGE),
};

function parseDrawsStorage(value: string | undefined): StorageBackend {
  const raw = (value ?? 'auto').toLowerCase();
  if (raw === 'local' || raw === 'supabase' || raw === 'both' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

function parseStorageBackend(value: string | undefined): StorageBackend {
  const raw = (value ?? 'auto').toLowerCase();
  if (raw === 'local' || raw === 'supabase' || raw === 'both' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

/** Supabase에 쓰기 */
export function useSupabaseWrite(): boolean {
  if (config.storageBackend === 'local') return false;
  if (config.storageBackend === 'supabase' || config.storageBackend === 'both') {
    return isSupabaseConfigured();
  }
  return isSupabaseConfigured();
}

/** Supabase에서 읽기 (both면 Supabase 우선) */
export function useSupabaseRead(): boolean {
  if (config.storageBackend === 'local') return false;
  if (config.storageBackend === 'supabase' || config.storageBackend === 'both') {
    return isSupabaseConfigured();
  }
  return isSupabaseConfigured();
}

export function useLocalWrite(): boolean {
  return config.storageBackend === 'local' || config.storageBackend === 'both' || !useSupabaseWrite();
}

export function getStorageLabel(): string {
  if (config.storageBackend === 'both' && isSupabaseConfigured()) return 'local+supabase';
  if (useSupabaseRead()) return 'supabase';
  return 'local';
}

export function useDrawsSupabaseWrite(): boolean {
  if (config.drawsStorage === 'local') return false;
  if (config.drawsStorage === 'supabase' || config.drawsStorage === 'both') {
    return isSupabaseConfigured();
  }
  return isSupabaseConfigured();
}

export function useDrawsSupabaseRead(): boolean {
  if (config.drawsStorage === 'local') return false;
  if (config.drawsStorage === 'supabase' || config.drawsStorage === 'both') {
    return isSupabaseConfigured();
  }
  return isSupabaseConfigured();
}

export function useDrawsLocalWrite(): boolean {
  return (
    config.drawsStorage === 'local' ||
    config.drawsStorage === 'both' ||
    !useDrawsSupabaseWrite()
  );
}

export function getDrawsStorageLabel(): string {
  if (config.drawsStorage === 'both' && isSupabaseConfigured()) return 'local+supabase';
  if (useDrawsSupabaseRead()) return 'supabase';
  return 'local';
}

export function assertCredentials(): void {
  if (!config.id || !config.password) {
    throw new Error(
      'DHLOTTERY_ID, DHLOTTERY_PASSWORD 환경변수를 .env에 설정해주세요.\n' +
        '  cp .env.example .env'
    );
  }
}
