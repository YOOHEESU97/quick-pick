import type { PensionDraw, PensionTicket } from '../types.js';

function normalizeDigits(value: string): string {
  return value.padStart(6, '0');
}

export function checkPensionWinning(
  ticket: PensionTicket,
  draw: PensionDraw
): { rank: number; matchedDigits: number } {
  const win = normalizeDigits(draw.firstNumber);
  const td = normalizeDigits(ticket.digits);

  if (ticket.group === draw.firstGroup && td === win) {
    return { rank: 1, matchedDigits: 6 };
  }

  if (td === win) {
    return { rank: 2, matchedDigits: 6 };
  }

  if (draw.bonusNumber && td === normalizeDigits(draw.bonusNumber)) {
    return { rank: 8, matchedDigits: 6 };
  }

  const suffixByRank: Record<number, number> = {
    3: 5,
    4: 4,
    5: 3,
    6: 2,
    7: 1,
  };

  for (const [rankStr, len] of Object.entries(suffixByRank)) {
    const rank = Number(rankStr);
    const suffix = win.slice(-len);
    if (td.slice(-len) === suffix) {
      return { rank, matchedDigits: len };
    }
  }

  return { rank: 0, matchedDigits: 0 };
}

export function normalizePensionDigits(value: string): string {
  const digits = String(value).replace(/\D/g, '').padStart(6, '0').slice(-6);
  if (!/^\d{6}$/.test(digits)) {
    throw new Error(`6자리 숫자여야 합니다: ${value}`);
  }
  return digits;
}

/** 6자리 1개 → 1~5조 5매 (모든조 SA) */
export function expandAllGroups(digits: string): PensionTicket[] {
  const normalized = normalizePensionDigits(digits);
  return [1, 2, 3, 4, 5].map((group) => ({
    group,
    digits: normalized,
    setType: 'SA' as const,
  }));
}

export function isAllGroupsBundle(tickets: PensionTicket[]): boolean {
  if (tickets.length !== 5) return false;
  const digits = normalizePensionDigits(tickets[0].digits);
  return tickets.every(
    (t, i) => t.group === i + 1 && normalizePensionDigits(t.digits) === digits && t.setType === 'SA'
  );
}

export function formatPensionTicket(ticket: PensionTicket): string {
  return `${ticket.group}조 ${normalizeDigits(ticket.digits)}`;
}

export function parseBuyNo(buyNo: string): PensionTicket {
  const trimmed = buyNo.trim();
  const group = Number(trimmed[0]);
  const digits = trimmed.slice(1).padStart(6, '0');
  return { group, digits, setType: 'S' };
}

export function parseSaleTickets(saleTicket: string, setTypes?: string): PensionTicket[] {
  const nos = saleTicket.split(',').filter(Boolean);
  const types = setTypes?.split(',') ?? [];
  return nos.map((no, i) => ({
    ...parseBuyNo(no),
    setType: (types[i] === 'SA' ? 'SA' : 'S') as PensionTicket['setType'],
  }));
}

/** checkVerifyNo 매진 시 서버가 돌려주는 대체 번호 파싱 */
export function parseVerifyRecommendations(data: Record<string, string>): PensionTicket[] {
  const lotNos = (data.selLotNo ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const clsNos = (data.selClsNo ?? '').split(',').map((s) => s.trim());
  const setTypes = (data.autoSelSet ?? '').split(',').map((s) => s.trim());

  const out: PensionTicket[] = [];
  for (let i = 0; i < lotNos.length; i++) {
    const rawLot = lotNos[i];
    const cls = clsNos[i] ?? '';
    const setType = (setTypes[i] ?? (cls === 'SA' ? 'SA' : 'S')) as PensionTicket['setType'];

    if (cls === 'SA' || setType === 'SA') {
      const digits =
        rawLot.length > 6 ? normalizePensionDigits(rawLot.slice(-6)) : normalizePensionDigits(rawLot);
      out.push(...expandAllGroups(digits));
      continue;
    }

    const group = Number(cls || rawLot[0]);
    const digits =
      cls && /^\d{6}$/.test(rawLot)
        ? normalizePensionDigits(rawLot)
        : normalizePensionDigits(rawLot.slice(1));
    out.push({ group, digits, setType: 'S' });
  }
  return out;
}

/** 추천 목록에서 모든조(SA) 5매에 쓸 6자리 추출 */
export function pickSaBundleDigits(alternatives: PensionTicket[]): string | null {
  for (const t of alternatives) {
    if (t.setType === 'SA') return normalizePensionDigits(t.digits);
  }

  const byDigits = new Map<string, PensionTicket[]>();
  for (const t of alternatives) {
    const d = normalizePensionDigits(t.digits);
    const list = byDigits.get(d) ?? [];
    list.push(t);
    byDigits.set(d, list);
  }
  for (const [digits, ts] of byDigits) {
    if (isAllGroupsBundle(ts)) return digits;
  }
  return null;
}

/** 매진 시 재시도용 난수 6자리 */
export function generateRandomPensionDigits(seed: number): string {
  let state = Math.abs(seed) || 1;
  let digits = '';
  for (let i = 0; i < 6; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    digits += String(state % 10);
  }
  return digits;
}
