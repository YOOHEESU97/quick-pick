import { getSupabase } from './supabase-client.js';
import type { PensionDraw, PensionDrawPrizes } from '../types.js';

interface PensionDrawRow {
  round: number;
  draw_date: string;
  first_group: number;
  first_number: string;
  bonus_number: string | null;
  prize_rank1: number;
  prize_rank2: number;
  prize_rank3: number;
  prize_rank4: number;
  prize_rank5: number;
  prize_rank6: number;
  prize_rank7: number;
  prize_bonus: number;
  synced_at: string;
}

function rowToDraw(row: PensionDrawRow): PensionDraw {
  return {
    round: row.round,
    date: row.draw_date,
    firstGroup: row.first_group,
    firstNumber: row.first_number,
    bonusNumber: row.bonus_number ?? undefined,
    prizes: {
      rank1: Number(row.prize_rank1),
      rank2: Number(row.prize_rank2),
      rank3: Number(row.prize_rank3),
      rank4: Number(row.prize_rank4),
      rank5: Number(row.prize_rank5),
      rank6: Number(row.prize_rank6),
      rank7: Number(row.prize_rank7),
      bonus: Number(row.prize_bonus),
    },
  };
}

function drawToRow(draw: PensionDraw): Omit<PensionDrawRow, 'synced_at'> & { synced_at?: string } {
  const prizes: PensionDrawPrizes = draw.prizes ?? {
    rank1: 0,
    rank2: 0,
    rank3: 0,
    rank4: 0,
    rank5: 0,
    rank6: 0,
    rank7: 0,
    bonus: 0,
  };

  return {
    round: draw.round,
    draw_date: draw.date,
    first_group: draw.firstGroup,
    first_number: draw.firstNumber,
    bonus_number: draw.bonusNumber ?? null,
    prize_rank1: prizes.rank1,
    prize_rank2: prizes.rank2,
    prize_rank3: prizes.rank3,
    prize_rank4: prizes.rank4,
    prize_rank5: prizes.rank5,
    prize_rank6: prizes.rank6,
    prize_rank7: prizes.rank7,
    prize_bonus: prizes.bonus,
    synced_at: new Date().toISOString(),
  };
}

const CHUNK = 150;

export async function supabaseUpsertPensionDraws(draws: PensionDraw[]): Promise<void> {
  if (draws.length === 0) return;

  const supabase = getSupabase();
  const rows = draws.map(drawToRow);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('pension_draws').upsert(chunk, { onConflict: 'round' });
    if (error) {
      throw new Error(`Supabase 연금 당첨 저장 실패: ${error.message}`);
    }
  }
}

export async function supabaseLoadAllPensionDraws(): Promise<PensionDraw[]> {
  const supabase = getSupabase();
  const all: PensionDraw[] = [];
  const pageSize = 500;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('pension_draws')
      .select(
        'round, draw_date, first_group, first_number, bonus_number, prize_rank1, prize_rank2, prize_rank3, prize_rank4, prize_rank5, prize_rank6, prize_rank7, prize_bonus, synced_at'
      )
      .order('round', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Supabase 연금 당첨 조회 실패: ${error.message}`);
    }

    if (!data?.length) break;
    all.push(...(data as PensionDrawRow[]).map(rowToDraw));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function supabaseGetPensionDrawByRound(round: number): Promise<PensionDraw | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pension_draws')
    .select(
      'round, draw_date, first_group, first_number, bonus_number, prize_rank1, prize_rank2, prize_rank3, prize_rank4, prize_rank5, prize_rank6, prize_rank7, prize_bonus, synced_at'
    )
    .eq('round', round)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase 연금 회차 조회 실패: ${error.message}`);
  }

  return data ? rowToDraw(data as PensionDrawRow) : undefined;
}

export async function supabaseGetLatestPensionRound(): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pension_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase 연금 최신 회차 조회 실패: ${error.message}`);
  }

  return data ? Number((data as { round: number }).round) : null;
}
