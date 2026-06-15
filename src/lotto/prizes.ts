import type { LottoDraw } from '../types.js';

export function prizeForRank(draw: LottoDraw, rank: number): number {
  if (!draw.prizes || rank < 1 || rank > 5) return 0;
  const amounts = [
    0,
    draw.prizes.rank1,
    draw.prizes.rank2,
    draw.prizes.rank3,
    draw.prizes.rank4,
    draw.prizes.rank5,
  ];
  return amounts[rank] ?? 0;
}

export function hasDrawPrizes(draw: LottoDraw): boolean {
  return Boolean(
    draw.prizes &&
      draw.prizes.rank5 > 0 &&
      draw.prizes.rank4 > 0
  );
}
