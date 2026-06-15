#!/usr/bin/env npx tsx
/**
 * 잘못 파싱된 구매 번호(예: 411 → 41) 일괄 수정
 * 사용: npx tsx scripts/fix-purchase-tickets.ts
 */
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, isSupabaseConfigured, useSupabaseWrite } from '../src/config.js';
import { getSupabase } from '../src/store/supabase-client.js';
import type { PurchaseRecord } from '../src/types.js';

function fixTicketNumbers(tickets: number[][]): { fixed: number[][]; changed: boolean } {
  let changed = false;
  const fixed = tickets.map((ticket) => {
    const out: number[] = [];
    for (let i = 0; i < ticket.length; i++) {
      const n = ticket[i];
      if (n >= 1 && n <= 45) {
        out.push(n);
        continue;
      }
      if (n > 45 && n < 1000 && out.length === 5) {
        const sixth = Math.floor(n / 10);
        if (sixth >= 1 && sixth <= 45) {
          out.push(sixth);
          changed = true;
          continue;
        }
      }
      out.push(n);
    }
    if (out.length === 6 && out.some((x) => x > 45)) changed = true;
    return out.length === 6 ? [...out].sort((a, b) => a - b) : ticket;
  });
  return { fixed, changed };
}

function needsFix(tickets: number[][]): boolean {
  return tickets.some((t) => t.some((n) => n > 45));
}

async function fixLocal(): Promise<number> {
  const path = config.purchasesPath;
  let store: { entries: PurchaseRecord[] };
  try {
    store = JSON.parse(await readFile(path, 'utf-8')) as { entries: PurchaseRecord[] };
  } catch {
    console.log('로컬 purchases.json 없음 — 건너뜀');
    return 0;
  }

  let count = 0;
  for (const entry of store.entries) {
    if (!needsFix(entry.tickets)) continue;
    const { fixed, changed } = fixTicketNumbers(entry.tickets);
    if (changed) {
      entry.tickets = fixed;
      entry.settledAt = null;
      entry.prizeTotal = null;
      entry.bestRank = null;
      entry.settlements = null;
      count++;
    }
  }

  if (count > 0) {
    await writeFile(path, JSON.stringify(store, null, 2), 'utf-8');
  }
  return count;
}

async function fixSupabase(): Promise<number> {
  if (!isSupabaseConfigured() || !useSupabaseWrite()) return 0;

  const sb = getSupabase();
  const { data, error } = await sb.from('purchases').select('id, tickets');
  if (error) throw new Error(error.message);

  let count = 0;
  for (const row of data ?? []) {
    const tickets = row.tickets as number[][];
    if (!needsFix(tickets)) continue;

    const { fixed, changed } = fixTicketNumbers(tickets);
    if (!changed) continue;

    const { error: upErr } = await sb
      .from('purchases')
      .update({
        tickets: fixed,
        settled_at: null,
        prize_total: null,
        best_rank: null,
        settlements: null,
      })
      .eq('id', row.id);

    if (upErr) throw new Error(upErr.message);
    count++;
    console.log(`  Supabase ${row.id}: ${JSON.stringify(tickets)} → ${JSON.stringify(fixed)}`);
  }
  return count;
}

async function main(): Promise<void> {
  const localN = await fixLocal();
  const remoteN = await fixSupabase();
  console.log(`\n완료 — 로컬 ${localN}건, Supabase ${remoteN}건 수정`);
}

main().catch((err) => {
  console.error('❌', (err as Error).message);
  process.exit(1);
});
