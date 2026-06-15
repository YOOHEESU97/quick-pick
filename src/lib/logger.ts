import { appendLog } from '../store/activity.js';
import type { ActivityLog } from '../types.js';

const PREFIX: Record<ActivityLog['level'], string> = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  error: '❌',
};

async function write(
  level: ActivityLog['level'],
  message: string,
  meta?: Record<string, unknown>
): Promise<void> {
  console.log(`${PREFIX[level]} ${message}`);
  await appendLog(level, message, meta);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  success: (message: string, meta?: Record<string, unknown>) => write('success', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
