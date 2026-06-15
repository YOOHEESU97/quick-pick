import { getSupabase } from './supabase-client.js';
import type {
  ActivityLog,
  FinancialSummary,
  ProductType,
  PurchaseRecord,
  PensionTicket,
  PensionTicketSettlement,
  TicketSettlement,
} from '../types.js';

const MAX_LOGS = 300;
const MAX_PURCHASES = 100;

const PURCHASE_COLUMNS =
  'id, created_at, product, round, method, tickets, pension_tickets, ticket_count, amount, message, success, settled_at, prize_total, best_rank, settlements, pension_settlements';

interface ActivityLogRow {
  id: string;
  created_at: string;
  level: ActivityLog['level'];
  message: string;
  meta: Record<string, unknown> | null;
}

interface PurchaseRow {
  id: string;
  created_at: string;
  product: ProductType | null;
  round: number;
  method: PurchaseRecord['method'];
  tickets: number[][];
  pension_tickets: PensionTicket[] | null;
  ticket_count: number;
  amount: number;
  message: string;
  success: boolean;
  settled_at: string | null;
  prize_total: number | null;
  best_rank: number | null;
  settlements: TicketSettlement[] | null;
  pension_settlements: PensionTicketSettlement[] | null;
}

function mapLog(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    createdAt: row.created_at,
    level: row.level,
    message: row.message,
    meta: row.meta ?? undefined,
  };
}

function mapPurchase(row: PurchaseRow): PurchaseRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    product: row.product ?? 'lotto',
    round: row.round,
    method: row.method,
    tickets: row.tickets ?? [],
    pensionTickets: row.pension_tickets ?? undefined,
    ticketCount: row.ticket_count,
    amount: row.amount,
    message: row.message,
    success: row.success,
    settledAt: row.settled_at,
    prizeTotal: row.prize_total,
    bestRank: row.best_rank,
    settlements: row.settlements,
    pensionSettlements: row.pension_settlements,
  };
}

async function trimTable(table: 'activity_logs' | 'purchases', maxRows: number): Promise<void> {
  const supabase = getSupabase();
  const orderCol = 'created_at';

  const { data: cutoffRow, error: cutoffError } = await supabase
    .from(table)
    .select(orderCol)
    .order(orderCol, { ascending: false })
    .range(maxRows - 1, maxRows - 1)
    .maybeSingle();

  if (cutoffError || !cutoffRow) return;

  const cutoff = (cutoffRow as Record<string, string>)[orderCol];
  await supabase.from(table).delete().lt(orderCol, cutoff);
}

export async function supabaseAppendLog(
  level: ActivityLog['level'],
  message: string,
  meta?: Record<string, unknown>
): Promise<ActivityLog> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('activity_logs')
    .insert({
      level,
      message,
      meta: meta ?? null,
    })
    .select('id, created_at, level, message, meta')
    .single();

  if (error || !data) {
    throw new Error(`Supabase 로그 저장 실패: ${error?.message ?? 'unknown'}`);
  }

  await trimTable('activity_logs', MAX_LOGS).catch(() => {});
  return mapLog(data as ActivityLogRow);
}

export async function supabaseAppendPurchase(
  record: Omit<PurchaseRecord, 'createdAt'> & { id?: string }
): Promise<PurchaseRecord> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('purchases')
    .insert({
      ...(record.id ? { id: record.id } : {}),
      product: record.product ?? 'lotto',
      round: record.round,
      method: record.method,
      tickets: record.tickets ?? [],
      pension_tickets: record.pensionTickets ?? null,
      ticket_count: record.ticketCount,
      amount: record.amount,
      message: record.message,
      success: record.success,
      settled_at: record.settledAt ?? null,
      prize_total: record.prizeTotal ?? null,
      best_rank: record.bestRank ?? null,
      settlements: record.settlements ?? null,
      pension_settlements: record.pensionSettlements ?? null,
    })
    .select(PURCHASE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Supabase 구매 저장 실패: ${error?.message ?? 'unknown'}`);
  }

  await trimTable('purchases', MAX_PURCHASES).catch(() => {});
  return mapPurchase(data as PurchaseRow);
}

export async function supabaseUpdatePurchaseSettlement(
  id: string,
  update: {
    settledAt: string;
    prizeTotal: number;
    bestRank: number;
    settlements: TicketSettlement[];
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('purchases')
    .update({
      settled_at: update.settledAt,
      prize_total: update.prizeTotal,
      best_rank: update.bestRank,
      settlements: update.settlements,
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Supabase 구매 정산 실패: ${error.message}`);
  }
}

export async function supabaseGetLogs(limit: number): Promise<ActivityLog[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('activity_logs')
    .select('id, created_at, level, message, meta')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase 로그 조회 실패: ${error.message}`);
  }

  return (data as ActivityLogRow[]).map(mapLog);
}

export async function supabaseUpdatePurchasePensionSettlement(
  id: string,
  update: {
    settledAt: string;
    prizeTotal: number;
    bestRank: number;
    pensionSettlements: PensionTicketSettlement[];
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('purchases')
    .update({
      settled_at: update.settledAt,
      prize_total: update.prizeTotal,
      best_rank: update.bestRank,
      pension_settlements: update.pensionSettlements,
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Supabase 연금 정산 실패: ${error.message}`);
  }
}

export async function supabaseGetPurchases(limit: number, product?: ProductType): Promise<PurchaseRecord[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('purchases')
    .select(PURCHASE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (product) {
    query = query.eq('product', product);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Supabase 구매 조회 실패: ${error.message}`);
  }

  return (data as PurchaseRow[]).map(mapPurchase);
}

export async function supabaseGetUnsettledPurchases(product?: ProductType): Promise<PurchaseRecord[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('purchases')
    .select(PURCHASE_COLUMNS)
    .eq('success', true)
    .is('settled_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_PURCHASES);

  if (product) {
    query = query.eq('product', product);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Supabase 미정산 구매 조회 실패: ${error.message}`);
  }

  return (data as PurchaseRow[]).map(mapPurchase);
}

export async function supabaseCountPurchases(product?: ProductType): Promise<number> {
  const supabase = getSupabase();

  let query = supabase.from('purchases').select('*', { count: 'exact', head: true });
  if (product) {
    query = query.eq('product', product);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Supabase 구매 건수 조회 실패: ${error.message}`);
  }

  return count ?? 0;
}

export async function supabaseGetFinancialSummary(product?: ProductType): Promise<FinancialSummary> {
  const purchases = await supabaseGetPurchases(MAX_PURCHASES, product);
  return summarizePurchases(purchases, product);
}

function summarizePurchases(purchases: PurchaseRecord[], product?: ProductType): FinancialSummary {
  let totalSpent = 0;
  let totalWon = 0;
  let settledCount = 0;
  let pendingCount = 0;

  for (const p of purchases) {
    if (!p.success) continue;
    if (product && (p.product ?? 'lotto') !== product) continue;
    totalSpent += p.amount;
    if (p.settledAt) {
      settledCount++;
      totalWon += p.prizeTotal ?? 0;
    } else {
      pendingCount++;
    }
  }

  const filtered = purchases.filter(
    (p) => p.success && (!product || (p.product ?? 'lotto') === product)
  );

  return {
    totalSpent,
    totalWon,
    netProfit: totalWon - totalSpent,
    purchaseCount: filtered.length,
    settledCount,
    pendingCount,
    product,
  };
}
