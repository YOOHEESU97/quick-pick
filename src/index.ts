#!/usr/bin/env node
import { Command } from 'commander';
import {
  runBuyFlow,
  runRecommendFlow,
  runCheckFlow,
  runSyncFlow,
  runSettleFlow,
  runPensionBuyFlow,
  runPensionRecommendFlow,
  runPensionVerifyFlow,
  runPensionSyncFlow,
  runPensionSettleFlow,
  startScheduler,
} from './scheduler.js';
import { startDashboard } from './server/dashboard.js';
import { DhLotteryClient } from './client/dhlottery.js';
import { assertCredentials, config } from './config.js';
import { getApiCircuitStatus, resetApiCircuit } from './lib/api-circuit.js';
import { logger } from './lib/logger.js';

const program = new Command();

program
  .name('quick-pick')
  .description('동행복권 로또 AI 번호 추천 + 주간 자동 수동구매')
  .version('1.0.0');

program
  .command('circuit-status')
  .description('동행복권 API 서킷 브레이커 상태 (구매 자동 중지 여부)')
  .action(async () => {
    const s = await getApiCircuitStatus();
    console.log(s.open ? '🔴 OPEN (구매 중지)' : '🟢 CLOSED (정상)');
    console.log(`  실패 누적: ${s.failCount}회`);
    if (s.reason) console.log(`  마지막 원인: ${s.reason}`);
    if (s.openedAt) console.log(`  중지 시각: ${s.openedAt}`);
    if (s.lastSuccessAt) console.log(`  마지막 성공: ${s.lastSuccessAt}`);
    console.log(`  상태 파일: ${s.path}`);
  });

program
  .command('circuit-reset')
  .description('API 서킷 브레이커 수동 해제 (login-test 확인 후)')
  .action(async () => {
    await resetApiCircuit();
    console.log('✅ 서킷 CLOSED — buy / pension-buy 재시도 가능');
  });

program
  .command('login-test')
  .description('동행복권 로그인만 테스트 (구매 없음)')
  .action(async () => {
    try {
      assertCredentials();
      const client = new DhLotteryClient({ verbose: true });
      await logger.info('로그인 테스트 시작');
      await client.login(config.id, config.password);
      const balance = await client.getBalance();
      await logger.success(`로그인 성공 — 구매 가능 ${balance.available.toLocaleString()}원`);
      console.log(`✅ 로그인 성공`);
      console.log(`💰 구매 가능 금액: ${balance.available.toLocaleString()}원`);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('buy')
  .description('AI 추천 번호로 로또 수동 구매')
  .action(async () => {
    try {
      await runBuyFlow();
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('recommend')
  .alias('rec')
  .description('AI 번호 추천만 (구매 없음)')
  .action(async () => {
    try {
      await runRecommendFlow();
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('회차 당첨번호 + 내 구매 당첨 여부 확인')
  .option('-r, --round <number>', '회차 번호', parseInt)
  .action(async (opts: { round?: number }) => {
    try {
      await runCheckFlow(opts.round);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('당첨 내역 캐시 동기화 (최초 1회 전체, 이후 신규 회차만)')
  .option('--full', '전체 회차 재다운로드')
  .action(async (opts: { full?: boolean }) => {
    try {
      await runSyncFlow(opts.full);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('settle')
  .description('구매 내역 당첨 정산 (sync 후 자동 실행되기도 함)')
  .option('-r, --round <number>', '특정 회차만 정산', parseInt)
  .action(async (opts: { round?: number }) => {
    try {
      await runSettleFlow(opts.round);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pension-buy')
  .description('AI 추천 번호로 연금복권720+ 구매')
  .option('-v, --verbose', 'el API 호출 로그 출력')
  .action(async (opts: { verbose?: boolean }) => {
    if (opts.verbose) process.env.PENSION_VERBOSE = '1';
    try {
      await runPensionBuyFlow();
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pension-verify')
  .description('연금 번호 판매 여부만 checkVerifyNo 로 확인 (구매 없음)')
  .option('-d, --digits <string>', '6자리 번호 (없으면 AI/통계 추천)')
  .option('-v, --verbose', 'el API 호출 로그 출력')
  .action(async (opts: { digits?: string; verbose?: boolean }) => {
    if (opts.verbose) process.env.PENSION_VERBOSE = '1';
    try {
      await runPensionVerifyFlow({ digits: opts.digits });
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pension-recommend')
  .alias('pension-rec')
  .description('연금복권 AI 번호 추천만 (구매 없음)')
  .action(async () => {
    try {
      await runPensionRecommendFlow();
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pension-sync')
  .description('연금복권 당첨 캐시 동기화')
  .option('--full', '전체 회차 재다운로드')
  .action(async (opts: { full?: boolean }) => {
    try {
      await runPensionSyncFlow(opts.full);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('pension-settle')
  .description('연금복권 구매 당첨 정산')
  .option('-r, --round <number>', '특정 회차만 정산', parseInt)
  .action(async (opts: { round?: number }) => {
    try {
      await runPensionSettleFlow(opts.round);
    } catch (err) {
      console.error('❌', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('주간 자동 구매 스케줄러 실행')
  .action(() => {
    startScheduler();
  });

program
  .command('web')
  .alias('dashboard')
  .description('구매·로그 대시보드 웹 서버 실행')
  .action(() => {
    startDashboard();
  });

program.parse();
