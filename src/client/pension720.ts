/**
 * 연금복권720+ el.dhlottery HTTP 구매 (AES 암호화)
 */
import type { AxiosInstance, AxiosResponse } from 'axios';
import type { CookieJar } from 'tough-cookie';
import { withRetry } from '../lib/http-retry.js';
import { markPensionElApiNow, throttlePensionElApi } from '../lib/rate-limit.js';
import { config } from '../config.js';
import { decryptFormData, encryptFormData } from './pension-crypto.js';
import { validatePensionTicket } from '../pension/analyze.js';
import {
  isAllGroupsBundle,
  normalizePensionDigits,
  parseSaleTickets,
} from '../pension/check.js';
import {
  buildPensionConnProForm,
  buildVerifyAutoForm,
  parseVerifyNoResponse,
  pickNextSaCandidate,
  type VerifyNoResult,
} from '../pension/verify.js';
import type { PensionTicket } from '../types.js';

const EL_BASE = 'https://el.dhlottery.co.kr';
const MOBILE_GAME_URL = `${EL_BASE}/game_mobile/pension720/game.jsp`;
const WWW_MAIN = 'https://www.dhlottery.co.kr/main';

const API_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'X-Requested-With': 'XMLHttpRequest',
};

/** axios 기본 JSON 파싱 방지 — HTML 에러 페이지 구분용 */
const RAW_RESPONSE = { transformResponse: [(data: string) => data] };

export interface PensionPurchaseResult {
  round: number;
  tickets: PensionTicket[];
  message: string;
  orderNo?: string;
}

interface EncryptedResponse {
  resultCode?: string;
  resultMsg?: string;
  q?: string;
}

export interface PensionVerifyOutcome {
  round: number;
  digits: string;
  available: boolean;
  tickets: PensionTicket[];
  alternatives: PensionTicket[];
  message: string;
}

/** 세션 만료 재시도 시 번호 재검증·중복 주문번호 방지 */
interface BuyResumeState {
  saleRound: number;
  finalTickets: PensionTicket[];
  order?: { orderNo: string; orderDate: string };
}

export class Pension720Client {
  private session: AxiosInstance;
  private verbose: boolean;
  private lastResponse?: AxiosResponse;
  private encryptionSessionKey: string | null = null;
  private availableDeposit = 0;
  private reauth?: () => Promise<void>;

  constructor(
    session: AxiosInstance,
    options: { verbose?: boolean; reauth?: () => Promise<void> } = {}
  ) {
    this.session = session;
    this.verbose = options.verbose ?? false;
    this.reauth = options.reauth;
  }

  async bootstrap(): Promise<void> {
    this.encryptionSessionKey = null;

    const mobileGame = await this.request('연금 모바일 게임', () =>
      this.session.get(MOBILE_GAME_URL, {
        ...RAW_RESPONSE,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: WWW_MAIN,
        },
      })
    );
    this.captureSessionKeyFromResponse(mobileGame);
    await this.syncEncryptionKeyFromJar();

    const key = await this.getEncryptionSessionKey();
    if (!key) {
      throw new Error(
        'el.dhlottery 세션을 만들지 못했습니다. npm run login-test 성공 후 pension-buy 를 실행해주세요.'
      );
    }

    await this.verifyElDeposit();
  }

  async fetchSaleRound(): Promise<number> {
    const res = await this.request('판매 회차', () =>
      this.session.get(`${EL_BASE}/selectLtEpsd.do`, {
        ...RAW_RESPONSE,
        headers: { ...API_HEADERS, Referer: MOBILE_GAME_URL },
      })
    );

    const body = String(res.data ?? '').trim();
    const parsed = Number(body);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    try {
      const json = JSON.parse(body) as { data?: number };
      if (typeof json === 'number') return json;
      if (typeof json?.data === 'number') return json.data;
    } catch {
      /* ignore */
    }

    throw new Error(`판매 회차 조회 실패: ${body.slice(0, 120)}`);
  }

  async buyManual(tickets: PensionTicket[], round?: number): Promise<PensionPurchaseResult> {
    if (tickets.length < 1 || tickets.length > 5) {
      throw new Error('연금복권은 1~5매까지 구매 가능합니다.');
    }

    for (const ticket of tickets) {
      validatePensionTicket(ticket.group, ticket.digits);
    }

    let resume: BuyResumeState | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          if (this.verbose) {
            const digits = resume?.finalTickets[0]
              ? normalizePensionDigits(resume.finalTickets[0].digits)
              : '';
            console.log(
              `  ↻ el 세션 만료 — www 재로그인 후 구매 재개${digits ? ` (${digits})` : ''}...`
            );
          }
          if (this.reauth) await this.reauth();
          await this.bootstrap();
          markPensionElApiNow();
        }
        return await this.executeBuy(tickets, round, resume);
      } catch (err) {
        if (attempt === 0 && isSessionExpiredError(err)) {
          resume = err.resume;
          continue;
        }
        throw err;
      }
    }

    throw new Error('연금 구매 재시도에 실패했습니다.');
  }

  /** 구매 없이 checkVerifyNo 만 실행 (pension-verify) */
  async verifySaDigits(digits: string, round?: number): Promise<PensionVerifyOutcome> {
    const saleRound = round ?? (await this.fetchSaleRound());
    const normalized = normalizePensionDigits(digits);
    const probe: PensionTicket = { group: 1, digits: normalized, setType: 'SA' };
    const result = await this.checkVerifyNo(saleRound, probe);

    if (result.available) {
      return {
        round: saleRound,
        digits: result.digits,
        available: true,
        tickets: result.tickets,
        alternatives: [],
        message: `${saleRound}회 ${result.digits} — 구매 가능 (모든조 5매)`,
      };
    }

    const alt = pickNextSaCandidate(normalized, result.alternatives, new Set([normalized]));
    return {
      round: saleRound,
      digits: normalized,
      available: false,
      tickets: [],
      alternatives: result.alternatives,
      message: alt
        ? `${saleRound}회 ${normalized} 매진 — 서버 추천 ${alt} (pension-verify 로 재확인)`
        : `${saleRound}회 ${normalized} 매진 — 구매 가능한 모든조 번호 없음`,
    };
  }

  private async executeBuy(
    tickets: PensionTicket[],
    round?: number,
    resume?: BuyResumeState
  ): Promise<PensionPurchaseResult> {
    const preferredDigits = isAllGroupsBundle(tickets)
      ? normalizePensionDigits(tickets[0].digits)
      : undefined;

    let saleRound: number;
    let finalTickets: PensionTicket[];

    if (resume) {
      saleRound = resume.saleRound;
      finalTickets = resume.finalTickets;
      if (round != null && round !== saleRound && this.verbose) {
        console.warn(`  ⚠ 회차 보정: ${round} → ${saleRound} (재시도)`);
      }
    } else {
      saleRound = await this.fetchSaleRound();
      if (round != null && round !== saleRound && this.verbose) {
        console.warn(`  ⚠ 회차 보정: ${round} → ${saleRound} (el API 판매 회차)`);
      }

      if (isAllGroupsBundle(tickets)) {
        finalTickets = await this.resolveAvailableSaBundle(saleRound, preferredDigits!);
      } else {
        finalTickets = [];
        for (const ticket of tickets) {
          const result = await this.checkVerifyNo(saleRound, ticket);
          if (!result.available) {
            throw new Error(
              `${ticket.group}조 ${ticket.digits} — 이미 판매된 번호입니다. 다른 번호를 선택해주세요.`
            );
          }
          finalTickets.push(...result.tickets);
        }
      }

      if (preferredDigits && finalTickets[0]) {
        const bought = normalizePensionDigits(finalTickets[0].digits);
        if (bought !== preferredDigits) {
          console.log(`ℹ️  ${preferredDigits} 매진 → ${bought} 로 변경하여 구매`);
        }
      }
    }

    // 검증 직후 주문·결제를 연속 호출 (세션 만료·주문 잠금 방지)
    markPensionElApiNow();
    return await this.finalizePurchase(saleRound, finalTickets, resume?.order);
  }

  /** makeOrderNo → connPro — 검증 완료 후 즉시 실행 */
  private async finalizePurchase(
    saleRound: number,
    finalTickets: PensionTicket[],
    existingOrder?: { orderNo: string; orderDate: string }
  ): Promise<PensionPurchaseResult> {
    let order = existingOrder;

    try {
      if (!order) {
        if (this.availableDeposit <= 0) {
          await this.verifyElDeposit();
        }
        order = await this.makeOrderNo(saleRound, true);
      } else if (this.verbose) {
        console.log(`  ↻ 기존 주문번호 ${order.orderNo} 로 결제 재시도`);
      }

      const buyForm = buildPensionConnProForm(
        saleRound,
        finalTickets,
        this.availableDeposit,
        order
      );
      const result = await this.connPro(buyForm, { immediate: true });
      const purchased = result.saleTicket
        ? parseSaleTickets(result.saleTicket, buyForm.get('BUY_SET_TYPE') ?? undefined)
        : finalTickets;

      return {
        round: saleRound,
        tickets: purchased.length ? purchased : finalTickets,
        message: result.resultMsg ?? '구매 완료',
        orderNo: result.orderNo ?? order.orderNo,
      };
    } catch (err) {
      if (isSessionExpiredError(err)) {
        throw new SessionExpiredError(err.detail, {
          saleRound,
          finalTickets,
          order,
        });
      }
      throw err;
    }
  }

  private async verifyElDeposit(): Promise<void> {
    this.availableDeposit = await this.fetchDeposit();
  }

  private async fetchDeposit(): Promise<number> {
    const frmauto = new URLSearchParams({
      ROUND: '',
      SEL_NO: '',
      BUY_CNT: '',
      AUTO_SEL_SET: '',
      SEL_CLASS: '',
      BUY_TYPE: 'M',
      ACCS_TYPE: '02',
    });

    const data = await this.postEncrypted(`${EL_BASE}/checkDeposit.do`, frmauto.toString(), MOBILE_GAME_URL);
    if (data.resultCode !== '100') {
      throw new Error(
        `el 도메인 로그인이 연결되지 않았습니다 (${data.resultMsg ?? data.resultCode}). ` +
          'DHLOTTERY_ID/PASSWORD로 login-test 후 pension-buy 를 실행해주세요.'
      );
    }

    const deposit = Number(data.deposit ?? 0);
    return Number.isFinite(deposit) ? deposit : 0;
  }

  /** 모든조(SA) — checkVerifyNo(recommendYN) 후 구매 가능 번호만 확정 (난수 API 호출 없음) */
  private async resolveAvailableSaBundle(round: number, preferredDigits: string): Promise<PensionTicket[]> {
    const tried = new Set<string>();
    let digits = normalizePensionDigits(preferredDigits);
    tried.add(digits);

    for (let attempt = 0; attempt < config.pensionVerifyMaxAttempts; attempt++) {
      const probe: PensionTicket = { group: 1, digits, setType: 'SA' };
      const result = await this.checkVerifyNo(round, probe);
      if (result.available) {
        if (this.verbose && digits !== normalizePensionDigits(preferredDigits)) {
          console.log(`  ✓ ${digits} 구매 가능`);
        }
        return result.tickets;
      }

      const next = pickNextSaCandidate(preferredDigits, result.alternatives, tried);
      if (!next) break;

      if (this.verbose) {
        console.log(`  ℹ️ ${digits} 매진 — 서버 추천 ${next} 확인...`);
      }
      digits = next;
      tried.add(digits);
    }

    throw new Error(
      `${normalizePensionDigits(preferredDigits)} 및 서버 추천 번호가 모두 매진입니다. ` +
        '다른 번호로 pension-recommend 후 pension-verify 로 확인해주세요.'
    );
  }

  private async checkVerifyNo(round: number, ticket: PensionTicket): Promise<VerifyNoResult> {
    const frmauto = buildVerifyAutoForm(round, ticket);
    const data = await this.postEncrypted(`${EL_BASE}/checkVerifyNo.do`, frmauto.toString(), MOBILE_GAME_URL);
    const result = parseVerifyNoResponse(round, ticket, data);

    if (!result.available && this.verbose) {
      const alt = pickNextSaCandidate(ticket.digits, result.alternatives, new Set());
      console.log(`  ⚠ ${ticket.digits} 매진${alt ? ` (서버 추천: ${alt})` : ''}`);
    }

    return result;
  }

  private async makeOrderNo(
    round: number,
    immediate = false
  ): Promise<{ orderNo: string; orderDate: string }> {
    const frmauto = new URLSearchParams({
      ROUND: String(round),
      SEL_NO: '',
      BUY_CNT: '',
      AUTO_SEL_SET: '',
      SEL_CLASS: '',
      BUY_TYPE: 'M',
      ACCS_TYPE: '02',
    });

    const data = await this.postEncrypted(
      `${EL_BASE}/makeOrderNo.do`,
      frmauto.toString(),
      MOBILE_GAME_URL,
      immediate
    );
    if (data.resultCode !== '100' || !data.orderNo) {
      throw new Error(`주문번호 생성 실패: ${data.resultMsg ?? data.resultCode}`);
    }

    return { orderNo: String(data.orderNo), orderDate: String(data.orderDate ?? '') };
  }

  private async connPro(
    form: URLSearchParams,
    options: { immediate?: boolean } = {}
  ): Promise<Record<string, string>> {
    const data = await this.postEncrypted(
      `${EL_BASE}/connPro.do`,
      form.toString(),
      MOBILE_GAME_URL,
      options.immediate
    );
    if (!['100', '110', '120'].includes(String(data.resultCode))) {
      const msg = data.resultMsg ?? data.resultCode;
      if (isPendingPurchaseMessage(String(msg))) {
        throw new PendingPurchaseError(String(msg), String(data.resultCode ?? ''));
      }
      throw new Error(`구매 실패 (${data.resultCode}): ${msg}`);
    }
    return data;
  }

  private async postEncrypted(
    url: string,
    plainForm: string,
    referer: string,
    immediate = false
  ): Promise<Record<string, string>> {
    const sessionId = await this.getEncryptionSessionKey();
    if (!sessionId) {
      throw new Error('el.dhlottery 암호화 세션이 없습니다. login-test 후 pension-buy 를 다시 실행해주세요.');
    }

    const q = encryptFormData(plainForm, sessionId);
    const res = await this.request('연금 API', () =>
      this.session.post(url, new URLSearchParams({ q }), {
        ...RAW_RESPONSE,
        headers: {
          ...API_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: EL_BASE,
          Referer: referer,
        },
      }),
      immediate
    );

    const outer = parseOuterJson(res.data, url);
    if (outer.resultCode?.startsWith('E')) {
      throw new SessionExpiredError(outer.resultMsg ?? outer.resultCode);
    }

    if (!outer.q) {
      throw new SessionExpiredError('연금 API 암호화 응답(q)이 없습니다.');
    }

    const cipher = outer.q.includes('%') ? decodeURIComponent(outer.q) : outer.q;
    const decrypted = decryptFormData(cipher, sessionId);
    if (!decrypted?.trim()) {
      throw new SessionExpiredError('연금 API 복호화 실패 — el JSESSIONID 키가 맞지 않습니다.');
    }
    if (decrypted.trim().startsWith('<')) {
      throw new SessionExpiredError('연금 API가 HTML을 반환했습니다.');
    }

    try {
      return JSON.parse(decrypted) as Record<string, string>;
    } catch {
      throw new Error(`연금 API 내용 파싱 실패: ${decrypted.slice(0, 120)}`);
    }
  }

  private captureSessionKeyFromResponse(res: AxiosResponse): void {
    const raw = res.headers['set-cookie'];
    const headers = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const header of headers) {
      const match = /^(?:JSESSIONID|DHJSESSIONID)=([^;]+)/i.exec(header);
      if (match?.[1]) {
        this.encryptionSessionKey = match[1];
        return;
      }
    }
  }

  private getCookieJar(): CookieJar | null {
    const jar = (this.session as AxiosInstance & { defaults?: { jar?: CookieJar } }).defaults?.jar;
    return jar ?? null;
  }

  private async syncEncryptionKeyFromJar(): Promise<void> {
    const key = await this.readElEncryptionKey();
    if (key) this.encryptionSessionKey = key;
  }

  /** encrypt.js — el.dhlottery JSESSIONID 만 사용 (www DHJSESSIONID 와 다름) */
  private async readElEncryptionKey(): Promise<string | null> {
    const jar = this.getCookieJar();
    if (!jar) return null;

    for (const url of [MOBILE_GAME_URL, `${EL_BASE}/`]) {
      const cookies = await jar.getCookies(url);
      const js = cookies.find((c) => c.key === 'JSESSIONID')?.value;
      if (js) return js;
      const dh = cookies.find((c) => c.key === 'DHJSESSIONID')?.value;
      if (dh) return dh;
    }
    return null;
  }

  private async getEncryptionSessionKey(): Promise<string | null> {
    if (this.encryptionSessionKey) return this.encryptionSessionKey;

    const key = await this.readElEncryptionKey();
    if (key) {
      this.encryptionSessionKey = key;
      return key;
    }
    return null;
  }

  private async request<T>(label: string, fn: () => Promise<T>, immediate = false): Promise<T> {
    if (this.verbose) console.log(`  → ${label}...`);
    if (immediate) {
      markPensionElApiNow();
    } else {
      await throttlePensionElApi((wait) => {
        if (this.verbose) {
          console.log(`  ⏳ el API ${Math.ceil(wait / 1000)}초 대기...`);
        }
      });
    }
    return withRetry(label, async () => {
      const res = await fn();
      if (isAxiosResponse(res)) this.lastResponse = res;
      return res;
    });
  }
}

class PendingPurchaseError extends Error {
  readonly resultCode: string;

  constructor(message: string, resultCode: string) {
    super(formatPendingPurchaseMessage(message, resultCode));
    this.name = 'PendingPurchaseError';
    this.resultCode = resultCode;
  }
}

class SessionExpiredError extends Error {
  readonly detail: string;
  readonly resume?: BuyResumeState;

  constructor(detail: string, resume?: BuyResumeState) {
    const base = `el 세션 오류: ${detail}`;
    super(
      resume
        ? base
        : `${base}\nwww 로그인 → el 게임 페이지 연결이 끊겼습니다. pension-buy 가 자동 재로그인을 시도합니다.`
    );
    this.name = 'SessionExpiredError';
    this.detail = detail;
    this.resume = resume;
  }
}

function isPendingPurchaseError(err: unknown): err is PendingPurchaseError {
  return err instanceof PendingPurchaseError;
}

function isSessionExpiredError(err: unknown): err is SessionExpiredError {
  return err instanceof SessionExpiredError;
}

function isPendingPurchaseMessage(msg: string): boolean {
  return msg.includes('구매 진행중') || msg.includes('구매요청을 처리 중');
}

function formatPendingPurchaseMessage(msg: string, code: string): string {
  return (
    `${msg} (코드: ${code || 'unknown'})\n` +
    '동행복권 서버에 미완료 주문 잠금입니다. 자동 재시도하지 않습니다.\n' +
    '· 1:1 문의/고객센터로 잠금 해제 후 다시 시도\n' +
    '· 브라우저 연금720+ 구매 화면에서 미완료 결제 확인'
  );
}

function parseOuterJson(data: unknown, url: string): EncryptedResponse {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as EncryptedResponse;
  }

  const text = String(data ?? '').trim();
  if (!text) {
    throw new Error(`연금 API 빈 응답 (${url})`);
  }
  if (text.startsWith('<') || text.includes('<!DOCTYPE')) {
    throw new SessionExpiredError(
      `HTTP 응답이 HTML입니다 (${url}). el JSESSIONID 세션이 만료되었거나 로그인이 끊겼습니다.`
    );
  }

  try {
    return JSON.parse(text) as EncryptedResponse;
  } catch {
    throw new Error(`연금 API JSON 파싱 실패 (${url}): ${text.slice(0, 120)}`);
  }
}

function isAxiosResponse(value: unknown): value is AxiosResponse {
  return typeof value === 'object' && value !== null && 'status' in value && 'data' in value;
}
