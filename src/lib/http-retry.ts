import axios, { type AxiosError } from 'axios';

export function isRetryableError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const code = err.code;
  return (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN'
  );
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === retries) {
        throw wrapHttpError(label, err);
      }
      const wait = delayMs * attempt;
      console.warn(`⚠️ ${label} 재시도 (${attempt}/${retries}) — ${wait}ms 후`);
      await sleep(wait);
    }
  }

  throw wrapHttpError(label, lastError);
}

function wrapHttpError(label: string, err: unknown): Error {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new Error(
        `${label} 응답 시간 초과 — 동행복권 사이트가 느리거나 네트워크 문제입니다.\n` +
          `  · 브라우저에서 https://www.dhlottery.co.kr 접속되는지 확인\n` +
          `  · .env에 HTTP_TIMEOUT_MS=90000 추가 후 재시도`
      );
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      return new Error(`${label} DNS/네트워크 오류 — 인터넷 연결을 확인해주세요.`);
    }
  }
  return err instanceof Error ? err : new Error(`${label} 실패`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
