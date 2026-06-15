import { getSupabase } from './supabase-client.js';
import type { LottoDraw, LottoDrawPrizes } from '../types.js';

interface LottoDrawRow {
  round: number;
  draw_date: string;
  numbers: number[];
  bonus: number;
  prize_rank1: number;
  prize_rank2: number;
  prize_rank3: number;
  prize_rank4: number;
  prize_rank5: number;
  synced_at: string;
}

function rowToDraw(row: LottoDrawRow): LottoDraw {
  return {
    round: row.round,
    date: row.draw_date,
    numbers: row.numbers,
    bonus: row.bonus,
    prizes: {
      rank1: Number(row.prize_rank1),
      rank2: Number(row.prize_rank2),
      rank3: Number(row.prize_rank3),
      rank4: Number(row.prize_rank4),
      rank5: Number(row.prize_rank5),
    },
  };
}

function drawToRow(draw: LottoDraw): Omit<LottoDrawRow, 'synced_at'> & { synced_at?: string } {
  const prizes: LottoDrawPrizes = draw.prizes ?? {
    rank1: 0,
    rank2: 0,
    rank3: 0,
    rank4: 0,
    rank5: 0,
  };

  return {
    round: draw.round,
    draw_date: draw.date,
    numbers: draw.numbers,
    bonus: draw.bonus,
    prize_rank1: prizes.rank1,
    prize_rank2: prizes.rank2,
    prize_rank3: prizes.rank3,
    prize_rank4: prizes.rank4,
    prize_rank5: prizes.rank5,
    synced_at: new Date().toISOString(),
  };
}

const CHUNK = 150;

export async function supabaseUpsertDraws(draws: LottoDraw[]): Promise<void> {
  if (draws.length === 0) return;

  const supabase = getSupabase();
  const rows = draws.map(drawToRow);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('lotto_draws').upsert(chunk, { onConflict: 'round' });
    if (error) {
      throw new Error(`Supabase 당첨 저장 실패: ${error.message}`);
    }
  }
}

export async function supabaseLoadAllDraws(): Promise<LottoDraw[]> {
  const supabase = getSupabase();
  const all: LottoDraw[] = [];
  const pageSize = 500;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('lotto_draws')
      .select(
        'round, draw_date, numbers, bonus, prize_rank1, prize_rank2, prize_rank3, prize_rank4, prize_rank5, synced_at'
      )
      .order('round', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Supabase 당첨 조회 실패: ${error.message}`);
    }

    if (!data?.length) break;
    all.push(...(data as LottoDrawRow[]).map(rowToDraw));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function supabaseGetDrawByRound(round: number): Promise<LottoDraw | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('lotto_draws')
    .select(
      'round, draw_date, numbers, bonus, prize_rank1, prize_rank2, prize_rank3, prize_rank4, prize_rank5, synced_at'
    )
    .eq('round', round)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase 회차 조회 실패: ${error.message}`);
  }

  return data ? rowToDraw(data as LottoDrawRow) : undefined;
}

export async function supabaseGetLatestRound(): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('lotto_draws')
    .select('round')
    .order('round', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase 최신 회차 조회 실패: ${error.message}`);
  }

  return data ? Number((data as { round: number }).round) : null;
}
