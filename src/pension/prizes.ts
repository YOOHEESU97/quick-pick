import type { PensionDraw } from '../types.js';

export function hasPensionDrawPrizes(draw: PensionDraw): boolean {
  return Boolean(draw.prizes && draw.prizes.rank1 > 0);
}

export function pensionPrizeForRank(draw: PensionDraw, rank: number): number {
  const prizes = draw.prizes;
  if (!prizes) return 0;

  switch (rank) {
    case 1:
      return prizes.rank1;
    case 2:
      return prizes.rank2;
    case 3:
      return prizes.rank3;
    case 4:
      return prizes.rank4;
    case 5:
      return prizes.rank5;
    case 6:
      return prizes.rank6;
    case 7:
      return prizes.rank7;
    case 8:
      return prizes.bonus;
    default:
      return 0;
  }
}
