import type { LottoDraw, LottoStats } from '../types.js';

export function analyzeHistory(draws: LottoDraw[]): LottoStats {
  const frequency: Record<number, number> = {};
  const lastSeen: Record<number, number> = {};
  const latestRound = draws.at(-1)?.round ?? 0;

  for (let n = 1; n <= 45; n++) {
    frequency[n] = 0;
    lastSeen[n] = latestRound;
  }

  for (const draw of draws) {
    for (const num of [...draw.numbers, draw.bonus]) {
      frequency[num] = (frequency[num] ?? 0) + 1;
    }
    for (let n = 1; n <= 45; n++) {
      if (draw.numbers.includes(n) || draw.bonus === n) {
        lastSeen[n] = draw.round;
      }
    }
  }

  const overdue: Record<number, number> = {};
  for (let n = 1; n <= 45; n++) {
    overdue[n] = latestRound - lastSeen[n];
  }

  const recent = draws.slice(-10);
  const recentFreq: Record<number, number> = {};
  for (const draw of recent) {
    for (const num of draw.numbers) {
      recentFreq[num] = (recentFreq[num] ?? 0) + 1;
    }
  }

  const sortedByRecent = Object.entries(recentFreq)
    .sort(([, a], [, b]) => b - a)
    .map(([n]) => Number(n));

  const recentHot = sortedByRecent.slice(0, 10);
  const recentCold = Object.entries(overdue)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([n]) => Number(n));

  let odd = 0;
  let even = 0;
  const sums: number[] = [];

  for (const draw of draws) {
    for (const num of draw.numbers) {
      if (num % 2 === 0) even++;
      else odd++;
    }
    sums.push(draw.numbers.reduce((a, b) => a + b, 0));
  }

  return {
    frequency,
    overdue,
    recentHot,
    recentCold,
    oddEvenRatio: { odd, even },
    sumRange: {
      min: Math.min(...sums),
      max: Math.max(...sums),
      avg: Math.round(sums.reduce((a, b) => a + b, 0) / sums.length),
    },
  };
}

export function buildStatsSummary(draws: LottoDraw[], stats: LottoStats): string {
  const latest = draws.at(-1);
  const topFreq = Object.entries(stats.frequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([n, c]) => `${n}번(${c}회)`)
    .join(', ');

  const topOverdue = Object.entries(stats.overdue)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([n, w]) => `${n}번(${w}회 미출)`)
    .join(', ');

  const recentLines = draws
    .slice(-5)
    .map((d) => `${d.round}회(${d.date}): ${d.numbers.join(', ')} +보너스 ${d.bonus}`)
    .join('\n');

  return [
    `최신 회차: ${latest?.round}회 (${latest?.date})`,
    `분석 기간: 최근 ${draws.length}회`,
    `번호별 출현 빈도 TOP: ${topFreq}`,
    `미출현(오버듀) TOP: ${topOverdue}`,
    `최근 10회 핫넘버: ${stats.recentHot.join(', ')}`,
    `최근 10회 콜드넘버: ${stats.recentCold.join(', ')}`,
    `홀짝 비율: ${stats.oddEvenRatio.odd}:${stats.oddEvenRatio.even}`,
    `번호합 범위: ${stats.sumRange.min}~${stats.sumRange.max} (평균 ${stats.sumRange.avg})`,
    '',
    '최근 5회 당첨번호:',
    recentLines,
  ].join('\n');
}

export function generateStatisticalPick(stats: LottoStats, seed?: number): number[] {
  const rng = seededRandom(seed ?? Date.now());

  const weights: { num: number; weight: number }[] = [];
  for (let n = 1; n <= 45; n++) {
    const freqScore = stats.frequency[n] ?? 0;
    const overdueScore = stats.overdue[n] ?? 0;
    const hotBonus = stats.recentHot.includes(n) ? 3 : 0;
    const coldBonus = stats.recentCold.includes(n) ? 2 : 0;

    weights.push({
      num: n,
      weight: freqScore * 0.3 + overdueScore * 0.4 + hotBonus + coldBonus + rng() * 5,
    });
  }

  weights.sort((a, b) => b.weight - a.weight);

  const picked: number[] = [];
  for (const { num } of weights) {
    if (picked.length >= 6) break;
    if (!picked.includes(num)) picked.push(num);
  }

  return picked.sort((a, b) => a - b);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function validateNumbers(numbers: number[]): void {
  if (numbers.length !== 6) {
    throw new Error('로또 번호는 6개여야 합니다.');
  }
  const unique = new Set(numbers);
  if (unique.size !== 6) {
    throw new Error('중복된 번호가 있습니다.');
  }
  for (const n of numbers) {
    if (n < 1 || n > 45 || !Number.isInteger(n)) {
      throw new Error(`유효하지 않은 번호: ${n} (1~45 정수)`);
    }
  }
}
