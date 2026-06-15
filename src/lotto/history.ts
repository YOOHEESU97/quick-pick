/**
 * 동행복권 당첨 조회 (비공식 JSON API)
 * - 엔드포인트·필드명은 사이트 개편 시 바뀔 수 있음 → sync 실패 시 README 점검
 * - 호출 전 throttleDhlotteryApi() 로 간격 유지
 */
import axios from 'axios';
import { config } from '../config.js';
import { throttleDhlotteryApi } from '../lib/rate-limit.js';
import type { LottoDraw } from '../types.js';

const API_BASE = 'https://dhlottery.co.kr/lt645/selectPstLt645Info.do';

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 quick-pick/1.0',
};

export function parseDrawItem(item: Record<string, number | string>): LottoDraw {
  return {
    round: Number(item.ltEpsd),
    date: formatDate(String(item.ltRflYmd)),
    numbers: [
      item.tm1WnNo,
      item.tm2WnNo,
      item.tm3WnNo,
      item.tm4WnNo,
      item.tm5WnNo,
      item.tm6WnNo,
    ]
      .map(Number)
      .sort((a, b) => a - b),
    bonus: Number(item.bnsWnNo),
    prizes: {
      rank1: Number(item.rnk1WnAmt ?? 0),
      rank2: Number(item.rnk2WnAmt ?? 0),
      rank3: Number(item.rnk3WnAmt ?? 0),
      rank4: Number(item.rnk4WnAmt ?? 0),
      rank5: Number(item.rnk5WnAmt ?? 0),
    },
  };
}

/** 회차 범위 일괄 조회 (sync 시 1~2회 호출) */
export async function fetchDrawsRange(start: number, end: number): Promise<LottoDraw[]> {
  if (start > end) return [];

  await throttleDhlotteryApi();

  const { data } = await axios.get(API_BASE, {
    params: { srchStrLtEpsd: start, srchEndLtEpsd: end },
    headers: API_HEADERS,
    timeout: config.httpTimeoutMs,
  });

  const list = data?.data?.list ?? [];
  return list
    .map((item: Record<string, number | string>) => parseDrawItem(item))
    .sort((a: LottoDraw, b: LottoDraw) => a.round - b.round);
}

async function fetchDraw(round: number): Promise<LottoDraw | null> {
  const draws = await fetchDrawsRange(round, round);
  return draws[0] ?? null;
}

/** API 최신 당첨 회차 (날짜 추정 + 1~2회 검증) */
export async function fetchLatestRoundFromApi(): Promise<number> {
  await throttleDhlotteryApi();

  const korea = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const firstRound = new Date('2002-12-07T20:00:00+09:00');
  const weeks = Math.floor((korea.getTime() - firstRound.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const estimated = 1 + weeks;

  const draw = await fetchDraw(estimated);
  if (draw) return draw.round;

  const fallback = await fetchDraw(estimated - 1);
  return fallback?.round ?? estimated;
}

function formatDate(ymd: string): string {
  if (ymd.length !== 8) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
