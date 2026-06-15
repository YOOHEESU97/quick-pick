import type { PensionDraw } from '../types.js';

export interface PensionStats {
  groupFrequency: Record<number, number>;
  digitFrequency: Record<number, number[]>;
  recentHotGroups: number[];
  recentHotDigits: string[];
}

export function analyzePensionHistory(draws: PensionDraw[]): PensionStats {
  const groupFrequency: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const digitFrequency: Record<number, number[]> = {};
  for (let pos = 0; pos < 6; pos++) {
    digitFrequency[pos] = Array.from({ length: 10 }, () => 0);
  }

  for (const draw of draws) {
    groupFrequency[draw.firstGroup] = (groupFrequency[draw.firstGroup] ?? 0) + 1;
    const digits = draw.firstNumber.padStart(6, '0');
    for (let pos = 0; pos < 6; pos++) {
      const d = Number(digits[pos]);
      digitFrequency[pos][d]++;
    }
  }

  const recent = draws.slice(-10);
  const recentHotGroups = [...new Set(recent.map((d) => d.firstGroup))];
  const recentHotDigits = recent.map((d) => d.firstNumber.padStart(6, '0'));

  return { groupFrequency, digitFrequency, recentHotGroups, recentHotDigits };
}

export function buildPensionStatsSummary(draws: PensionDraw[], stats: PensionStats): string {
  const latest = draws.at(-1);
  const groupLines = [1, 2, 3, 4, 5]
    .map((g) => `${g}조 ${stats.groupFrequency[g] ?? 0}회`)
    .join(', ');

  return [
    `최근 ${draws.length}회 연금복권720+ 분석`,
    latest ? `최신 ${latest.round}회: ${latest.firstGroup}조 ${latest.firstNumber}` : '',
    `조별 1등 빈도: ${groupLines}`,
    `최근 10회 1등 조: ${stats.recentHotGroups.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function validatePensionTicket(group: number, digits: string): void {
  if (group < 1 || group > 5) {
    throw new Error(`조는 1~5 사이여야 합니다: ${group}`);
  }
  if (!/^\d{6}$/.test(digits)) {
    throw new Error(`6자리 숫자여야 합니다: ${digits}`);
  }
}

export function generateStatisticalPensionPick(stats: PensionStats, seed: number): { group: number; digits: string } {
  const groups = [1, 2, 3, 4, 5];
  const weights = groups.map((g) => stats.groupFrequency[g] + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = seed % total;
  let group = 1;
  for (let i = 0; i < groups.length; i++) {
    pick -= weights[i];
    if (pick < 0) {
      group = groups[i];
      break;
    }
  }

  let digits = '';
  for (let pos = 0; pos < 6; pos++) {
    const freq = stats.digitFrequency[pos];
    const w = freq.map((c) => c + 1);
    const sum = w.reduce((a, b) => a + b, 0);
    let r = (seed * (pos + 11)) % sum;
    let digit = 0;
    for (let d = 0; d < 10; d++) {
      r -= w[d];
      if (r < 0) {
        digit = d;
        break;
      }
    }
    digits += String(digit);
  }

  return { group, digits };
}
