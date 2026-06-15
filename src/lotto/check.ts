export function checkWinning(
  ticket: number[],
  winning: number[],
  bonus: number
): { rank: number; matched: number; matchedNumbers: number[] } {
  const matchedNumbers = ticket.filter((n) => winning.includes(n));
  const matched = matchedNumbers.length;
  const hasBonus = ticket.includes(bonus);

  let rank = 0;
  if (matched === 6) rank = 1;
  else if (matched === 5 && hasBonus) rank = 2;
  else if (matched === 5) rank = 3;
  else if (matched === 4) rank = 4;
  else if (matched === 3) rank = 5;

  return { rank, matched, matchedNumbers };
}
