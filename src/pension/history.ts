import axios from 'axios';
import { config } from '../config.js';
import { throttleDhlotteryApi } from '../lib/rate-limit.js';
import type { PensionDraw, PensionDrawPrizes } from '../types.js';

const API_BASE = 'https://www.dhlottery.co.kr/pt720/selectPstPt720Info.do';

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 quick-pick/1.0',
};

function formatDate(ymd: string): string {
  if (ymd.length !== 8) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function padDigits(value: string): string {
  return value.padStart(6, '0');
}

export function parsePensionDrawRows(rows: Record<string, number | string | null>[]): PensionDraw | null {
  if (rows.length === 0) return null;

  const round = Number(rows[0].psltEpsd);
  const date = formatDate(String(rows[0].psltRflYmd));

  const prizes: PensionDrawPrizes = {
    rank1: 0,
    rank2: 0,
    rank3: 0,
    rank4: 0,
    rank5: 0,
    rank6: 0,
    rank7: 0,
    bonus: 0,
  };

  let firstGroup = 0;
  let firstNumber = '';
  let bonusNumber: string | undefined;

  for (const row of rows) {
    const sq = Number(row.wnSqNo);
    const amt = Number(row.wnAmt ?? 0);
    const digits = padDigits(String(row.wnRnkVl ?? ''));

    if (sq === 1) {
      firstGroup = Number(row.wnBndNo ?? 0);
      firstNumber = digits;
      prizes.rank1 = amt;
    } else if (sq === 2) prizes.rank2 = amt;
    else if (sq === 3) prizes.rank3 = amt;
    else if (sq === 4) prizes.rank4 = amt;
    else if (sq === 5) prizes.rank5 = amt;
    else if (sq === 6) prizes.rank6 = amt;
    else if (sq === 7) prizes.rank7 = amt;
    else if (sq === 21) {
      bonusNumber = digits;
      prizes.bonus = amt;
    }
  }

  if (!firstGroup || !firstNumber) return null;

  return {
    round,
    date,
    firstGroup,
    firstNumber,
    bonusNumber,
    prizes,
  };
}

export async function fetchPensionDrawsRange(start: number, end: number): Promise<PensionDraw[]> {
  if (start > end) return [];

  await throttleDhlotteryApi();

  const { data } = await axios.get(API_BASE, {
    params: { srchStrLtEpsd: start, srchEndLtEpsd: end },
    headers: API_HEADERS,
    timeout: config.httpTimeoutMs,
  });

  const list: Record<string, number | string | null>[] = data?.data?.result ?? [];
  const byRound = new Map<number, Record<string, number | string | null>[]>();

  for (const item of list) {
    const round = Number(item.psltEpsd);
    const bucket = byRound.get(round) ?? [];
    bucket.push(item);
    byRound.set(round, bucket);
  }

  return [...byRound.values()]
    .map((rows) => parsePensionDrawRows(rows))
    .filter((draw): draw is PensionDraw => draw !== null)
    .sort((a, b) => a.round - b.round);
}

export async function fetchLatestPensionRoundFromApi(): Promise<number> {
  await throttleDhlotteryApi();

  const korea = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const firstRound = new Date('2014-06-05T20:00:00+09:00');
  const weeks = Math.floor((korea.getTime() - firstRound.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const estimated = 1 + weeks;

  const draws = await fetchPensionDrawsRange(estimated, estimated);
  if (draws[0]) return draws[0].round;

  const fallback = await fetchPensionDrawsRange(estimated - 1, estimated - 1);
  return fallback[0]?.round ?? estimated;
}
