import { checkPensionWinning } from './check.js';
import { hasPensionDrawPrizes, pensionPrizeForRank } from './prizes.js';
import { getPensionDrawByRound } from '../store/pension-draws-store.js';
import {
  getUnsettledSuccessfulPurchases,
  updatePurchasePensionSettlement,
} from '../store/activity.js';
import type { PensionTicketSettlement, PurchaseRecord } from '../types.js';
import type { PensionDraw } from '../types.js';

export interface PensionSettlementOutcome {
  settlements: PensionTicketSettlement[];
  prizeTotal: number;
  bestRank: number;
}

export function computePensionPurchaseSettlement(
  purchase: PurchaseRecord,
  draw: PensionDraw
): PensionSettlementOutcome | null {
  if (!hasPensionDrawPrizes(draw) || !purchase.pensionTickets?.length) return null;

  const settlements: PensionTicketSettlement[] = purchase.pensionTickets.map((ticket, ticketIndex) => {
    const { rank, matchedDigits } = checkPensionWinning(ticket, draw);
    const prize = rank > 0 ? pensionPrizeForRank(draw, rank) : 0;
    return { ticketIndex, rank, matchedDigits, prize };
  });

  const prizeTotal = settlements.reduce((sum, s) => sum + s.prize, 0);
  const bestRank = settlements.reduce(
    (best, s) => (s.rank > 0 && (best === 0 || s.rank < best) ? s.rank : best),
    0
  );

  return { settlements, prizeTotal, bestRank };
}

export async function settlePensionRound(round: number): Promise<number> {
  const draw = await getPensionDrawByRound(round);
  if (!draw || !hasPensionDrawPrizes(draw)) return 0;

  const pending = (await getUnsettledSuccessfulPurchases('pension')).filter((p) => p.round === round);
  let settled = 0;

  for (const purchase of pending) {
    const outcome = computePensionPurchaseSettlement(purchase, draw);
    if (!outcome) continue;

    await updatePurchasePensionSettlement(purchase.id, {
      settledAt: new Date().toISOString(),
      prizeTotal: outcome.prizeTotal,
      bestRank: outcome.bestRank,
      pensionSettlements: outcome.settlements,
    });
    settled++;
  }

  return settled;
}

export async function settleAllUnsettledPension(): Promise<number> {
  const pending = await getUnsettledSuccessfulPurchases('pension');
  let settled = 0;

  for (const purchase of pending) {
    const draw = await getPensionDrawByRound(purchase.round);
    if (!draw || !hasPensionDrawPrizes(draw)) continue;

    const outcome = computePensionPurchaseSettlement(purchase, draw);
    if (!outcome) continue;

    await updatePurchasePensionSettlement(purchase.id, {
      settledAt: new Date().toISOString(),
      prizeTotal: outcome.prizeTotal,
      bestRank: outcome.bestRank,
      pensionSettlements: outcome.settlements,
    });
    settled++;
  }

  return settled;
}

export async function settlePensionAfterSync(
  previousLatest: number | null,
  currentLatest: number
): Promise<number> {
  if (previousLatest === null) {
    return settleAllUnsettledPension();
  }

  let total = 0;
  for (let round = previousLatest + 1; round <= currentLatest; round++) {
    total += await settlePensionRound(round);
  }
  return total;
}
