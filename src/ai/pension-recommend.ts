import { randomInt } from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../config.js';
import type { PensionTicket } from '../types.js';
import {
  analyzePensionHistory,
  buildPensionStatsSummary,
  generateStatisticalPensionPick,
} from '../pension/analyze.js';
import { getCachedPensionDraws } from '../pension/cache.js';
import { expandAllGroups, formatPensionTicket, normalizePensionDigits } from '../pension/check.js';

export interface PensionRecommendResult {
  /** AI/통계가 고른 6자리 (모든조 공통) */
  digits: string;
  /** 1~5조 동일 번호 5매 */
  tickets: PensionTicket[];
  method: 'ai' | 'statistical';
  summary: string;
}

/** 6자리 하나 → 1~5조 5매 (모든조 SA) */
export async function recommendPensionNumbers(): Promise<PensionRecommendResult> {
  const draws = await getCachedPensionDraws(config.pensionHistoryWeeks);
  if (draws.length === 0) {
    throw new Error('연금 당첨 내역을 가져올 수 없습니다.');
  }

  const stats = analyzePensionHistory(draws);
  const summary = buildPensionStatsSummary(draws, stats);
  const seed = createRecommendSeed();
  const runId = `${Date.now()}-${randomInt(100_000, 999_999)}`;

  let digits: string;
  let method: 'ai' | 'statistical';

  if (config.openaiApiKey) {
    try {
      digits = await recommendDigitsWithAI(summary, runId);
      method = 'ai';
    } catch (err) {
      console.warn('연금 AI 추천 실패, 통계 기반으로 대체:', (err as Error).message);
      digits = generateStatisticalPensionPick(stats, seed).digits;
      method = 'statistical';
    }
  } else {
    digits = generateStatisticalPensionPick(stats, seed).digits;
    method = 'statistical';
  }

  digits = normalizePensionDigits(digits);
  const tickets = expandAllGroups(digits);

  return { digits, tickets, method, summary };
}

async function recommendDigitsWithAI(summary: string, runId: string): Promise<string> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const prompt = `당신은 연금복권720+ 번호 분석 전문가입니다.
아래 통계를 참고하되, **이번 실행마다 다른** 6자리 번호 1개를 추천하세요.
(이 번호는 1조~5조 모든 조에 동일하게 구매됩니다.)

규칙:
- JSON만 출력: {"digits":"000000"}
- digits: 6자리 문자열 (앞자리 0 포함, 000000~999999)
- 실행 ID ${runId} — 이 ID와 이전 실행과 **겹치지 않는** 새 번호
- 통계 패턴만 고집하지 말고 무작위성도 섞을 것
- 설명·마크다운 없음

${summary}`;

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: 'system',
        content:
          '연금복권720+ 6자리 1개 추천. {"digits":"######"} JSON만. 호출마다 다른 번호.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 1,
    max_tokens: 80,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI 응답 파싱 실패');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { digits?: string | number };
  if (parsed.digits == null) {
    throw new Error('AI가 digits를 반환하지 않았습니다.');
  }

  return normalizePensionDigits(String(parsed.digits));
}

function createRecommendSeed(): number {
  const hr = Number(process.hrtime.bigint() & BigInt(0x7fffffff));
  return Date.now() ^ randomInt(1, 2 ** 30) ^ hr;
}

export function formatPensionTickets(tickets: PensionTicket[]): string {
  if (tickets.length === 0) return '';
  const digits = normalizePensionDigits(tickets[0].digits);
  const lines = [`  번호: ${digits} (1~5조 모든조 5매 · 5,000원)`];
  for (const t of tickets) {
    lines.push(`  · ${formatPensionTicket(t)}`);
  }
  return lines.join('\n');
}
