/** CLI 플로우: buy / sync / recommend / check / settle / schedule */
import cron from 'node-cron';
import { config, assertCredentials, getDrawsStorageLabel, getStorageLabel } from './config.js';
import { DhLotteryClient } from './client/dhlottery.js';
import { recommendNumbers, formatTickets } from './ai/recommend.js';
import {
  getCachedDrawByRound,
  getCachedLatestRound,
  getCurrentSaleRound,
  ensureCacheSynced,
  isCacheStale,
} from './lotto/cache.js';
import { checkWinning } from './lotto/check.js';
import { prizeForRank } from './lotto/prizes.js';
import { logger } from './lib/logger.js';
import {
  assertBuyCircuitClosed,
  getApiCircuitStatus,
  recordApiSuccess,
  recordProtocolFailure,
  resetApiCircuit,
} from './lib/api-circuit.js';
import { saveAccountSnapshot } from './store/account-snapshot.js';
import { appendPurchase, getFinancialSummary, getPurchases } from './store/activity.js';
import type { LottoDraw } from './types.js';

export async function runPensionBuyFlow(): Promise<void> {
  assertCredentials();
  await assertBuyCircuitClosed();
  await logger.info('연금복권 구매 플로우 시작');

  try {
    const { isPensionCacheStale, ensurePensionCacheSynced } = await import('./pension/cache.js');
    if (await isPensionCacheStale()) {
      await ensurePensionCacheSynced({ force: true });
    }

    const { recommendPensionNumbers, formatPensionTickets } = await import('./ai/pension-recommend.js');
    const { tickets, digits, method, summary } = await recommendPensionNumbers();

    console.log(`\n📊 연금 추천: ${method === 'ai' ? 'OpenAI' : '통계'} · ${digits} (1~5조 5매)`);
    console.log(formatPensionTickets(tickets));
    console.log(summary);

    const client = new DhLotteryClient({ verbose: process.env.PENSION_VERBOSE === '1' });

    async function connectElSession(): Promise<void> {
      await client.login(config.id, config.password);
      await client.bootstrapElSession();
    }

    await connectElSession();
    const balance = await client.getBalance();
    if (balance.available < 5000) {
      throw new Error(`예치금 부족 (필요: 5,000원, 보유: ${balance.available.toLocaleString()}원)`);
    }

    const { Pension720Client } = await import('./client/pension720.js');
    const pension = new Pension720Client(client.getHttpSession(), {
      verbose: process.env.PENSION_VERBOSE === '1',
      reauth: connectElSession,
    });
    await pension.bootstrap();
    const result = await pension.buyManual(tickets);

    await appendPurchase({
      product: 'pension',
      round: result.round,
      method,
      tickets: [],
      pensionTickets: result.tickets,
      ticketCount: result.tickets.length,
      amount: result.tickets.length * 1000,
      message: result.message,
      success: true,
    });

    await saveAccountSnapshot(balance, result.round, await getFinancialSummary('pension'));
    console.log(`✅ ${result.round}회차 연금 구매 완료`);
    console.log(formatPensionTickets(result.tickets));
    await recordApiSuccess();
  } catch (err) {
    await recordProtocolFailure('pension-buy', err);
    await logger.error(`연금 구매 실패: ${(err as Error).message}`);
    throw err;
  }
}

export async function runPensionRecommendFlow(): Promise<void> {
  const { recommendPensionNumbers, formatPensionTickets } = await import('./ai/pension-recommend.js');
  const { tickets, digits, method, summary } = await recommendPensionNumbers();
  console.log(`번호: ${digits} → 1~5조 5매\n`);
  console.log(formatPensionTickets(tickets));
  console.log(`\n방식: ${method}\n${summary}`);
}

/** checkVerifyNo 만 실행 — 구매 없음 (1:1 해제 후 사전 확인용) */
export async function runPensionVerifyFlow(options: { digits?: string } = {}): Promise<void> {
  assertCredentials();

  const { recommendPensionNumbers } = await import('./ai/pension-recommend.js');
  const { formatPensionTicket } = await import('./pension/check.js');
  const digits = options.digits ?? (await recommendPensionNumbers()).digits;

  const client = new DhLotteryClient({ verbose: process.env.PENSION_VERBOSE === '1' });
  await client.login(config.id, config.password);
  await client.bootstrapElSession();

  const { Pension720Client } = await import('./client/pension720.js');
  const pension = new Pension720Client(client.getHttpSession(), {
    verbose: process.env.PENSION_VERBOSE === '1',
  });
  await pension.bootstrap();

  const outcome = await pension.verifySaDigits(digits);
  console.log(outcome.available ? `✅ ${outcome.message}` : `⚠️  ${outcome.message}`);

  if (!outcome.available && outcome.alternatives.length > 0) {
    const seen = new Set<string>();
    console.log('\n서버 추천 번호:');
    for (const alt of outcome.alternatives) {
      const key = `${alt.group}-${alt.digits}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  · ${formatPensionTicket(alt)} (${alt.setType})`);
    }
  }
}

export async function runPensionSyncFlow(full = false): Promise<void> {
  const { syncPensionCache } = await import('./pension/cache.js');
  const result = await syncPensionCache({ full });
  console.log(`✅ 연금 캐시 — ${result.currentLatest}회 (총 ${result.total}회, +${result.added})`);
}

export async function runPensionSettleFlow(round?: number): Promise<void> {
  const { settlePensionRound, settleAllUnsettledPension } = await import('./pension/settle.js');
  const count = round ? await settlePensionRound(round) : await settleAllUnsettledPension();
  console.log(count ? `✅ 연금 정산 ${count}건` : 'ℹ️  정산 없음');
}

export async function runBuyFlow(): Promise<void> {
  assertCredentials();
  await assertBuyCircuitClosed();

  await logger.info('구매 플로우 시작');

  try {
    const stale = await isCacheStale();
    if (stale) {
      await logger.info('당첨 캐시 만료 — API 동기화 (최소 호출)');
      const sync = await ensureCacheSynced({ force: true });
      if (sync && sync.added > 0) {
        await logger.success(`${sync.added}회차 추가 (총 ${sync.total}회)`);
      } else if (sync) {
        await logger.info(`캐시 최신 — ${sync.currentLatest}회차 (총 ${sync.total}회)`);
      }
    } else {
      const cached = await getCachedLatestRound();
      await logger.info(`캐시 사용 (API 생략) — 최신 당첨 ${cached}회`);
    }

    await logger.info(`AI 번호 추천 중 (${config.ticketCount}게임)`);
    const { tickets, method, summary } = await recommendNumbers(config.ticketCount);
    if (tickets.length !== config.ticketCount) {
      throw new Error(`추천 게임 수 불일치: ${tickets.length}/${config.ticketCount}`);
    }
    await logger.info(`추천 완료 — ${tickets.length}게임 (${method === 'ai' ? 'OpenAI' : '통계'})`, {
      tickets,
      method,
    });

    console.log(`\n📊 추천 방식: ${method === 'ai' ? 'OpenAI AI' : '통계 기반'} · ${tickets.length}게임`);
    console.log(formatTickets(tickets));
    console.log(`💵 예상 구매액: ${(tickets.length * 1000).toLocaleString()}원`);
    console.log('\n--- 분석 요약 ---');
    console.log(summary);
    console.log('-----------------\n');

    await logger.info('동행복권 로그인 중');
    const client = new DhLotteryClient();
    await client.login(config.id, config.password);

    const balance = await client.getBalance();
    await logger.info(`구매 가능 금액: ${balance.available.toLocaleString()}원`);

    if (balance.available < config.ticketCount * 1000) {
      throw new Error(
        `예치금 부족 (필요: ${(config.ticketCount * 1000).toLocaleString()}원, 보유: ${balance.available.toLocaleString()}원)`
      );
    }

    const saleRound = await getCurrentSaleRound();
    await logger.info(`${saleRound}회차 ${tickets.length}게임 수동 구매`, {
      round: saleRound,
      games: tickets.length,
    });

    const result = await client.buyManual(tickets);

    await appendPurchase({
      product: 'lotto',
      round: result.round,
      method,
      tickets: result.tickets,
      ticketCount: result.tickets.length,
      amount: result.tickets.length * 1000,
      message: result.message,
      success: true,
    });

    const financial = await getFinancialSummary('lotto');
    const snapshot = await saveAccountSnapshot(balance, saleRound, financial);

    await logger.success(`${result.round}회차 구매 완료`, { tickets: result.tickets });

    console.log(`✅ ${result.round}회차 구매 완료!`);
    console.log(formatTickets(result.tickets));
    console.log(`\n${result.message}`);
    console.log('\n--- 대시보드 스냅샷 갱신 ---');
    console.log(`   예치금: ${snapshot.available.toLocaleString()}원`);
    console.log(`   순손익: ${snapshot.financial.netProfit.toLocaleString()}원`);
    console.log(`   진행 회차: ${snapshot.saleRound}회`);
    await recordApiSuccess();
  } catch (err) {
    const message = (err as Error).message;
    await recordProtocolFailure('buy', err);
    await logger.error(`구매 실패: ${message}`);
    throw err;
  }
}

export async function runRecommendFlow(): Promise<void> {
  await logger.info('번호 추천 시작 (캐시만 사용)');

  const { tickets, method, summary } = await recommendNumbers(config.ticketCount);
  await logger.info(`추천 완료 (${method})`, { tickets });

  console.log(`\n📊 추천 방식: ${method === 'ai' ? 'OpenAI AI' : '통계 기반'}`);
  console.log(formatTickets(tickets));
  console.log('\n--- 분석 요약 ---');
  console.log(summary);
}

export async function runCheckFlow(round?: number): Promise<void> {
  const targetRound = round ?? (await getCachedLatestRound());
  const draw = await getCachedDrawByRound(targetRound);

  if (!draw) {
    await logger.warn(`${targetRound}회 당첨 정보 없음`);
    console.log(`ℹ️  ${targetRound}회 당첨번호가 없습니다. (추첨 전이면 sync 불가, 추첨 후 npm run sync)`);
    return;
  }

  console.log(`\n🏆 ${draw.round}회 (${draw.date}) 당첨번호`);
  console.log(
    `   ${draw.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}  +보너스 ${String(draw.bonus).padStart(2, '0')}`
  );

  const mine = (await getPurchases(100, 'lotto')).filter((p) => p.success && p.round === draw.round);
  if (mine.length === 0) {
    console.log('\n📋 이 회차 구매 기록이 없습니다.');
    return;
  }

  for (const purchase of mine) {
    console.log(`\n--- 구매 (${fmtTime(purchase.createdAt)}) ---`);
    purchase.tickets.forEach((ticket, i) => {
      const { rank, matched } = checkWinning(ticket, draw.numbers, draw.bonus);
      const prize =
        purchase.settledAt && purchase.prizeTotal != null
          ? purchase.settlements?.[i]?.prize ?? (rank > 0 ? prizeForRank(draw, rank) : 0)
          : rank > 0
            ? prizeForRank(draw, rank)
            : 0;
      const label = String.fromCharCode(65 + i);
      console.log(
        `   ${label}게임 ${ticket.map((n) => String(n).padStart(2, '0')).join(' ')} → ` +
          (rank > 0 ? `${rank}등 (${matched}개) ${prize.toLocaleString()}원` : '낙첨')
      );
    });
  }

  await logger.info(`${draw.round}회 당첨 확인`, { purchases: mine.length });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export async function runSyncFlow(full = false): Promise<void> {
  await logger.info(full ? '전체 캐시 재구성 시작' : '캐시 동기화 시작');

  const { syncCache } = await import('./lotto/cache.js');
  const result = await syncCache({ full });

  if (result.added === 0) {
    await logger.info(`캐시 최신 — ${result.currentLatest}회차`);
    console.log(`✅ 이미 최신입니다 — ${result.currentLatest}회차 (총 ${result.total}회)`);
  } else if (full || result.previousLatest === null) {
    await logger.success(`전체 ${result.total}회차 저장`);
    console.log(`✅ 전체 ${result.total}회차 저장 완료 (최신: ${result.currentLatest}회)`);
  } else {
    await logger.success(`+${result.added}회차 추가 (총 ${result.total}회)`);
    console.log(
      `✅ ${result.previousLatest}회 → ${result.currentLatest}회 (+${result.added}회, 총 ${result.total}회)`
    );
  }

  if (result.settled && result.settled > 0) {
    await logger.success(`구매 정산 ${result.settled}건 반영`);
    console.log(`   💰 구매 정산: ${result.settled}건`);
  }

  console.log(`   당첨 저장: ${getDrawsStorageLabel()} · ${result.cachePath}`);
}

export async function runSettleFlow(round?: number): Promise<void> {
  const { settleRound, settleAllUnsettled } = await import('./lotto/settle.js');

  await logger.info(round ? `${round}회차 정산` : '미정산 구매 일괄 정산');
  const count = round ? await settleRound(round) : await settleAllUnsettled();

  if (count === 0) {
    await logger.info('정산할 구매 없음 (추첨 전이거나 이미 정산됨)');
    console.log('ℹ️  정산할 구매가 없습니다.');
  } else {
    await logger.success(`정산 완료 — ${count}건`, { count, round });
    console.log(`✅ 정산 완료 — ${count}건`);
  }

  const summary = await getFinancialSummary('lotto');
  console.log('\n--- 손익 요약 (정산 완료 건 기준) ---');
  console.log(`   총 구매: ${summary.totalSpent.toLocaleString()}원`);
  console.log(`   총 당첨: ${summary.totalWon.toLocaleString()}원`);
  console.log(`   순손익: ${summary.netProfit.toLocaleString()}원`);
  if (summary.pendingCount > 0) {
    console.log(`   추첨 대기: ${summary.pendingCount}건`);
  }
}

export function startScheduler(): void {
  const schedule = config.cronSchedule;
  const pensionSchedule = config.pensionCronSchedule;
  console.log(`⏰ 스케줄러 시작`);
  console.log(`   로또 cron: "${schedule}" (기본: 매주 월요일 10:00 KST)`);
  console.log(`   연금 cron: "${pensionSchedule}" (기본: 매주 수요일 10:00 KST)`);
  console.log(`   저장소: ${getStorageLabel()} · 당첨: ${getDrawsStorageLabel()}`);
  console.log('   Ctrl+C 로 종료\n');

  logger.info('스케줄러 시작', { cron: schedule, pensionCron: pensionSchedule }).catch(() => {});

  cron.schedule(
    schedule,
    () => {
      assertBuyCircuitClosed()
        .then(() => {
          logger.info('로또 자동 구매 실행').catch(() => {});
          return runBuyFlow();
        })
        .catch((err) => {
          logger.error(`로또 자동 구매 실패: ${err.message}`).catch(() => {});
          console.error('로또 구매 실패:', err.message);
        });
    },
    { timezone: 'Asia/Seoul' }
  );

  cron.schedule(
    pensionSchedule,
    () => {
      assertBuyCircuitClosed()
        .then(() => {
          logger.info('연금 자동 구매 실행').catch(() => {});
          return runPensionBuyFlow();
        })
        .catch((err) => {
          logger.error(`연금 자동 구매 실패: ${err.message}`).catch(() => {});
          console.error('연금 구매 실패:', err.message);
        });
    },
    { timezone: 'Asia/Seoul' }
  );
}
