/** 동행복권 HTTP 호출 간 최소 간격 — IP 차단 완화 */
import { config } from '../config.js';

let lastDhlotteryApiAt = 0;
let lastPensionElApiAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 동행복권 당첨 API·www/ol 호출 전 최소 간격 유지 */
export async function throttleDhlotteryApi(): Promise<void> {
  const minGap = config.apiMinDelayMs;
  const now = Date.now();
  const wait = minGap - (now - lastDhlotteryApiAt);
  if (wait > 0) {
    await sleep(wait);
  }
  lastDhlotteryApiAt = Date.now();
}

/** el.dhlottery 연금 구매 API — 호출 간격을 더 길게 (기본 10초) */
export async function throttlePensionElApi(onWait?: (waitMs: number) => void): Promise<void> {
  const minGap = config.pensionApiMinDelayMs;
  const now = Date.now();
  const wait = minGap - (now - lastPensionElApiAt);
  if (wait > 0) {
    onWait?.(wait);
    await sleep(wait);
  }
  lastPensionElApiAt = Date.now();
}

/** makeOrderNo 직후 connPro 는 사이트처럼 즉시 호출 (주문번호 만료·진행중 잠금 방지) */
export function markPensionElApiNow(): void {
  lastPensionElApiAt = Date.now();
}
