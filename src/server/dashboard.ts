/** 로컬 대시보드 — 30초마다 DB/파일만 읽음 (동행복권 로그인 없음) */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { formatCronSchedule } from '../lib/cron-format.js';
import { getCurrentSaleRound, loadCache } from '../lotto/cache.js';
import { getCurrentPensionSaleRound, loadPensionCache } from '../pension/cache.js';
import { loadAccountSnapshot } from '../store/account-snapshot.js';
import { countPurchases, getFinancialSummary, getLogs, getPurchases } from '../store/activity.js';
import { logger } from '../lib/logger.js';
import type { ProductType } from '../types.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public');

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseProduct(url: URL): ProductType {
  const raw = url.searchParams.get('product') ?? 'lotto';
  return raw === 'pension' ? 'pension' : 'lotto';
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (pathname === '/api/status' && req.method === 'GET') {
    const product = parseProduct(url);

    let saleRound: number | null = null;
    try {
      if (product === 'pension') {
        await loadPensionCache();
        saleRound = await getCurrentPensionSaleRound();
      } else {
        await loadCache();
        saleRound = await getCurrentSaleRound();
      }
    } catch {
      saleRound = null;
    }

    const schedule =
      product === 'pension' ? config.pensionCronSchedule : config.cronSchedule;

    const [financial, purchaseCount, snapshot] = await Promise.all([
      getFinancialSummary(product),
      countPurchases(product),
      loadAccountSnapshot(),
    ]);

    sendJson(res, 200, {
      product,
      saleRound,
      purchaseCount,
      scheduleLabel: formatCronSchedule(schedule),
      financial,
      balance: snapshot
        ? {
            available: snapshot.available,
            total: snapshot.total,
            updatedAt: snapshot.updatedAt,
          }
        : null,
      balanceHint: snapshot ? null : 'npm run buy / pension-buy 실행 시 예치금이 갱신됩니다',
    });
    return;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 80);
    sendJson(res, 200, { entries: await getLogs(limit) });
    return;
  }

  if (pathname === '/api/purchases' && req.method === 'GET') {
    const product = parseProduct(url);
    const limit = Number(url.searchParams.get('limit') ?? 30);
    sendJson(res, 200, { entries: await getPurchases(limit, product) });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const file = pathname === '/' ? '/index.html' : pathname;
  const safePath = join(PUBLIC_DIR, file.replace(/\.\./g, ''));

  try {
    const content = await readFile(safePath);
    const type = file.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'application/javascript; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

export function startDashboard(): void {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url.pathname);
        return;
      }
      if (req.method === 'GET') {
        await serveStatic(res, url.pathname);
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(config.dashboardPort, config.dashboardHost, () => {
    const host =
      config.dashboardHost === '0.0.0.0' ? 'localhost' : config.dashboardHost;
    console.log(`\n🖥️  대시보드: http://${host}:${config.dashboardPort}`);
    console.log('   Ctrl+C 로 종료 (동행복권 API 호출 없음)\n');
    logger.info('대시보드 서버 시작', {
      host: config.dashboardHost,
      port: config.dashboardPort,
    }).catch(() => {});
  });
}
