/** 구매 번호 ↔ 당첨 회차 매칭 후 prize_total 저장 (sync 후 자동 호출) */
import { checkWinning } from './check.js';
import { hasDrawPrizes, prizeForRank } from './prizes.js';
import { getDrawByRound } from '../store/draws-store.js';
import {
  getUnsettledSuccessfulPurchases,
  updatePurchaseSettlement,
} from '../store/activity.js';
import type { PurchaseRecord, TicketSettlement } from '../types.js';
import type { LottoDraw } from '../types.js';

export interface SettlementOutcome {
  settlements: TicketSettlement[];
  prizeTotal: number;
  bestRank: number;
}

export function computePurchaseSettlement(
  purchase: PurchaseRecord,
  draw: LottoDraw
): SettlementOutcome | null {
  if (!hasDrawPrizes(draw)) return null;

  const settlements: TicketSettlement[] = purchase.tickets.map((ticket, gameIndex) => {
    const { rank, matched } = checkWinning(ticket, draw.numbers, draw.bonus);
    const prize = rank > 0 ? prizeForRank(draw, rank) : 0;
    return { gameIndex, rank, matched, prize };
  });

  const prizeTotal = settlements.reduce((sum, s) => sum + s.prize, 0);
  const bestRank = settlements.reduce((best, s) => (s.rank > 0 && (best === 0 || s.rank < best) ? s.rank : best), 0);

  return { settlements, prizeTotal, bestRank };
}

export async function settleRound(round: number): Promise<number> {
  const draw = await getDrawByRound(round);
  if (!draw || !hasDrawPrizes(draw)) return 0;

  const pending = (await getUnsettledSuccessfulPurchases('lotto')).filter((p) => p.round === round);
  let settled = 0;

  for (const purchase of pending) {
    const outcome = computePurchaseSettlement(purchase, draw);
    if (!outcome) continue;

    await updatePurchaseSettlement(purchase.id, {
      settledAt: new Date().toISOString(),
      prizeTotal: outcome.prizeTotal,
      bestRank: outcome.bestRank,
      settlements: outcome.settlements,
    });
    settled++;
  }

  return settled;
}

export async function settleAllUnsettled(): Promise<number> {
  const pending = await getUnsettledSuccessfulPurchases('lotto');
  let settled = 0;

  for (const purchase of pending) {
    const draw = await getDrawByRound(purchase.round);
    if (!draw || !hasDrawPrizes(draw)) continue;

    const outcome = computePurchaseSettlement(purchase, draw);
    if (!outcome) continue;

    await updatePurchaseSettlement(purchase.id, {
      settledAt: new Date().toISOString(),
      prizeTotal: outcome.prizeTotal,
      bestRank: outcome.bestRank,
      settlements: outcome.settlements,
    });
    settled++;
  }

  return settled;
}

/** sync 후 신규 추첨 회차 정산 */
export async function settleAfterSync(
  previousLatest: number | null,
  currentLatest: number
): Promise<number> {
  if (previousLatest === null) {
    return settleAllUnsettled();
  }

  let total = 0;
  for (let round = previousLatest + 1; round <= currentLatest; round++) {
    total += await settleRound(round);
  }
  return total;
}
