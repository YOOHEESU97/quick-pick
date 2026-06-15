/**
 * 연금720 checkVerifyNo / connPro 폼 — game.jsp(getBuyDataSA, doVerify, doOrder) 와 동일
 */
import {
  expandAllGroups,
  isAllGroupsBundle,
  normalizePensionDigits,
  parseVerifyRecommendations,
  pickSaBundleDigits,
} from './check.js';
import type { PensionTicket } from '../types.js';

export interface VerifyNoResult {
  available: boolean;
  digits: string;
  tickets: PensionTicket[];
  alternatives: PensionTicket[];
  /** game.jsp getBuyDataSA — connPro BUY_NO */
  buyNo: string;
  buySetType: string;
  buyType: string;
}

/** frmauto — doVerify / makeOrderNo 공통 */
export function buildVerifyAutoForm(round: number, ticket: PensionTicket): URLSearchParams {
  return new URLSearchParams({
    ROUND: String(round),
    AUTO_SEL_SET: ticket.setType,
    SEL_CLASS: ticket.setType === 'SA' ? '' : String(ticket.group),
    SEL_NO: normalizePensionDigits(ticket.digits),
    BUY_TYPE: 'M',
    BUY_CNT: ticket.setType === 'SA' ? '5' : '1',
    ACCS_TYPE: '02',
  });
}

/** game.jsp getBuyDataSA — verify 성공 후 BUY_NO/BUY_SET_TYPE/BUY_TYPE 생성 */
export function buildSaBuyPayload(
  classnum: string,
  lotNo: string,
  setType: string,
  buyType: string
): { tickets: PensionTicket[]; buyNo: string; buySetType: string; buyType: string; buyCnt: number } {
  const digits = normalizePensionDigits(lotNo);

  if (setType === 'SA') {
    const tickets = expandAllGroups(digits);
    const types = tickets.map(() => buyType || 'M');
    return {
      tickets,
      buyNo: tickets.map((t) => `${t.group}${digits}`).join(','),
      buySetType: tickets.map(() => 'SA').join(','),
      buyType: types.join(','),
      buyCnt: 5,
    };
  }

  const group = Number(classnum || '1');
  const tickets: PensionTicket[] = [{ group, digits, setType: 'S' }];
  return {
    tickets,
    buyNo: `${group}${digits}`,
    buySetType: setType,
    buyType: buyType || 'M',
    buyCnt: 1,
  };
}

/**
 * checkVerifyNo 복호화 JSON → game.jsp doVerify success 분기와 동일
 * - verifyYn === 'Y' && recommendYN === 'N' → 구매 가능
 * - verifyYn === 'Y' && recommendYN !== 'N' → 매진(대체 번호)
 */
export function parseVerifyNoResponse(
  expectedRound: number,
  requested: PensionTicket,
  data: Record<string, string>
): VerifyNoResult {
  if (data.resultCode !== '100') {
    throw new Error(
      `번호 검증 API 오류 (${requested.group}조 ${requested.digits}): ${data.resultMsg ?? data.resultCode}`
    );
  }

  const responseRound = Number(data.round);
  if (Number.isFinite(responseRound) && responseRound > 0 && responseRound !== expectedRound) {
    throw new Error(
      `회차 불일치 — 요청 ${expectedRound}회 / API ${responseRound}회. pension-sync 후 다시 시도해주세요.`
    );
  }

  if (data.verifyYn !== 'Y') {
    throw new Error(`구매 불가 번호: ${requested.group}조 ${normalizePensionDigits(requested.digits)}`);
  }

  if (data.recommendYN === 'N') {
    const lotNo = normalizePensionDigits(data.selLotNo ?? requested.digits);
    const setType = data.autoSelSet ?? requested.setType;
    const buyType = data.selBuyType ?? 'M';
    const payload = buildSaBuyPayload(data.selClsNo ?? '', lotNo, setType, buyType);

    return {
      available: true,
      digits: lotNo,
      tickets: payload.tickets,
      alternatives: [],
      buyNo: payload.buyNo,
      buySetType: payload.buySetType,
      buyType: payload.buyType,
    };
  }

  const alternatives = parseVerifyRecommendations(data);
  return {
    available: false,
    digits: normalizePensionDigits(requested.digits),
    tickets: [],
    alternatives,
    buyNo: '',
    buySetType: '',
    buyType: '',
  };
}

/** game.jsp #frm — connPro.do 직렬화 */
export function buildPensionConnProForm(
  round: number,
  tickets: PensionTicket[],
  deposit: number,
  order: { orderNo: string; orderDate: string }
): URLSearchParams {
  if (tickets.length < 1 || tickets.length > 5) {
    throw new Error('연금복권은 1~5매까지 구매 가능합니다.');
  }

  const payload = isAllGroupsBundle(tickets)
    ? buildSaBuyPayload('', tickets[0].digits, 'SA', 'M')
    : {
        tickets,
        buyNo: tickets.map((t) => `${t.group}${normalizePensionDigits(t.digits)}`).join(','),
        buySetType: tickets.map((t) => t.setType).join(','),
        buyType: tickets.map(() => 'M').join(','),
        buyCnt: tickets.length,
      };

  const allGroups = isAllGroupsBundle(tickets);
  const digits = allGroups ? normalizePensionDigits(tickets[0].digits) : '';
  const digitChars = digits.split('');

  return new URLSearchParams({
    ROUND: String(round),
    FLAG: '',
    BUY_KIND: '01',
    BUY_NO: payload.buyNo,
    BUY_CNT: String(payload.buyCnt),
    BUY_SET_TYPE: payload.buySetType,
    BUY_TYPE: payload.buyType,
    ACCS_TYPE: '02',
    orderNo: order.orderNo,
    orderDate: order.orderDate,
    TRANSACTION_ID: '',
    WIN_DATE: '',
    USER_ID: '',
    PAY_TYPE: 'M',
    resultErrorCode: '',
    resultErrorMsg: '',
    resultOrderNo: '',
    WORKING_FLAG: 'false',
    NUM_CHANGE_TYPE: '',
    auto_process: '',
    set_type: allGroups ? 'SA' : tickets[0]?.setType ?? 'S',
    classnum: allGroups ? '' : String(tickets[0]?.group ?? ''),
    selnum: digits,
    buytype: 'M',
    num1: digitChars[0] ?? '',
    num2: digitChars[1] ?? '',
    num3: digitChars[2] ?? '',
    num4: digitChars[3] ?? '',
    num5: digitChars[4] ?? '',
    num6: digitChars[5] ?? '',
    DSEC: '0',
    CLOSE_DATE: '',
    verifyYN: 'N',
    curdeposit: String(deposit),
    curpay: String(payload.buyCnt * 1000),
  });
}

/** 매진 시 서버 추천 SA 번들만 추가 시도 (난수 API 호출 없음) */
export function pickNextSaCandidate(
  preferredDigits: string,
  alternatives: PensionTicket[],
  tried: Set<string>
): string | null {
  const alt = pickSaBundleDigits(alternatives);
  if (alt && !tried.has(alt)) return alt;
  return null;
}
