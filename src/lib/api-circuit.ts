/**
 * 동행복권 API 형식 변경·세션 오류 연속 시 구매 자동 중지 (서킷 브레이커)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

interface CircuitState {
  open: boolean;
  openedAt: string | null;
  reason: string | null;
  failCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}

const defaultState = (): CircuitState => ({
  open: false,
  openedAt: null,
  reason: null,
  failCount: 0,
  lastFailureAt: null,
  lastSuccessAt: null,
});

function statePath(): string {
  return resolve(config.apiCircuitStatePath);
}

async function loadState(): Promise<CircuitState> {
  try {
    const raw = await readFile(statePath(), 'utf8');
    return { ...defaultState(), ...(JSON.parse(raw) as CircuitState) };
  } catch {
    return defaultState();
  }
}

async function saveState(state: CircuitState): Promise<void> {
  const path = statePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}

export class ApiCircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiCircuitOpenError';
  }
}

/** 사이트/API 형식이 바뀐 듯한 오류 — 네트워크 일시 장애·예치금 부족·매진은 제외 */
export function isProtocolFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'SessionExpiredError' || err.name === 'ApiProtocolError') return true;

  const msg = err.message;
  if (/예치금 부족|매진|구매 진행중|구매 불가|로그인 실패|아이디|비밀번호/i.test(msg)) {
    return false;
  }

  return (
    /HTML/i.test(msg) ||
    /JSON 파싱 실패/i.test(msg) ||
    /복호화 실패/i.test(msg) ||
    /암호화 응답/i.test(msg) ||
    /el 세션 오류/i.test(msg) ||
    /RSA 키/i.test(msg) ||
    /빈 응답/i.test(msg)
  );
}

function formatOpenMessage(state: CircuitState): string {
  const opened = state.openedAt ? new Date(state.openedAt).toLocaleString('ko-KR') : '';
  const cooldownMin = Math.ceil(config.apiCircuitCooldownMs / 60_000);
  return (
    `동행복권 API 서킷 OPEN — 자동 구매 중지됨 (${opened})\n` +
    `원인: ${state.reason ?? '알 수 없음'}\n` +
    `· 사이트/API 형식 변경·세션 오류가 ${config.apiCircuitFailThreshold}회 연속 발생했을 수 있습니다.\n` +
    `· ${cooldownMin}분 후 자동 재시도 허용, 또는 npm run circuit-reset 후 login-test 로 확인하세요.`
  );
}

/** 구매 플로우 시작 전 호출 */
export async function assertBuyCircuitClosed(): Promise<void> {
  const state = await loadState();
  if (!state.open) return;

  const openedMs = state.openedAt ? Date.parse(state.openedAt) : 0;
  if (openedMs > 0 && Date.now() - openedMs >= config.apiCircuitCooldownMs) {
    state.open = false;
    state.failCount = 0;
    state.reason = null;
    await saveState(state);
    return;
  }

  throw new ApiCircuitOpenError(formatOpenMessage(state));
}

export async function recordApiSuccess(): Promise<void> {
  const state = await loadState();
  state.open = false;
  state.failCount = 0;
  state.reason = null;
  state.openedAt = null;
  state.lastSuccessAt = new Date().toISOString();
  await saveState(state);
}

export async function recordProtocolFailure(context: string, err: unknown): Promise<void> {
  if (!isProtocolFailure(err)) return;

  const state = await loadState();
  state.failCount += 1;
  state.lastFailureAt = new Date().toISOString();
  state.reason = `[${context}] ${(err as Error).message.split('\n')[0]}`;

  if (state.failCount >= config.apiCircuitFailThreshold) {
    state.open = true;
    state.openedAt = new Date().toISOString();
  }

  await saveState(state);
}

export async function getApiCircuitStatus(): Promise<CircuitState & { path: string }> {
  const state = await loadState();
  return { ...state, path: statePath() };
}

export async function resetApiCircuit(): Promise<void> {
  await saveState(defaultState());
}
