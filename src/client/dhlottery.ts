/**
 * 동행복권 www + ol 도메인 HTTP 클라이언트 (Playwright 없음)
 *
 * - 로그인: RSA 암호화 + 쿠키 세션
 * - 구매: ol 게임 소켓 준비 → execBuy (수동 genType=1)
 * - 공식 Open API 아님 → 차단·지연 시 핫스팟/VM IP, rate-limit 준수
 */
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import forge from 'node-forge';
import { config } from '../config.js';
import { withRetry } from '../lib/http-retry.js';
import { throttleDhlotteryApi, throttlePensionElApi } from '../lib/rate-limit.js';
import type { BalanceInfo, PurchaseResult } from '../types.js';
import { validateNumbers } from '../lotto/analyze.js';
import { getCurrentSaleRound } from '../lotto/cache.js';

const BASE_URL = 'https://www.dhlottery.co.kr';
const GAME645_URL = 'https://ol.dhlottery.co.kr/olotto/game/game645.do';
const BUY_URL = 'https://ol.dhlottery.co.kr/olotto/game/execBuy.do';
const READY_SOCKET = 'https://ol.dhlottery.co.kr/olotto/game/egovUserReadySocket.json';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

function createHttpClient(): AxiosInstance {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: config.httpTimeoutMs,
      maxRedirects: 5,
      headers: BROWSER_HEADERS,
      validateStatus: (status) => status < 500,
    })
  );
}

export class DhLotteryClient {
  private session: AxiosInstance;
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.session = createHttpClient();
    this.verbose = options.verbose ?? false;
  }

  async login(id: string, password: string): Promise<void> {
    const userId = id.trim();
    const userPw = password.trim();

    if (!userId || !userPw) {
      throw new Error('아이디 또는 비밀번호가 비어 있습니다.');
    }

    await this.request('로그인 페이지', () =>
      this.session.get(`${BASE_URL}/login`, {
        headers: { Referer: `${BASE_URL}/` },
      })
    );

    const loginPage = String((await this.lastResponse)?.data ?? '');
    if (loginPage.includes('index_check.html')) {
      throw new Error('동행복권 사이트 점검 중입니다. 나중에 다시 시도해주세요.');
    }

    const rsaRes = await this.request('RSA 키 조회', () =>
      this.session.get(`${BASE_URL}/login/selectRsaModulus.do`, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${BASE_URL}/login`,
        },
      })
    );

    const rsaData = rsaRes.data?.data;
    if (!rsaData?.rsaModulus || !rsaData?.publicExponent) {
      throw new Error('RSA 키를 가져올 수 없습니다.');
    }

    const encryptedId = rsaEncrypt(userId, rsaData.rsaModulus, rsaData.publicExponent);
    const encryptedPw = rsaEncrypt(userPw, rsaData.rsaModulus, rsaData.publicExponent);

    const loginRes = await this.request('로그인 요청', () =>
      this.session.post(
        `${BASE_URL}/login/securityLoginCheck.do`,
        new URLSearchParams({
          userId: encryptedId,
          userPswdEncn: encryptedPw,
          inpUserId: userId,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      )
    );

    const finalUrl = getResponseUrl(loginRes);
    const body = String(loginRes.data ?? '');

    if (finalUrl.includes('loginSuccess') || body.includes('loginSuccess')) {
      await this.bootstrapSession();
      return;
    }

    if (await this.verifySession()) {
      return;
    }

    const detail = parseLoginError(body);
    throw new Error(detail ?? '로그인 실패 — 아이디/비밀번호를 확인해주세요.');
  }

  private lastResponse?: AxiosResponse;

  private async request<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.verbose) {
      console.log(`  → ${label}...`);
    }
    await throttleDhlotteryApi();
    const result = await withRetry(
      label,
      async () => {
        const res = await fn();
        if (isAxiosResponse(res)) {
          this.lastResponse = res;
        }
        return res;
      },
      {
        retries: config.httpRetryCount,
        delayMs: 3000,
      }
    );
    if (this.verbose && this.lastResponse) {
      console.log(`  ✓ ${label} (${this.lastResponse.status})`);
    }
    return result;
  }

  private async bootstrapSession(): Promise<void> {
    await this.request('메인 페이지', () =>
      this.session.get(`${BASE_URL}/main`, {
        headers: { Referer: `${BASE_URL}/login` },
      })
    );
  }

  private async verifySession(): Promise<boolean> {
    try {
      const mndpRes = await this.request('세션 확인', () =>
        this.session.get(`${BASE_URL}/mypage/selectUserMndp.do`, {
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `${BASE_URL}/mypage/home`,
          },
        })
      );

      if (mndpRes.data?.data?.userMndp) {
        return true;
      }

      const mainRes = await this.session.get(`${BASE_URL}/main`, { timeout: config.httpTimeoutMs });
      return String(mainRes.data).includes('로그아웃');
    } catch {
      return false;
    }
  }

  async getBalance(): Promise<BalanceInfo> {
    const res = await this.request('예치금 조회', () =>
      this.session.get(`${BASE_URL}/mypage/selectUserMndp.do`, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${BASE_URL}/mypage/home`,
        },
      })
    );

    const mndp = res.data?.data?.userMndp;
    if (!mndp) {
      throw new Error('예치금 조회 실패 — 로그인 세션이 만료되었을 수 있습니다.');
    }

    const total =
      ((mndp.pntDpstAmt ?? 0) - (mndp.pntTkmnyAmt ?? 0)) +
      ((mndp.ncsblDpstAmt ?? 0) - (mndp.ncsblTkmnyAmt ?? 0)) +
      ((mndp.csblDpstAmt ?? 0) - (mndp.csblTkmnyAmt ?? 0));

    return {
      total,
      available: mndp.crntEntrsAmt ?? 0,
    };
  }

  /** Pension720Client — www 로그인 쿠키를 el 도메인에 연결 */
  async bootstrapElSession(): Promise<void> {
    if (this.verbose) console.log('  → 연금 el 세션 연결...');
    await throttlePensionElApi((wait) => {
      if (this.verbose) console.log(`  ⏳ el API ${Math.ceil(wait / 1000)}초 대기...`);
    });
    await withRetry('연금 el 세션 연결', async () => {
      const res = await this.session.get('https://el.dhlottery.co.kr/game_mobile/pension720/game.jsp', {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `${BASE_URL}/main`,
        },
      });
      this.lastResponse = res;
      return res;
    });
  }

  /** Pension720Client 등 el 도메인 구매용 세션 공유 */
  getHttpSession(): AxiosInstance {
    return this.session;
  }

  async buyManual(tickets: number[][]): Promise<PurchaseResult> {
    if (tickets.length < 1 || tickets.length > 5) {
      throw new Error('1~5게임까지 구매 가능합니다.');
    }

    for (const ticket of tickets) {
      validateNumbers(ticket);
    }

    await this.request('구매 페이지', () =>
      this.session.get(GAME645_URL, {
        headers: { Referer: `${BASE_URL}/main` },
      })
    );

    const readyRes = await this.request('구매 준비', () =>
      this.session.post(READY_SOCKET, null, {
        headers: {
          Referer: GAME645_URL,
          Origin: 'https://ol.dhlottery.co.kr',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
    );

    const direct = readyRes.data?.ready_ip;
    if (!direct) {
      throw new Error('구매 준비 소켓 연결 실패');
    }

    const round = await getCurrentSaleRound();
    const { drawDate, payLimitDate } = calcDrawDates();

    const param = tickets.map((numbers, i) => ({
      genType: '1',
      arrGameChoiceNum: numbers.join(','),
      alpabet: 'ABCDE'[i],
    }));

    const form = new URLSearchParams({
      round: String(round),
      direct,
      nBuyAmount: String(1000 * tickets.length),
      param: JSON.stringify(param),
      ROUND_DRAW_DATE: drawDate,
      WAMT_PAY_TLMT_END_DT: payLimitDate,
      gameCnt: String(tickets.length),
      saleMdaDcd: '10',
    });

    const buyRes = await this.request('로또 구매', () =>
      this.session.post(BUY_URL, form, {
        headers: {
          Referer: GAME645_URL,
          Origin: 'https://ol.dhlottery.co.kr',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
    );

    let result = buyRes.data?.result;
    if (!result && typeof buyRes.data === 'string') {
      try {
        result = JSON.parse(buyRes.data)?.result;
      } catch {
        /* ignore */
      }
    }

    if (result?.resultCode !== '100') {
      throw new Error(`구매 실패: ${result?.resultMsg ?? '알 수 없는 오류'}`);
    }

    const purchased = parsePurchasedNumbers(result.arrGameChoiceNum);
    const finalTickets = pickTicketsForManualPurchase(tickets, purchased);

    return {
      round,
      tickets: finalTickets,
      message: result.resultMsg ?? '구매 완료',
    };
  }
}

function isAxiosResponse(value: unknown): value is AxiosResponse {
  return typeof value === 'object' && value !== null && 'status' in value && 'data' in value;
}

function getResponseUrl(res: { request?: { res?: { responseUrl?: string } } }): string {
  return res.request?.res?.responseUrl ?? '';
}

function parseLoginError(html: string): string | null {
  const patterns = [
    /아이디\s*(또는|나)\s*비밀번호[^<]{0,80}/,
    /비밀번호[^<]{0,40}일치하지/,
    /로그인[^<]{0,40}실패/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[0].replace(/<[^>]+>/g, '').trim();
    }
  }

  if (html.includes('inpUserId') && html.includes('inpUserPswdEncn')) {
    return '로그인 실패 — 아이디/비밀번호를 확인하거나 동행복권 웹에서 직접 로그인해보세요.';
  }

  return null;
}

function rsaEncrypt(plainText: string, modulusHex: string, exponentHex: string): string {
  const n = new forge.jsbn.BigInteger(modulusHex, 16);
  const e = new forge.jsbn.BigInteger(exponentHex, 16);
  const key = forge.pki.rsa.setPublicKey(n, e);
  const encrypted = key.encrypt(plainText, 'RSAES-PKCS1-V1_5');
  return forge.util.bytesToHex(encrypted);
}

function calcDrawDates(): { drawDate: string; payLimitDate: string } {
  const korea = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = korea.getDay();
  const daysUntilSat = (6 - day + 7) % 7;
  const saturday = new Date(korea);
  saturday.setDate(korea.getDate() + daysUntilSat);

  const payLimit = new Date(saturday);
  payLimit.setFullYear(payLimit.getFullYear() + 1);

  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  return { drawDate: fmt(saturday), payLimitDate: fmt(payLimit) };
}

/** 수동 구매는 요청 번호가 정답 — API 응답 파싱 오류 시 입력값 사용 */
function pickTicketsForManualPurchase(sent: number[][], parsed: number[][]): number[][] {
  if (parsed.length !== sent.length) return sent;
  const ok = sent.every((ticket, i) => ticketsEqual(ticket, parsed[i] ?? []));
  return ok ? parsed : sent;
}

function ticketsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((n, i) => n === sb[i]);
}

/**
 * 구매 응답 arrGameChoiceNum 파싱.
 * 예: "A|2|6|9|27|28|41|1" (6개 번호 + 보너스)
 * 잘못 붙은 경우: "A|2|6|9|27|28|411" → 41과 보너스 1이 합쳐짐
 */
function parsePurchasedNumbers(lines: string[] | undefined): number[][] {
  if (!lines?.length) return [];
  return lines.map(parseOnePurchasedLine).filter((nums) => nums.length === 6);
}

function parseOnePurchasedLine(line: string): number[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (trimmed.includes(',')) {
    const chunk = trimmed.split('|').find((p) => p.includes(',')) ?? trimmed;
    const nums = chunk
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 45);
    if (nums.length >= 6) {
      return [...nums.slice(0, 6)].sort((a, b) => a - b);
    }
  }

  const parts = trimmed.split('|').map((p) => p.trim()).filter(Boolean);
  let start = 0;
  if (/^[A-E]$/i.test(parts[0] ?? '')) start = 1;

  const nums: number[] = [];
  for (let i = start; i < parts.length && nums.length < 6; i++) {
    const n = Number(parts[i]);
    if (Number.isNaN(n)) continue;

    if (n >= 1 && n <= 45) {
      nums.push(n);
      continue;
    }

    // 411 등: 6번째 당첨번호(41) + 보너스(1)가 구분자 없이 붙은 경우
    if (n > 45 && n < 1000 && nums.length === 5) {
      const sixth = Math.floor(n / 10);
      if (sixth >= 1 && sixth <= 45) {
        nums.push(sixth);
      }
    }
  }

  return nums.length === 6 ? nums.sort((a, b) => a - b) : [];
}
