import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, isSupabaseConfigured } from '../config.js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase가 설정되지 않았습니다. SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 .env에 추가하세요.');
  }

  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Node.js < 22에는 네이티브 WebSocket이 없음 (REST만 써도 Realtime 클라이언트가 초기화됨)
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    });
  }

  return client;
}
