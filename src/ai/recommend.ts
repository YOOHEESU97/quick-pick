import OpenAI from 'openai';
import { config } from '../config.js';
import type { LottoDraw, LottoStats } from '../types.js';
import {
  analyzeHistory,
  buildStatsSummary,
  generateStatisticalPick,
  validateNumbers,
} from '../lotto/analyze.js';
import { getCachedDraws } from '../lotto/cache.js';

export interface RecommendResult {
  tickets: number[][];
  method: 'ai' | 'statistical';
  summary: string;
}

export async function recommendNumbers(ticketCount: number): Promise<RecommendResult> {
  const draws = await getCachedDraws(config.historyWeeks);
  if (draws.length === 0) {
    throw new Error('당첨 내역을 가져올 수 없습니다.');
  }

  const stats = analyzeHistory(draws);
  const summary = buildStatsSummary(draws, stats);

  if (config.openaiApiKey) {
    try {
      const tickets = await recommendWithAI(draws, stats, summary, ticketCount);
      return { tickets, method: 'ai', summary };
    } catch (err) {
      console.warn('AI 추천 실패, 통계 기반으로 대체합니다:', (err as Error).message);
    }
  }

  const tickets = generateDistinctStatisticalPicks(stats, ticketCount);
  return { tickets, method: 'statistical', summary };
}

async function recommendWithAI(
  draws: LottoDraw[],
  stats: LottoStats,
  summary: string,
  ticketCount: number
): Promise<number[][]> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const gameLabels = Array.from({ length: ticketCount }, (_, i) =>
    String.fromCharCode(65 + i)
  ).join(', ');

  const prompt = `당신은 로또 6/45 번호 분석 전문가입니다.
아래 통계를 바탕으로 **정확히 ${ticketCount}게임** (${gameLabels}) 수동 구매 번호를 추천하세요.

규칙:
- 반드시 길이 ${ticketCount}인 JSON 배열만 출력: [[...6개...], ...] 
- 각 게임: 1~45 서로 다른 정수 6개 (오름차순 권장)
- **게임끼리 번호 조합이 서로 달라야 함** (동일 조합 금지)
- 설명·마크다운 없이 JSON만

${summary}`;

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: 'system',
        content: `로또 6/45 추천. 응답은 길이 ${ticketCount}의 JSON 배열만. 각 원소는 서로 다른 1~45 정수 6개.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.85,
    max_tokens: ticketCount <= 2 ? 400 : ticketCount <= 3 ? 600 : 900,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('AI 응답 파싱 실패');
  }

  const tickets = JSON.parse(jsonMatch[0]) as number[][];
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new Error('AI가 유효한 번호를 반환하지 않았습니다.');
  }

  const validTickets: number[][] = [];
  const seen = new Set<string>();

  for (const raw of tickets) {
    if (validTickets.length >= ticketCount) break;
    validateNumbers(raw);
    const sorted = [...raw].sort((a, b) => a - b);
    const key = sorted.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    validTickets.push(sorted);
  }

  if (validTickets.length < ticketCount) {
    for (const extra of generateDistinctStatisticalPicks(
      stats,
      ticketCount - validTickets.length,
      seen
    )) {
      validTickets.push(extra);
    }
  }

  assertDistinctTickets(validTickets, ticketCount);
  return validTickets.slice(0, ticketCount);
}

function ticketKey(numbers: number[]): string {
  return [...numbers].sort((a, b) => a - b).join(',');
}

function assertDistinctTickets(tickets: number[][], expected: number): void {
  if (tickets.length !== expected) {
    throw new Error(`${expected}게임이 필요한데 ${tickets.length}게임만 준비되었습니다.`);
  }
  const keys = new Set(tickets.map(ticketKey));
  if (keys.size !== expected) {
    throw new Error('게임마다 서로 다른 번호 조합이어야 합니다.');
  }
}

/** 통계 기반 N게임 — 조합 중복 없음 */
export function generateDistinctStatisticalPicks(
  stats: LottoStats,
  count: number,
  exclude: Set<string> = new Set()
): number[][] {
  const picks: number[][] = [];
  const seen = new Set(exclude);
  let attempt = 0;
  const maxAttempts = count * 80;

  while (picks.length < count && attempt < maxAttempts) {
    const ticket = generateStatisticalPick(stats, Date.now() + attempt * 9973);
    const key = ticketKey(ticket);
    attempt++;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(ticket);
  }

  if (picks.length < count) {
    throw new Error(`${count}게임의 서로 다른 번호를 만들지 못했습니다.`);
  }

  return picks;
}

export function formatTickets(tickets: number[][]): string {
  return tickets
    .map((t, i) => `  ${String.fromCharCode(65 + i)}게임: ${t.map((n) => String(n).padStart(2, '0')).join(' ')}`)
    .join('\n');
}
