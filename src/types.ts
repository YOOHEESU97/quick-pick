export interface LottoDrawPrizes {
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  rank5: number;
}

export interface LottoDraw {
  round: number;
  date: string;
  numbers: number[];
  bonus: number;
  prizes?: LottoDrawPrizes;
}

export interface LottoStats {
  frequency: Record<number, number>;
  overdue: Record<number, number>;
  recentHot: number[];
  recentCold: number[];
  oddEvenRatio: { odd: number; even: number };
  sumRange: { min: number; max: number; avg: number };
}

export interface PurchaseResult {
  round: number;
  tickets: number[][];
  message: string;
}

export interface BalanceInfo {
  total: number;
  available: number;
}

export type ProductType = 'lotto' | 'pension';

/** 연금복권720+ 1장 — {조 1~5}{6자리} 예: 3조 827917 → group:3 digits:"827917" */
export interface PensionTicket {
  group: number;
  digits: string;
  setType: 'S' | 'SA';
}

export interface PensionDraw {
  round: number;
  date: string;
  /** 1등 조 (1~5) */
  firstGroup: number;
  /** 1등 6자리 */
  firstNumber: string;
  /** 보너스 6자리 (있을 때) */
  bonusNumber?: string;
  prizes?: PensionDrawPrizes;
}

export interface PensionDrawPrizes {
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  rank5: number;
  rank6: number;
  rank7: number;
  bonus: number;
}

export interface PensionTicketSettlement {
  ticketIndex: number;
  rank: number;
  matchedDigits: number;
  prize: number;
}

export interface TicketSettlement {
  gameIndex: number;
  rank: number;
  matched: number;
  prize: number;
}

export interface ActivityLog {
  id: string;
  createdAt: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export interface PurchaseRecord {
  id: string;
  createdAt: string;
  product: ProductType;
  round: number;
  method: 'ai' | 'statistical';
  /** 로또 6/45 */
  tickets: number[][];
  /** 연금복권720+ */
  pensionTickets?: PensionTicket[];
  ticketCount: number;
  amount: number;
  message: string;
  success: boolean;
  settledAt?: string | null;
  prizeTotal?: number | null;
  bestRank?: number | null;
  settlements?: TicketSettlement[] | null;
  pensionSettlements?: PensionTicketSettlement[] | null;
}

export interface FinancialSummary {
  totalSpent: number;
  totalWon: number;
  netProfit: number;
  purchaseCount: number;
  settledCount: number;
  pendingCount: number;
  product?: ProductType;
}
