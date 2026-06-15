const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** node-cron 5·6필드 표현 → "매주 월요일 10:00" (0=일, 1=월, …) */
export function formatCronSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 5) return cron;

  let minute: string;
  let hour: string;
  let dow: string;

  if (parts.length >= 6) {
    [, minute, hour, , , dow] = parts;
  } else {
    [minute, hour, , , dow] = parts;
  }

  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (dow === '*') {
    return `매일 ${time}`;
  }

  if (/^\d+$/.test(dow)) {
    const n = Number(dow);
    if (n >= 0 && n <= 7) {
      const idx = n === 7 ? 0 : n;
      return `매주 ${WEEKDAYS[idx]}요일 ${time}`;
    }
  }

  return `매주 ${dow} ${time}`;
}
